import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Action, type ActionResult, type ExtensionState, type Message, type Response, type Settings } from '../utils/model.ts';

declare const chrome: typeof import('wxt/browser').browser;

type Extension = { context: BrowserContext; popup: Page; windowId: number };
const test = base.extend<{ extension: Extension }>({
  extension: async ({}, use, testInfo) => {
    const path = resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless: true, viewport: { width: 400, height: 600 },
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    });
    const errors: string[] = [];
    context.on('page', (page) => page.on('pageerror', (error) => {
      if (page.url().startsWith('chrome-extension://')) errors.push(error.message);
    }));
    try {
      await context.route('https://*.test/**', (route) => {
        const url = new URL(route.request().url());
        const title = `${url.hostname} — ${url.pathname.slice(1)}`;
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>${title}</title><h1>${title}</h1>` });
      });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const popup = context.pages()[0] ?? await context.newPage();
      await popup.goto(`chrome-extension://${worker.url().split('/')[2]}/popup.html`);
      await ready(popup);
      const windowId = await popup.evaluate(async () => (await chrome.windows.getCurrent()).id!);
      const extension = { context, popup, windowId };
      await use(extension);
      if (testInfo.status !== testInfo.expectedStatus) {
        const actual = await worker.evaluate(async () => ({
          tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}),
          windows: await chrome.windows.getAll({}), recovery: await chrome.storage.session.get(null),
          settings: await chrome.storage.local.get(null),
        }));
        const output = testInfo.outputPath('actual-browser-state.json');
        await writeFile(output, JSON.stringify({ ...actual, popup: extension.popup.isClosed() ? 'closed' : await extension.popup.locator('body').innerText(), errors }, null, 2));
        await testInfo.attach('actual-browser-state', { path: output, contentType: 'application/json' });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
});

async function ready(page: Page) {
  await expect(page.locator('#popup-main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#refresh-button')).toBeEnabled();
  await expect(page.locator('#tab-summary')).toHaveText(/^\d+ tabs? · \d+ windows?$/);
}

async function request<T>(page: Page, message: Message): Promise<T> {
  const response = await page.evaluate((value) => chrome.runtime.sendMessage(value), message) as Response<T>;
  if (message.type === 'run-action' || message.type === 'undo') {
    const name = message.type === 'undo' ? 'undo-result' : `${message.action}-result`;
    const output = test.info().outputPath(`${test.info().attachments.length}-${name}.json`);
    await writeFile(output, JSON.stringify({ request: message, response }, null, 2));
    await test.info().attach(name, { path: output, contentType: 'application/json' });
  }
  if (!response.ok) throw new Error(`${message.type}: ${response.error}`);
  return response.data;
}

const tabs = (page: Page) => page.evaluate(() => chrome.tabs.query({}));
const state = (page: Page, windowId: number, scope: 'current' | 'all' = 'current') =>
  request<ExtensionState>(page, { type: 'get-state', windowId, scope });
const action = (page: Page, windowId: number, name: Action, extra: { tabIds?: number[]; windowIds?: number[]; scope?: 'current' | 'all' } = {}) =>
  request<ActionResult>(page, { type: 'run-action', windowId, action: name, scope: 'current', ...extra });
const undo = (page: Page) => request<ActionResult>(page, { type: 'undo' });
const settings = (page: Page, overrides: Partial<Settings>) => request(page, { type: 'save-settings', settings: { ...DEFAULT_SETTINGS, ...overrides } });
const idsIn = async (page: Page, windowId: number) => (await tabs(page)).filter((tab) => tab.windowId === windowId).map((tab) => tab.id);
const relevantOrder = async (page: Page, ids: number[]) => (await tabs(page)).filter((tab) => ids.includes(tab.id!)).map((tab) => tab.id);

async function complete(page: Page, ids: number[]) {
  await expect.poll(async () => (await tabs(page)).filter((tab) => ids.includes(tab.id!) && tab.status === 'complete' && !tab.pendingUrl).length).toBe(ids.length);
}

async function createTabs(page: Page, windowId: number, definitions: { url: string; pinned?: boolean }[]) {
  const ids: number[] = [];
  for (const definition of definitions) {
    const [fixture, created] = await Promise.all([
      page.context().waitForEvent('page'),
      page.evaluate(({ windowId, pinned }) => chrome.tabs.create({ windowId, pinned, active: false, url: 'about:blank' }),
        { windowId, pinned: definition.pinned ?? false }),
    ]);
    await fixture.goto(definition.url);
    await expect(fixture.locator('h1')).toContainText(new URL(definition.url).hostname);
    ids.push(created.id!);
  }
  await complete(page, ids);
  return ids;
}

async function createWindow(page: Page, urls: string[], type: 'normal' | 'popup' = 'normal') {
  const [fixture, created] = await Promise.all([
    page.context().waitForEvent('page'),
    page.evaluate(async (type) => {
      const window = await chrome.windows.create({ url: 'about:blank', focused: false, type });
      if (window?.id === undefined) throw new Error('The fixture window was not created.');
      return { id: window.id, ids: (await chrome.tabs.query({ windowId: window.id })).map((tab) => tab.id!) };
    }, type),
  ]);
  await fixture.goto(urls[0]!);
  await expect(fixture.locator('h1')).toContainText(new URL(urls[0]!).hostname);
  created.ids.push(...await createTabs(page, created.id, urls.slice(1).map((url) => ({ url }))));
  await complete(page, created.ids);
  return created;
}

async function group(page: Page, ids: number[], title: string, color: Browser.tabGroups.TabGroup['color'] = 'cyan', collapsed = false) {
  return page.evaluate(async ({ ids, title, color, collapsed }) => {
    const windowId = (await chrome.tabs.get(ids[0]!)).windowId;
    const id = await chrome.tabs.group({ tabIds: ids as [number, ...number[]], createProperties: { windowId } });
    await chrome.tabGroups.update(id, { title, color, collapsed });
    return chrome.tabGroups.get(id);
  }, { ids, title, color, collapsed });
}

async function expectGroup(page: Page, ids: number[], metadata: { title: string; color: string; collapsed: boolean; windowId: number }) {
  const live = await tabs(page);
  const groupId = live.find((tab) => tab.id === ids[0])?.groupId;
  expect(groupId).toBeGreaterThanOrEqual(0);
  expect(live.filter((tab) => tab.groupId === groupId).map((tab) => tab.id)).toEqual(ids);
  expect(await page.evaluate((id) => chrome.tabGroups.get(id!), groupId)).toMatchObject(metadata);
}

test('group controls and Undo respect excluded members and current-window scope', async ({ extension }) => {
  const { popup, windowId } = extension;
  await settings(popup, { excludedSites: ['locked.test'] });
  const ids = await createTabs(popup, windowId, ['open.test/A', 'locked.test/B', 'open.test/C', 'free.test/D', 'free.test/E'].map((path) => ({ url: `https://${path}` })));
  const mixed = await group(popup, ids.slice(0, 3), 'Mixed', 'purple');
  const pure = await group(popup, ids.slice(3), 'Eligible', 'orange');
  const other = await createWindow(popup, ['https://outside.test/A', 'https://outside.test/B']);
  const outside = await group(popup, other.ids, 'Outside', 'pink');
  const original = await idsIn(popup, windowId);

  const collapsed = await action(popup, windowId, 'collapse');
  expect(collapsed.changed).toBe(2);
  expect(collapsed.warnings.join(' ')).toContain('excluded site');
  await expectGroup(popup, ids.slice(3), { title: 'Eligible', color: 'orange', collapsed: true, windowId });
  await expectGroup(popup, ids.slice(0, 3), { title: 'Mixed', color: 'purple', collapsed: false, windowId });
  expect((await undo(popup)).undoLabel).toBeNull();
  await expectGroup(popup, ids.slice(3), { title: 'Eligible', color: 'orange', collapsed: false, windowId });

  await popup.evaluate(async (ids) => { for (const id of ids) await chrome.tabGroups.update(id, { collapsed: true }); }, [mixed.id, pure.id]);
  expect((await action(popup, windowId, 'expand')).changed).toBe(2);
  await expectGroup(popup, ids.slice(0, 3), { title: 'Mixed', color: 'purple', collapsed: true, windowId });
  await expectGroup(popup, ids.slice(3), { title: 'Eligible', color: 'orange', collapsed: false, windowId });
  expect((await undo(popup)).undoLabel).toBeNull();
  await expectGroup(popup, ids.slice(3), { title: 'Eligible', color: 'orange', collapsed: true, windowId });

  expect((await action(popup, windowId, 'ungroup')).changed).toBe(4);
  expect((await tabs(popup)).filter((tab) => [ids[0], ids[2], ...ids.slice(3)].includes(tab.id!)).every((tab) => tab.groupId === -1)).toBe(true);
  await expectGroup(popup, [ids[1]!], { title: 'Mixed', color: 'purple', collapsed: true, windowId });
  expect((await undo(popup)).undoLabel).toBeNull();
  expect(await idsIn(popup, windowId)).toEqual(original);
  await expectGroup(popup, ids.slice(0, 3), { title: 'Mixed', color: 'purple', collapsed: true, windowId });
  await expectGroup(popup, ids.slice(3), { title: 'Eligible', color: 'orange', collapsed: true, windowId });
  await expectGroup(popup, other.ids, { title: 'Outside', color: 'pink', collapsed: outside.collapsed, windowId: other.id });
  expect(await tabs(popup)).toHaveLength(8);
});

test('a source containing only a collapsed group merges and reconstructs exactly', async ({ extension }) => {
  const { popup, windowId } = extension;
  const source = await createWindow(popup, ['https://project.test/A', 'https://project.test/B']);
  const original = await group(popup, source.ids, 'Only group', 'green', true);
  expect(original.collapsed).toBe(true);
  const beforeIds = (await tabs(popup)).map((tab) => tab.id);
  const merged = await action(popup, windowId, 'merge');
  expect(merged.warnings).toEqual([]);
  expect(merged.changed).toBe(2);
  await expectGroup(popup, source.ids, { title: 'Only group', color: 'green', collapsed: true, windowId });
  expect((await state(popup, windowId, 'all')).windows).toHaveLength(1);
  const recovered = await undo(popup);
  expect.soft(recovered.undoLabel, JSON.stringify(recovered)).toBeNull();
  const restoredWindow = (await tabs(popup)).find((tab) => tab.id === source.ids[0])!.windowId;
  expect(restoredWindow).not.toBe(windowId);
  await expectGroup(popup, source.ids, { title: 'Only group', color: 'green', collapsed: true, windowId: restoredWindow });
  expect((await tabs(popup)).map((tab) => tab.id).sort()).toEqual(beforeIds.sort());
  expect(await idsIn(popup, restoredWindow)).toEqual(source.ids);
});

test('merge splits excluded group members and Undo restores both halves and metadata', async ({ extension }, testInfo) => {
  const { popup, windowId } = extension;
  await settings(popup, { excludedSites: ['locked.test'] });
  const source = await createWindow(popup, ['https://open.test/A', 'https://locked.test/B', 'https://open.test/C']);
  const untouched = await createWindow(popup, ['https://untouched.test/A']);
  const original = await group(popup, source.ids, 'Split project', 'blue', true);
  expect(original.collapsed).toBe(true);
  const before = await tabs(popup);
  const result = await action(popup, windowId, 'merge', { windowIds: [source.id] });
  expect(result.changed).toBe(2);
  expect(result.warnings.join(' ')).toContain('was split');
  await expectGroup(popup, [source.ids[0]!, source.ids[2]!], { title: 'Split project', color: 'blue', collapsed: true, windowId });
  const afterMerge = await popup.evaluate(async () => ({
    tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}), recovery: await chrome.storage.session.get(null),
  }));
  const output = testInfo.outputPath('split-merge-before-undo.json');
  await writeFile(output, JSON.stringify({ original, result, ...afterMerge }, null, 2));
  await testInfo.attach('split-merge-before-undo', { path: output, contentType: 'application/json' });
  expect(afterMerge.tabs.filter((tab) => tab.groupId === original.id).map((tab) => tab.id)).toEqual([source.ids[1]]);
  // This soft assertion retains the regression while still probing structural recovery.
  expect.soft(afterMerge.groups.find((group) => group.id === original.id)).toMatchObject({
    title: 'Split project', color: 'blue', collapsed: true, windowId: source.id,
  });
  expect(await idsIn(popup, untouched.id)).toEqual(untouched.ids);
  const recovered = await undo(popup);
  expect.soft(recovered.undoLabel, JSON.stringify(recovered)).toBeNull();
  await expectGroup(popup, source.ids, { title: 'Split project', color: 'blue', collapsed: true, windowId: source.id });
  expect(await idsIn(popup, windowId)).toEqual(before.filter((tab) => tab.windowId === windowId).map((tab) => tab.id));
  expect((await tabs(popup)).map((tab) => tab.id).sort()).toEqual(before.map((tab) => tab.id).sort());
});

test('minimized and single-tab popup sources require their options and recover their window types', async ({ extension }) => {
  const { popup, windowId } = extension;
  const minimized = await createWindow(popup, ['https://minimized.test/A']);
  const panel = await createWindow(popup, ['https://panel.test/A'], 'popup');
  await popup.evaluate((id) => chrome.windows.update(id, { state: 'minimized' }), minimized.id);
  await expect.poll(() => popup.evaluate(async (id) => (await chrome.windows.get(id)).state, minimized.id)).toBe('minimized');
  expect((await state(popup, windowId)).mergeWindowIds).toEqual([]);
  expect((await action(popup, windowId, 'merge')).changed).toBe(0);
  expect(await idsIn(popup, minimized.id)).toEqual(minimized.ids);
  expect(await idsIn(popup, panel.id)).toEqual(panel.ids);

  await settings(popup, { mergePopups: true });
  expect((await state(popup, windowId)).mergeWindowIds).toEqual([panel.id]);
  const popupMerge = await action(popup, windowId, 'merge');
  expect(popupMerge.warnings).toEqual([]);
  expect(popupMerge.changed).toBe(1);
  expect((await tabs(popup)).find((tab) => tab.id === panel.ids[0])?.windowId).toBe(windowId);
  expect(await idsIn(popup, minimized.id)).toEqual(minimized.ids);
  expect((await undo(popup)).undoLabel).toBeNull();
  const panelWindow = (await tabs(popup)).find((tab) => tab.id === panel.ids[0])!.windowId;
  expect(await popup.evaluate((id) => chrome.windows.get(id), panelWindow)).toMatchObject({ type: 'popup', state: 'normal' });

  await settings(popup, { mergePopups: true, mergeMinimized: true });
  expect((await state(popup, windowId)).mergeWindowIds.sort()).toEqual([panelWindow, minimized.id].sort());
  expect((await action(popup, windowId, 'merge')).changed).toBe(2);
  expect((await state(popup, windowId, 'all')).windows).toHaveLength(1);
  const recovered = await undo(popup);
  expect(recovered.undoLabel, JSON.stringify(recovered)).toBeNull();
  const live = await tabs(popup);
  expect(live).toHaveLength(3);
  expect(await popup.evaluate((id) => chrome.windows.get(id), live.find((tab) => tab.id === minimized.ids[0])!.windowId)).toMatchObject({ type: 'normal', state: 'minimized' });
  expect(await popup.evaluate((id) => chrome.windows.get(id), live.find((tab) => tab.id === panel.ids[0])!.windowId)).toMatchObject({ type: 'popup', state: 'normal' });
});

test('custom and encounter sorts preserve pinned state, stable ties, and explicit scope', async ({ extension }) => {
  const { popup, windowId } = extension;
  const ids = await createTabs(popup, windowId, [
    { url: 'https://alpha.test/Pin', pinned: true }, { url: 'https://zeta.test/Pin', pinned: true },
    ...['beta.test/1', 'zeta.test/1', 'alpha.test/1', 'beta.test/2'].map((path) => ({ url: `https://${path}` })),
  ]);
  const other = await createWindow(popup, ['https://zeta.test/2', 'https://alpha.test/2', 'https://zeta.test/3', 'https://beta.test/3']);
  const original = await idsIn(popup, windowId);
  await settings(popup, { sortBy: 'custom', siteOrder: ['zeta.test', 'beta.test', 'alpha.test'], sortPinned: true });
  expect((await action(popup, windowId, 'sort')).warnings).toEqual([]);
  expect(await relevantOrder(popup, ids)).toEqual([ids[1], ids[0], ids[3], ids[2], ids[5], ids[4]]);
  expect(await idsIn(popup, other.id)).toEqual(other.ids);
  expect((await tabs(popup)).filter((tab) => tab.pinned).map((tab) => tab.id)).toEqual([ids[1], ids[0]]);
  expect((await undo(popup)).undoLabel).toBeNull();
  expect(await idsIn(popup, windowId)).toEqual(original);
  expect((await action(popup, windowId, 'sort', { scope: 'all' })).warnings).toEqual([]);
  expect(await idsIn(popup, other.id)).toEqual([other.ids[0], other.ids[2], other.ids[3], other.ids[1]]);
  expect((await undo(popup)).undoLabel).toBeNull();

  await settings(popup, { sortBy: 'encounter' });
  expect((await action(popup, windowId, 'sort')).warnings).toEqual([]);
  // Encounter rank includes the original pinned tabs, which remain fixed.
  expect(await relevantOrder(popup, ids)).toEqual([ids[0], ids[1], ids[4], ids[3], ids[2], ids[5]]);
  expect(await idsIn(popup, other.id)).toEqual(other.ids);
  expect((await undo(popup)).undoLabel).toBeNull();
  await settings(popup, { sortBy: 'encounter', sortDirection: 'desc' });
  expect((await action(popup, windowId, 'sort', { scope: 'all' })).warnings).toEqual([]);
  expect(await relevantOrder(popup, ids)).toEqual([ids[0], ids[1], ids[2], ids[5], ids[4], ids[3]]);
  expect(await idsIn(popup, other.id)).toEqual([other.ids[3], other.ids[0], other.ids[2], other.ids[1]]);
  expect((await undo(popup)).undoLabel).toBeNull();
  expect(await idsIn(popup, windowId)).toEqual(original);
  expect(await tabs(popup)).toHaveLength(11);
});

test('group-name sort preserves metadata and uses current then all-window scope', async ({ extension }) => {
  const { popup, windowId } = extension;
  const ids = await createTabs(popup, windowId, ['alpha.test/2', 'alpha.test/1', 'zeta.test/2', 'zeta.test/1'].map((path) => ({ url: `https://${path}` })));
  await group(popup, ids.slice(0, 2), 'Zulu', 'yellow', true);
  await group(popup, ids.slice(2), 'Alpha', 'red', true);
  const other = await createWindow(popup, ['https://alpha.test/4', 'https://alpha.test/3', 'https://zeta.test/4', 'https://zeta.test/3']);
  await group(popup, other.ids.slice(0, 2), 'Zulu', 'purple');
  await group(popup, other.ids.slice(2), 'Alpha', 'pink');
  await settings(popup, { sortBy: 'url', sortGroupsByTitle: true });
  expect((await action(popup, windowId, 'sort')).warnings).toEqual([]);
  expect(await relevantOrder(popup, ids)).toEqual([ids[3], ids[2], ids[1], ids[0]]);
  expect(await idsIn(popup, other.id)).toEqual(other.ids);
  await expectGroup(popup, [ids[3]!, ids[2]!], { title: 'Alpha', color: 'red', collapsed: true, windowId });
  await expectGroup(popup, [ids[1]!, ids[0]!], { title: 'Zulu', color: 'yellow', collapsed: true, windowId });
  expect((await undo(popup)).undoLabel).toBeNull();
  expect(await relevantOrder(popup, ids)).toEqual(ids);
  expect((await action(popup, windowId, 'sort', { scope: 'all' })).warnings).toEqual([]);
  expect(await idsIn(popup, other.id)).toEqual([other.ids[3], other.ids[2], other.ids[1], other.ids[0]]);
  expect((await undo(popup)).undoLabel).toBeNull();
  expect(await idsIn(popup, other.id)).toEqual(other.ids);
  expect(await tabs(popup)).toHaveLength(9);
});

test('structural Undo retains missing work and preserves unrelated tabs after manual edits', async ({ extension }) => {
  const { popup, windowId } = extension;
  const ids = await createTabs(popup, windowId, ['zeta.test/2', 'zeta.test/1', 'alpha.test/A'].map((path) => ({ url: `https://${path}` })));
  await group(popup, ids.slice(0, 2), 'Original', 'cyan', true);
  const other = await createWindow(popup, ['https://outside.test/A', 'https://outside.test/B']);
  await group(popup, other.ids, 'Outside', 'pink');
  await settings(popup, { sortBy: 'url' });
  expect((await action(popup, windowId, 'sort')).warnings).toEqual([]);
  const added = await createTabs(popup, windowId, [{ url: 'https://new.test/A' }, { url: 'https://new.test/B' }]);
  const unrelated = await group(popup, [...added, ids[0]!], 'User group', 'orange');
  await popup.evaluate(async ({ move, remove, target }) => {
    await chrome.tabs.move(move, { windowId: target, index: -1 });
    await chrome.tabs.remove(remove);
  }, { move: ids[2]!, remove: ids[1]!, target: other.id });
  const beforeUndo = (await tabs(popup)).map((tab) => tab.id).sort();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await undo(popup);
    expect(result.undoLabel).toBe('Sort tabs');
    expect(result.warnings.join(' ')).toContain('Recovery is incomplete');
    expect(result.warnings.join(' ')).toContain('closed after the action');
    expect((await state(popup, windowId)).undo).toMatchObject({ kind: 'structure', label: 'Sort tabs' });
    expect((await tabs(popup)).map((tab) => tab.id).sort()).toEqual(beforeUndo);
    // Restored tabs can shift indices. Unrelated tabs must retain their window, group, and relative order.
    await expectGroup(popup, added, { title: 'User group', color: 'orange', collapsed: false, windowId });
    expect((await tabs(popup)).find((tab) => tab.id === added[0])?.groupId).toBe(unrelated.id);
    await expectGroup(popup, other.ids, { title: 'Outside', color: 'pink', collapsed: false, windowId: other.id });
    expect((await tabs(popup)).find((tab) => tab.id === ids[2])?.windowId).toBe(windowId);
  }
});

test('duplicate recovery recreates a closed final-tab window and survives popup closure without duplication', async ({ extension }) => {
  const { context, windowId } = extension;
  let popup = extension.popup;
  const url = 'https://duplicate.test/Final';
  const [keeper] = await createTabs(popup, windowId, [{ url, pinned: true }]);
  const source = await createWindow(popup, [url]);
  await settings(popup, { protectActive: false });
  const result = await action(popup, windowId, 'close-duplicates', { scope: 'all', tabIds: source.ids });
  expect(result.changed).toBe(1);
  expect((await state(popup, windowId, 'all')).windows).toHaveLength(1);
  expect((await tabs(popup)).filter((tab) => tab.url === url).map((tab) => tab.id)).toEqual([keeper]);
  const popupUrl = popup.url();
  await popup.close();
  popup = await context.newPage();
  extension.popup = popup;
  await popup.goto(popupUrl);
  await ready(popup);
  await expect(popup.locator('#undo-button')).toBeEnabled();
  expect((await state(popup, windowId)).undo).toMatchObject({ kind: 'close' });
  const reopened = await undo(popup);
  expect(reopened.undoLabel, JSON.stringify(reopened)).toBeNull();
  await expect.poll(async () => (await tabs(popup)).filter((tab) => tab.url === url && tab.status === 'complete').length).toBe(2);
  const restored = (await tabs(popup)).find((tab) => tab.url === url && tab.id !== keeper)!;
  expect(restored.windowId).not.toBe(windowId);
  expect(restored.active).toBe(true);
  expect(await idsIn(popup, restored.windowId)).toEqual([restored.id]);
  expect(await popup.evaluate((id) => chrome.windows.get(id), restored.windowId)).toMatchObject({ type: 'normal', state: 'normal' });
  const stable = (await tabs(popup)).map((tab) => tab.id);
  expect(await undo(popup)).toMatchObject({ changed: 0, undoLabel: null });
  expect((await tabs(popup)).map((tab) => tab.id)).toEqual(stable);
  expect((await state(popup, windowId)).undo).toBeNull();
});

async function boundaryEvidence(name: string, value: unknown) {
  const output = test.info().outputPath(`${name}.json`);
  await writeFile(output, JSON.stringify(value, null, 2));
  await test.info().attach(name, { path: output, contentType: 'application/json' });
}

test('recovery boundary A: native Undo restores exact placement around untouched neighbors', async ({ extension }) => {
  const { popup, windowId } = extension;
  const [left] = await idsIn(popup, windowId);
  const ids = await createTabs(popup, windowId, [
    'https://site.test/a', 'https://middle.test/', 'https://site.test/b', 'https://right.test/',
  ].map((url) => ({ url })));
  const original = [left, ...ids];
  expect(await idsIn(popup, windowId)).toEqual(original);
  const grouped = await action(popup, windowId, 'group');
  expect(grouped.changed).toBe(2);
  const groupId = (await tabs(popup)).find((tab) => tab.id === ids[0])!.groupId;
  expect(groupId).toBeGreaterThanOrEqual(0);
  await popup.evaluate(({ groupId, windowId }) => chrome.tabGroups.move(groupId, { windowId, index: 0 }), { groupId, windowId });
  const beforeUndo = await idsIn(popup, windowId);
  expect(beforeUndo).toEqual([ids[0], ids[2], left, ids[1], ids[3]]);
  const result = await undo(popup);
  const after = await tabs(popup);
  const recovery = await popup.evaluate(() => chrome.storage.session.get(null));
  const actual = after.filter((tab) => tab.windowId === windowId).map((tab) => tab.id);
  await boundaryEvidence('native-neighbor-order', { labels: { L: left, A: ids[0], M: ids[1], B: ids[2], R: ids[3] }, original, beforeUndo, actual, result, recovery });
  expect(after.map((tab) => tab.id).sort()).toEqual([...original].sort());
  expect(after.every((tab) => tab.groupId === -1)).toBe(true);
  expect.soft(actual, 'Undo must restore A and B around the untouched L, M, and R tabs.').toEqual(original);
  if (actual.some((id, index) => id !== original[index])) {
    expect.soft(result.undoLabel, 'An incomplete order must retain recovery.').not.toBeNull();
    expect.soft(recovery['undo-normal'], 'The failed order must remain available for retry.').toBeDefined();
  }
});

test('recovery boundary B: FAILURE INJECTION preserves close recovery after zero-change collapse failure', async ({ extension }) => {
  const { context, popup, windowId } = extension;
  const url = 'https://duplicate.test/Recover-me';
  const ids = await createTabs(popup, windowId, [
    { url, pinned: true }, { url }, { url: 'https://group.test/A' }, { url: 'https://group.test/B' },
  ]);
  const existing = await group(popup, ids.slice(2), 'Expanded group', 'purple');
  expect(existing.collapsed).toBe(false);
  expect((await action(popup, windowId, 'close-duplicates', { tabIds: [ids[1]!] })).changed).toBe(1);
  const previous = await popup.evaluate(() => chrome.storage.session.get(null));
  expect(previous['undo-normal']).toMatchObject({ kind: 'close', closedIds: [ids[1]] });
  const before = await tabs(popup);
  const worker = context.serviceWorkers()[0]!;
  const installed = await worker.evaluate(() => {
    const globals = globalThis as typeof globalThis & {
      browser?: typeof chrome; chrome: typeof chrome;
      __reviewCollapseFault?: { calls: number; restored: boolean; namespace: string };
    };
    // Match the namespace selected by the installed WXT browser module.
    const api = globals.browser?.runtime?.id ? globals.browser : globals.chrome;
    const original = api.tabGroups.update;
    const status: { calls: number; restored: boolean; namespace: string } = { calls: 0, restored: false, namespace: api === globals.browser ? 'browser' : 'chrome' };
    globals.__reviewCollapseFault = status;
    const rejectOnce = async () => {
      api.tabGroups.update = original;
      status.calls++;
      status.restored = api.tabGroups.update === original;
      throw new Error('injected collapse failure');
    };
    try {
      api.tabGroups.update = rejectOnce;
      return api.tabGroups.update === rejectOnce;
    } catch {
      return false;
    }
  });
  test.skip(!installed, 'The native tabGroups.update binding does not permit the requested one-call fault injection.');
  const result = await action(popup, windowId, 'collapse');
  const injection = await worker.evaluate(() => (globalThis as typeof globalThis & { __reviewCollapseFault?: unknown }).__reviewCollapseFault);
  const after = await tabs(popup);
  const currentGroup = await popup.evaluate((id) => chrome.tabGroups.get(id), existing.id);
  const recovery = await popup.evaluate(() => chrome.storage.session.get(null));
  await boundaryEvidence('injected-collapse-recovery', { injection, previous, before, result, after, currentGroup, recovery });
  expect(injection).toMatchObject({ calls: 1, restored: true });
  expect(result.changed).toBe(0);
  expect(result.warnings.join(' ')).toContain('injected collapse failure');
  expect(currentGroup).toMatchObject({ id: existing.id, title: 'Expanded group', color: 'purple', collapsed: false });
  const structure = (items: Browser.tabs.Tab[]) => items.map(({ id, windowId, index, pinned, groupId }) => ({ id, windowId, index, pinned, groupId }));
  expect(structure(after)).toEqual(structure(before));
  expect.soft(recovery['undo-normal'], 'A rejected action with zero changes must preserve the useful close record.').toMatchObject({
    id: (previous['undo-normal'] as { id: string }).id, kind: 'close', closedIds: [ids[1]],
  });
  expect.soft(result.undoLabel).toBe('Reopen closed duplicate URLs');
});

test('recovery boundary C: FAILURE INJECTION rejects ambiguous window adoption after a failed create', async ({ extension }) => {
  const { context, popup, windowId } = extension;
  const source = await createWindow(popup, ['https://seed.test/A']);
  const unrelated = await createWindow(popup, ['https://unrelated.test/First', 'https://unrelated.test/Second']);
  await popup.evaluate(async ({ sourceId, unrelatedId }) => {
    await chrome.windows.update(sourceId, { state: 'normal', left: 0, top: 0, width: 620, height: 500 });
    await chrome.windows.update(unrelatedId, { state: 'normal', left: 20, top: 20, width: 720, height: 560 });
  }, { sourceId: source.id, unrelatedId: unrelated.id });
  const sourceBefore = await popup.evaluate((id) => chrome.windows.get(id), source.id);
  const unrelatedBefore = await popup.evaluate((id) => chrome.windows.get(id), unrelated.id);
  const bounds = ({ left, top, width, height, state }: Browser.windows.Window) => ({ left, top, width, height, state });
  expect(bounds(unrelatedBefore), 'The fixture requires distinct native window bounds.').not.toEqual(bounds(sourceBefore));
  const originalIds = (await tabs(popup)).map((tab) => tab.id).sort();
  expect((await action(popup, windowId, 'merge', { windowIds: [source.id] })).changed).toBe(1);
  expect((await tabs(popup)).find((tab) => tab.id === source.ids[0])?.windowId).toBe(windowId);
  expect((await state(popup, windowId, 'all')).windows.some((window) => window.id === source.id)).toBe(false);

  const worker = context.serviceWorkers()[0]!;
  const installed = await worker.evaluate(() => {
    const globals = globalThis as typeof globalThis & {
      browser?: typeof chrome; chrome: typeof chrome;
      __reviewCreateFault?: { calls: number; restored: boolean; namespace: string };
    };
    const api = globals.browser?.runtime?.id ? globals.browser : globals.chrome;
    const original = api.windows.create;
    const status: { calls: number; restored: boolean; namespace: string } = { calls: 0, restored: false, namespace: api === globals.browser ? 'browser' : 'chrome' };
    globals.__reviewCreateFault = status;
    const rejectOnce = async () => {
      api.windows.create = original;
      status.calls++;
      status.restored = api.windows.create === original;
      throw new Error('injected window create failure');
    };
    try {
      api.windows.create = rejectOnce;
      return api.windows.create === rejectOnce;
    } catch {
      return false;
    }
  });
  test.skip(!installed, 'The native windows.create binding does not permit the requested one-call fault injection.');
  const firstUndo = await undo(popup);
  const injection = await worker.evaluate(() => (globalThis as typeof globalThis & { __reviewCreateFault?: unknown }).__reviewCreateFault);
  const failedRecovery = await popup.evaluate(() => chrome.storage.session.get(null));
  expect(injection).toMatchObject({ calls: 1, restored: true });
  expect(firstUndo.changed).toBe(0);
  expect(firstUndo.undoLabel).toBe('Merge windows');
  expect(firstUndo.warnings.join(' ')).toContain('injected window create failure');
  const saved = failedRecovery['undo-normal'] as {
    windowIntents: Record<string, { seedId: number; fromWindowId: number }>;
    restoredWindows: Record<string, number>;
  };
  expect(saved.windowIntents[String(source.id)]).toEqual({ seedId: source.ids[0], fromWindowId: windowId });
  expect(saved.restoredWindows).toEqual({});
  await popup.evaluate(({ id, windowId }) => chrome.tabs.move(id, { windowId, index: -1 }), { id: source.ids[0]!, windowId: unrelated.id });
  const beforeRetry = {
    window: await popup.evaluate((id) => chrome.windows.get(id), unrelated.id),
    tabs: await tabs(popup),
  };
  // Observe real storage writes so a mapping remains visible even if Undo erases its record.
  const retry = await popup.evaluate(async () => {
    const recoveryWrites: { restoredWindows?: Record<string, number> }[] = [];
    const observe: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'session' && changes['undo-normal']?.newValue) recoveryWrites.push(changes['undo-normal'].newValue);
    };
    chrome.storage.onChanged.addListener(observe);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'undo' }) as Response<ActionResult>;
      return {
        response, recoveryWrites, recovery: await chrome.storage.session.get(null),
        tabs: await chrome.tabs.query({}), windows: await chrome.windows.getAll({}),
      };
    } finally {
      chrome.storage.onChanged.removeListener(observe);
    }
  });
  await boundaryEvidence('injected-create-window-adoption', { source, unrelated, sourceBefore, unrelatedBefore, injection, firstUndo, failedRecovery, beforeRetry, retry });
  expect(retry.response.ok).toBe(true);
  if (!retry.response.ok) throw new Error(retry.response.error);
  expect(retry.tabs.map((tab) => tab.id).sort()).toEqual(originalIds);
  expect(retry.tabs.filter((tab) => unrelated.ids.includes(tab.id!)).every((tab) => tab.windowId === unrelated.id)).toBe(true);
  expect.soft(retry.recoveryWrites.map((record) => record.restoredWindows?.[String(source.id)]), 'A manual seed move does not prove reconstruction of its old window.').not.toContain(unrelated.id);
  const afterWindow = retry.windows.find((window) => window.id === unrelated.id)!;
  expect.soft(bounds(afterWindow), 'Undo must not apply the missing source bounds to an unrelated existing window.').toEqual(bounds(beforeRetry.window));
  expect.soft(retry.tabs.find((tab) => tab.windowId === unrelated.id && tab.active)?.id, 'Undo must preserve the unrelated window active tab.').toBe(
    beforeRetry.tabs.find((tab) => tab.windowId === unrelated.id && tab.active)?.id,
  );
  expect.soft(retry.response.data.undoLabel, 'Ambiguous reconstruction must remain an incomplete recovery.').toBe('Merge windows');
  expect.soft(retry.recovery['undo-normal']).toBeDefined();
});

test('recovery boundary D: observe active-tab restoration in a surviving source window', async ({ extension }, testInfo) => {
  const { popup, windowId } = extension;
  await settings(popup, { excludedSites: ['locked.test'] });
  const source = await createWindow(popup, ['https://eligible.test/Active', 'https://locked.test/Remain']);
  await popup.evaluate((id) => chrome.tabs.update(id, { active: true }), source.ids[0]!);
  const before = (await tabs(popup)).filter((tab) => tab.windowId === source.id);
  expect(before.find((tab) => tab.active)?.id).toBe(source.ids[0]);
  expect((await action(popup, windowId, 'merge', { windowIds: [source.id] })).changed).toBe(1);
  expect(await idsIn(popup, source.id)).toEqual([source.ids[1]]);
  const result = await undo(popup);
  const after = (await tabs(popup)).filter((tab) => tab.windowId === source.id);
  const originalActiveId = before.find((tab) => tab.active)?.id;
  const actualActiveId = after.find((tab) => tab.active)?.id;
  const activeRestored = actualActiveId === originalActiveId;
  const contract = 'README promises positions, windows, pinned state, and groups; active-tab restoration is an informational UX observation.';
  await boundaryEvidence('native-surviving-window-activation', { contract, source, before, after, result, originalActiveId, actualActiveId, activeRestored });
  testInfo.annotations.push({ type: 'observation', description: `Active tab restored: ${activeRestored}. ${contract}` });
  expect(result.undoLabel).toBeNull();
  expect(after.map((tab) => tab.id)).toEqual(source.ids);
  expect(after.map((tab) => ({ id: tab.id, pinned: tab.pinned, groupId: tab.groupId }))).toEqual(
    before.map((tab) => ({ id: tab.id, pinned: tab.pinned, groupId: tab.groupId })),
  );
});
