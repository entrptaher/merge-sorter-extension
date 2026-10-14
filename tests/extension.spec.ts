import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Action, type ActionResult, type ExtensionState, type Message, type Response, type Settings } from '../utils/model.ts';

declare const chrome: typeof import('wxt/browser').browser;

type Extension = { context: BrowserContext; popup: Page; windowId: number; initialTabs: Browser.tabs.Tab[] };
const test = base.extend<{ extension: Extension }>({
  extension: async ({}, use, testInfo) => {
    // An empty userDataDir creates a new temporary profile for each test.
    const path = resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless: true, viewport: { width: 400, height: 600 },
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    });
    const errors: string[] = [];
    const watch = (page: Page) => {
      page.on('pageerror', (error) => {
        if (page.url().startsWith('chrome-extension://')) errors.push(`${page.url()}: ${error.message}`);
      });
      page.on('console', (message) => {
        if (message.type() === 'error' && page.url().startsWith('chrome-extension://')) errors.push(`${page.url()}: ${message.text()}`);
      });
    };
    context.pages().forEach(watch);
    context.on('page', watch);
    try {
      await context.route('https://*.test/**', (route) => {
        const url = new URL(route.request().url());
        const title = `${url.hostname} — ${url.pathname.slice(1) || 'Workspace'}`;
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>Project reference page.</p>` });
      });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const id = worker.url().split('/')[2];
      const initialTabs = await worker.evaluate(() => chrome.tabs.query({}));
      const popup = context.pages()[0] ?? await context.newPage();
      // This checks popup page rendering at popup dimensions, not the browser toolbar surface.
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await ready(popup);
      const windowId = await popup.evaluate(async () => (await chrome.windows.getCurrent()).id!);
      await use({ context, popup, windowId, initialTabs });
      if (testInfo.status !== testInfo.expectedStatus) {
        const live = await worker.evaluate(async () => ({
          tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}), windows: await chrome.windows.getAll({}),
          recovery: await chrome.storage.session.get(null),
        }));
        const diagnostics = { ...live, popup: await popup.locator('body').innerText(), errors };
        const output = testInfo.outputPath('actual-browser-state.json');
        await writeFile(output, JSON.stringify(diagnostics, null, 2));
        await testInfo.attach('actual-browser-state', { path: output, contentType: 'application/json' });
      }
      expect(errors, 'Extension pages must have no console or page errors.').toEqual([]);
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

async function refresh(page: Page) {
  await expect(page.locator('#refresh-button')).toBeEnabled();
  await page.locator('#refresh-button').click();
  await ready(page);
}

async function request<T>(page: Page, message: Message): Promise<T> {
  const response = await page.evaluate((value) => chrome.runtime.sendMessage(value), message) as Response<T>;
  if (!response.ok) throw new Error(`${message.type}: ${response.error}`);
  return response.data;
}

const tabs = (page: Page) => page.evaluate(() => chrome.tabs.query({}));
const state = (page: Page, windowId: number, scope: 'current' | 'all' = 'current') =>
  request<ExtensionState>(page, { type: 'get-state', windowId, scope });
const action = (page: Page, windowId: number, name: Action, extra: { tabIds?: number[]; windowIds?: number[]; scope?: 'current' | 'all' } = {}) =>
  request<ActionResult>(page, { type: 'run-action', windowId, action: name, scope: 'current', ...extra });

async function complete(page: Page, ids: number[]) {
  await expect.poll(async () => (await tabs(page)).filter((tab) => ids.includes(tab.id!))
    .filter((tab) => tab.status === 'complete' && !tab.pendingUrl).length, { message: `Tabs ${ids.join(', ')} must finish navigation.` }).toBe(ids.length);
}

async function createTabs(page: Page, windowId: number, definitions: { url: string; pinned?: boolean }[]) {
  const ids: number[] = [];
  for (const definition of definitions) {
    // Attach Playwright before navigation so the content route handles the first request.
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

async function createWindow(page: Page, urls: string[]) {
  const [fixture, created] = await Promise.all([
    page.context().waitForEvent('page'),
    page.evaluate(async () => {
      const window = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal' });
      if (window?.id === undefined) throw new Error('The fixture window was not created.');
      return { id: window.id, ids: (await chrome.tabs.query({ windowId: window.id })).map((tab) => tab.id!) };
    }),
  ]);
  await fixture.goto(urls[0]!);
  await expect(fixture.locator('h1')).toContainText(new URL(urls[0]!).hostname);
  created.ids.push(...await createTabs(page, created.id, urls.slice(1).map((url) => ({ url }))));
  await complete(page, created.ids);
  return created;
}

test('installation opens no welcome tab; options validate, persist, and reset', async ({ extension }) => {
  const { context, popup, initialTabs } = extension;
  expect(initialTabs).toHaveLength(1);
  expect(initialTabs[0]!.url).toMatch(/^(about:blank|chrome:\/\/newtab\/?)/);
  expect(await tabs(popup)).toHaveLength(1);
  const [options] = await Promise.all([context.waitForEvent('page'), popup.locator('#options-button').click()]);
  await options.waitForURL('**/options.html');
  await expect(options.locator('#settings-fields')).toBeEnabled();
  await options.setViewportSize({ width: 1280, height: 2000 });
  await options.screenshot({ path: '.impeccable/review/options-1280.png', fullPage: true });
  await options.locator('#minimumGroupSize').fill('21');
  await options.locator('#save-button').click();
  expect(await options.locator('#minimumGroupSize').evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true);
  expect((await request<Settings>(options, { type: 'get-settings' })).minimumGroupSize).toBe(2);
  await options.locator('#minimumGroupSize').fill('3');
  await options.locator('#excludedSites').fill('*.test');
  await options.locator('#save-button').click();
  await expect(options.locator('#settings-status')).toContainText('Options were not saved');
  await options.locator('#excludedSites').fill('work.test\nmail.test');
  await options.locator('#scope').selectOption('all');
  await options.locator('#sortBy').selectOption('title');
  await options.locator('#save-button').click();
  await expect(options.locator('#settings-status')).toHaveText('Options saved.');
  await options.reload();
  await expect(options.locator('#settings-fields')).toBeEnabled();
  await expect(options.locator('#minimumGroupSize')).toHaveValue('3');
  await expect(options.locator('#scope')).toHaveValue('all');
  await expect(options.locator('#sortBy')).toHaveValue('title');
  await expect(options.locator('#excludedSites')).toHaveValue('work.test\nmail.test');
  const invalid = await options.evaluate((settings) => chrome.runtime.sendMessage({ type: 'save-settings', settings }), { ...DEFAULT_SETTINGS, minimumGroupSize: 21 });
  expect(invalid).toMatchObject({ ok: false });
  expect((await request<Settings>(options, { type: 'get-settings' })).minimumGroupSize).toBe(3);
  await options.locator('#reset-button').click();
  await expect(options.locator('#settings-status')).toHaveText('Defaults restored and saved.');
  await options.reload();
  await expect(options.locator('#settings-fields')).toBeEnabled();
  expect(await request<Settings>(options, { type: 'get-settings' })).toEqual(DEFAULT_SETTINGS);
  await options.setViewportSize({ width: 390, height: 2400 });
  expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await options.screenshot({ path: '.impeccable/review/options-390.png', fullPage: true });
});

test('duplicate review honors selection and protected copies, then reopens closed URLs', async ({ extension }, testInfo) => {
  const { popup, windowId } = extension;
  const url = 'https://docs.test/Project-guide?edition=2#overview';
  const [pinned, unchecked, closeA, closeB] = await createTabs(popup, windowId, [
    { url, pinned: true }, { url }, { url }, { url },
  ]);
  const other = await createWindow(popup, [url]);
  await popup.getByRole('radio', { name: 'All windows' }).check();
  await refresh(popup);
  await popup.locator('#duplicate-review summary').click();
  await ready(popup);
  await expect(popup.locator('#duplicate-list input[type=checkbox]')).toHaveCount(3);
  await expect(popup.locator('.tab-badge').filter({ hasText: 'Protected' })).toHaveCount(2);
  await popup.locator(`#duplicate-${unchecked}`).uncheck();
  await expect(popup.locator('#duplicate-count')).toHaveText('2');
  await popup.locator('#close-button').click();
  await expect.poll(async () => (await tabs(popup)).filter((tab) => tab.url === url).length).toBe(3);
  const survivors = (await tabs(popup)).map((tab) => tab.id);
  expect(survivors).toEqual(expect.arrayContaining([pinned, unchecked, other.ids[0]]));
  expect(survivors).not.toContain(closeA);
  expect(survivors).not.toContain(closeB);
  await expect(popup.locator('#recovery-limit')).toBeVisible();
  await expect(popup.locator('#undo-button')).toBeEnabled();
  await writeFile(testInfo.outputPath('before-undo.json'), JSON.stringify(await popup.evaluate(() => chrome.storage.session.get(null)), null, 2));
  await popup.locator('#undo-button').click();
  await expect.poll(async () => (await tabs(popup)).filter((tab) => tab.url === url && tab.status === 'complete').length).toBe(5);
  expect((await tabs(popup)).find((tab) => tab.id === pinned)?.pinned).toBe(true);
  expect((await tabs(popup)).find((tab) => tab.id === other.ids[0])?.active).toBe(true);
  await expect(popup.locator('#undo-button')).toBeHidden();
});

test('exact URL matching and live validation reject stale or malformed duplicate selections', async ({ extension }) => {
  const { popup, windowId } = extension;
  const url = 'https://notes.test/Research?version=1#intro';
  const ids = await createTabs(popup, windowId, [
    { url, pinned: true }, { url }, { url: url.replace('version=1', 'version=2') }, { url: url.replace('#intro', '#results') },
  ]);
  const before = await state(popup, windowId);
  expect(before.duplicateGroups).toHaveLength(1);
  expect(before.duplicateGroups[0]!.closeIds).toEqual([ids[1]]);
  await popup.evaluate(({ id, url }) => chrome.tabs.update(id, { url }), { id: ids[1]!, url: 'https://notes.test/New-document' });
  await complete(popup, [ids[1]!]);
  const stale = await action(popup, windowId, 'close-duplicates', { tabIds: [ids[1]!] });
  expect(stale.changed).toBe(0);
  expect(stale.warnings.join(' ')).toContain('no longer safe');
  await popup.evaluate(({ id, url }) => chrome.tabs.update(id, { url, pinned: true }), { id: ids[1]!, url });
  await complete(popup, [ids[1]!]);
  const protectedResult = await action(popup, windowId, 'close-duplicates', { tabIds: ids });
  expect(protectedResult.changed).toBe(0);
  const invalid = await popup.evaluate((windowId) => chrome.runtime.sendMessage({
    type: 'run-action', windowId, scope: 'current', action: 'close-duplicates', tabIds: [-1],
  }), windowId);
  expect(invalid).toMatchObject({ ok: false });
  expect((await tabs(popup)).map((tab) => tab.id)).toEqual(expect.arrayContaining(ids));
});

test('group and sort preserve group members, pinned tabs, metadata, and undo order', async ({ extension }) => {
  const { popup, windowId } = extension;
  const ids = await createTabs(popup, windowId, [
    { url: 'https://zeta.test/Pinned', pinned: true }, { url: 'https://zeta.test/2' },
    { url: 'https://alpha.test/Guide' }, { url: 'https://zeta.test/1' },
    { url: 'https://beta.test/2' }, { url: 'https://beta.test/1' },
  ]);
  const original = (await tabs(popup)).map((tab) => tab.id);
  await refresh(popup);
  await popup.locator('#group-button').click();
  await expect.poll(async () => (await state(popup, windowId)).groups.length).toBe(2);
  await expect(popup.locator('#undo-button')).toBeEnabled();
  await popup.locator('#undo-button').click();
  await expect.poll(async () => (await state(popup, windowId)).groups.length).toBe(0);
  expect((await tabs(popup)).map((tab) => tab.id)).toEqual(original);
  await refresh(popup);
  await popup.locator('#group-button').click();
  await expect.poll(async () => (await state(popup, windowId)).groups.length).toBe(2);
  const grouped = await state(popup, windowId);
  const zeta = grouped.groups.find((group) => group.title === 'zeta.test')!;
  const beta = grouped.groups.find((group) => group.title === 'beta.test')!;
  expect(grouped.tabs.filter((tab) => tab.groupId === zeta.id).map((tab) => tab.id)).toEqual([ids[1], ids[3]]);
  expect(grouped.tabs.find((tab) => tab.id === ids[0])?.groupId).toBe(-1);
  await popup.evaluate((id) => chrome.tabGroups.update(id, { title: 'Research', color: 'cyan', collapsed: true }), zeta.id);
  const beforeSort = (await tabs(popup)).map((tab) => tab.id);
  await refresh(popup);
  await popup.locator('#sort-by').selectOption('url');
  await popup.locator('#sort-button').click();
  await ready(popup);
  const sorted = await state(popup, windowId);
  expect(sorted.tabs.filter((tab) => tab.groupId === zeta.id).map((tab) => tab.id)).toEqual([ids[3], ids[1]]);
  expect(sorted.tabs.filter((tab) => tab.groupId === beta.id).map((tab) => tab.id)).toEqual([ids[5], ids[4]]);
  expect(sorted.tabs[0]).toMatchObject({ id: ids[0], pinned: true });
  expect(sorted.groups.find((group) => group.id === zeta.id)).toMatchObject({ title: 'Research', color: 'cyan', collapsed: true });
  expect(sorted.tabs.find((tab) => tab.id === ids[5])!.index).toBeLessThan(sorted.tabs.find((tab) => tab.id === ids[3])!.index);
  await popup.locator('#undo-button').click();
  await expect.poll(async () => (await tabs(popup)).map((tab) => tab.id)).toEqual(beforeSort);
  expect((await state(popup, windowId)).groups.find((group) => group.id === zeta.id)).toMatchObject({ title: 'Research', color: 'cyan', collapsed: true });
});

test('merge preserves pinned tabs and group metadata; undo reconstructs the source window', async ({ extension }, testInfo) => {
  const { popup, windowId } = extension;
  const [targetPin] = await createTabs(popup, windowId, [{ url: 'https://mail.test/Inbox', pinned: true }]);
  const targetBefore = (await tabs(popup)).filter((tab) => tab.windowId === windowId).map((tab) => tab.id);
  const source = await createWindow(popup, ['https://work.test/Inbox', 'https://research.test/Design', 'https://research.test/References']);
  await popup.evaluate(async ({ id, members, windowId }) => {
    await chrome.tabs.update(id, { pinned: true });
    const groupId = await chrome.tabs.group({ tabIds: members as [number, ...number[]], createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: 'Launch research', color: 'purple', collapsed: true });
  }, { id: source.ids[0], members: source.ids.slice(1), windowId: source.id });
  expect((await tabs(popup)).filter((tab) => tab.windowId === source.id).map((tab) => tab.id)).toEqual(source.ids);
  await refresh(popup);
  await popup.locator('#merge-button').click();
  await expect.poll(async () => (await tabs(popup)).filter((tab) => source.ids.includes(tab.id!) && tab.windowId === windowId).length).toBe(3);
  const merged = await state(popup, windowId, 'all');
  expect(merged.windows).toHaveLength(1);
  expect(merged.tabs.filter((tab) => tab.pinned).map((tab) => tab.id)).toEqual([targetPin, source.ids[0]]);
  const group = merged.groups.find((item) => item.title === 'Launch research')!;
  expect(group).toMatchObject({ windowId, color: 'purple', collapsed: true });
  expect(merged.tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id)).toEqual(source.ids.slice(1));
  await expect(popup.locator('#undo-button')).toBeEnabled();
  await writeFile(testInfo.outputPath('before-undo.json'), JSON.stringify(await popup.evaluate(() => chrome.storage.session.get(null)), null, 2));
  await popup.locator('#undo-button').click();
  await expect.poll(async () => (await state(popup, windowId, 'all')).windows.length).toBe(2);
  await expect(popup.locator('#undo-button')).toBeHidden();
  const restored = await state(popup, windowId, 'all');
  const restoredSource = restored.tabs.find((tab) => tab.id === source.ids[0])!.windowId;
  expect(restoredSource).not.toBe(windowId);
  expect(restored.tabs.filter((tab) => tab.windowId === restoredSource).map((tab) => tab.id)).toEqual(source.ids);
  expect(restored.tabs.filter((tab) => tab.windowId === windowId).map((tab) => tab.id)).toEqual(targetBefore);
  expect(restored.tabs.find((tab) => tab.id === source.ids[0])?.pinned).toBe(true);
  expect(restored.groups.find((item) => item.title === 'Launch research')).toMatchObject({ windowId: restoredSource, color: 'purple', collapsed: true });
  const restoredGroup = restored.tabs.find((tab) => tab.id === source.ids[1])!.groupId;
  expect(restored.tabs.filter((tab) => tab.groupId === restoredGroup).map((tab) => tab.id)).toEqual(source.ids.slice(1));
});

test('selected sources and hostname exclusions restrict real group and merge operations', async ({ extension }) => {
  const { popup, windowId } = extension;
  await request(popup, { type: 'save-settings', settings: { ...DEFAULT_SETTINGS, excludedSites: ['locked.test'] } });
  const selected = await createWindow(popup, [
    'https://locked.test/Private', 'https://locked.test/Private', 'https://app.locked.test/Project',
    'https://notlocked.test/Plan', 'https://notlocked.test/References',
  ]);
  const unselected = await createWindow(popup, ['https://other.test/Leave-here']);
  await action(popup, windowId, 'close-duplicates', { scope: 'all' });
  await action(popup, windowId, 'group', { scope: 'all' });
  const before = await tabs(popup);
  expect(before.filter((tab) => selected.ids.slice(0, 3).includes(tab.id!)).map((tab) => tab.groupId)).toEqual([-1, -1, -1]);
  expect(before.find((tab) => tab.id === selected.ids[3])!.groupId).toBeGreaterThanOrEqual(0);
  await refresh(popup);
  await popup.locator('#merge-review summary').click();
  await ready(popup);
  await popup.locator(`#window-${unselected.id}`).uncheck();
  await expect(popup.locator('#merge-count')).toHaveText('1');
  await popup.locator('#merge-button').click();
  await expect.poll(async () => (await tabs(popup)).filter((tab) => selected.ids.slice(3).includes(tab.id!) && tab.windowId === windowId).length).toBe(2);
  const after = await tabs(popup);
  for (const id of selected.ids.slice(0, 3)) {
    expect(after.find((tab) => tab.id === id)).toMatchObject({ windowId: selected.id, groupId: -1 });
  }
  expect(after.find((tab) => tab.id === unselected.ids[0])).toMatchObject({ windowId: unselected.id });
  expect(after.filter((tab) => tab.windowId === selected.id).map((tab) => tab.id)).toEqual(selected.ids.slice(0, 3));
});

test('new tabs remain unchanged until a manual action; popup keyboard paths and screenshots', async ({ extension }) => {
  const { popup, windowId } = extension;
  const url = 'https://design.test/Interface-review';
  const ids = await createTabs(popup, windowId, [{ url, pinned: true }, { url }, { url: 'https://alpha.test/Project-plan' }]);
  await refresh(popup);
  const unchanged = (await tabs(popup)).map(({ id, index, windowId, groupId, pinned }) => ({ id, index, windowId, groupId, pinned }));
  const preview = await state(popup, windowId);
  expect(preview.undo).toBeNull();
  expect(preview.groups).toEqual([]);
  expect(preview.duplicateGroups[0]!.closeIds).toEqual([ids[1]]);
  expect((await tabs(popup)).map(({ id, index, windowId, groupId, pinned }) => ({ id, index, windowId, groupId, pinned }))).toEqual(unchanged);
  expect(preview.tabs.filter((tab) => ids.includes(tab.id!)).map((tab) => tab.id)).toEqual(ids);
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ready(popup);
  await popup.screenshot({ path: '.impeccable/review/popup-default-400.png' });
  await popup.locator('#options-button').focus();
  await popup.keyboard.press('Tab');
  await expect(popup.getByRole('radio', { name: 'This window' })).toBeFocused();
  await popup.keyboard.press('ArrowRight');
  await expect(popup.getByRole('radio', { name: 'All windows' })).toBeChecked();
  await ready(popup);
  await popup.locator('#duplicate-review summary').focus();
  await popup.keyboard.press('Enter');
  await expect(popup.locator('#duplicate-review')).toHaveAttribute('open', '');
  await ready(popup);
  const copy = popup.locator(`#duplicate-${ids[1]}`);
  await copy.focus();
  await popup.keyboard.press('Space');
  await expect(copy).not.toBeChecked();
  await popup.keyboard.press('Space');
  await expect(copy).toBeChecked();
  await expect(copy).toBeFocused();
  expect(await copy.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await ready(popup);
  await popup.screenshot({ path: '.impeccable/review/popup-review-400.png' });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await ready(popup);
  await popup.screenshot({ path: '.impeccable/review/popup-review-dark-400.png' });
  await ready(popup);
  await expect(popup.locator(`#tab-title-${ids[0]}`)).toBeEnabled();
  await popup.locator(`#tab-title-${ids[0]}`).press('Enter');
  await expect.poll(async () => (await tabs(popup)).find((tab) => tab.id === ids[0])?.active).toBe(true);
  expect((await tabs(popup)).filter((tab) => ids.includes(tab.id!))).toHaveLength(3);
});
