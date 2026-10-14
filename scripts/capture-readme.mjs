import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const output = fileURLToPath(new URL('../docs/assets/', import.meta.url));
await mkdir(output, { recursive: true });
// An empty profile path creates an isolated temporary profile, never the user's profile.
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, deviceScaleFactor: 2,
  viewport: { width: 400, height: 600 }, colorScheme: 'light',
  args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
});
const samples = new Map([
  ['https://docs.test/wxt', 'WXT documentation'],
  ['https://docs.test/extensions', 'Extension guide'],
  ['https://notes.test/project', 'Project notes'],
  ['https://notes.test/release', 'Release checklist'],
  ['https://code.test/pull/42', 'Pull request · Tab tidy'],
  ['https://design.test/reference', 'Design reference'],
  ['https://mail.test/inbox', 'Inbox'],
  ['https://research.test/board', 'Design research'],
  ['https://research.test/palette', 'Color palette'],
  ['https://research.test/type', 'Typography reference'],
  ['https://team.test/inbox', 'Team inbox'],
  ['https://team.test/calendar', 'Team calendar'],
]);

async function ready(page) {
  await expect(page.locator('#popup-main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#refresh-button')).toBeEnabled();
  await expect(page.locator('#tab-summary')).toHaveText('9 tabs · 1 window');
}

async function capture(page, name, clip) {
  await page.locator('.app-header').scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  let previous = '', stable = 0;
  await expect.poll(async () => {
    const text = await page.locator('body').innerText();
    stable = text === previous ? stable + 1 : 0;
    previous = text;
    return stable;
  }, { intervals: [100] }).toBe(2);
  if (await page.locator('#popup-main').count()) await ready(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const path = `${output}${name}.png`;
  // Locator screenshots scroll the actual section into view without changing its CSS.
  const image = typeof clip === 'string'
    ? await page.locator(clip).screenshot({ path })
    : await page.screenshot({ path, fullPage: false, ...(clip ? { clip } : {}) });
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  console.log(`${name}.png: ${typeof clip === 'string' ? 'detail crop; ' : ''}${width / 2}×${height / 2} CSS px; ${width}×${height} image px`);
}

try {
  // These are sample tabs: synthetic UTF-8 website content, with real browser tab/window APIs.
  await context.route('https://*.test/**', (route) => {
    const title = samples.get(route.request().url());
    if (!title) return route.abort();
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>Sample workspace page.</p>` });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = worker.url().split('/')[2];
  const popup = context.pages()[0] ?? await context.newPage();
  // This is the actual built popup page at popup dimensions, not a toolbar flyout.
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#popup-main')).toHaveAttribute('aria-busy', 'false');
  const windowId = await popup.evaluate(async () => (await chrome.windows.getCurrent()).id);

  async function sampleTab(url, windowId, pinned = false, newWindow = false) {
    // Attach Playwright to about:blank before navigation so .test never needs DNS.
    const [page, tab] = await Promise.all([
      context.waitForEvent('page'),
      worker.evaluate(async ({ windowId, pinned, newWindow }) => {
        if (newWindow) {
          const window = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal' });
          return (await chrome.tabs.query({ windowId: window.id }))[0];
        }
        return chrome.tabs.create({ windowId, pinned, active: false, url: 'about:blank' });
      }, { windowId, pinned, newWindow }),
    ]);
    await page.goto(url);
    await expect(page).toHaveTitle(samples.get(url));
    return tab;
  }

  await sampleTab('https://docs.test/wxt', windowId, true);
  for (const url of ['https://notes.test/project', 'https://code.test/pull/42',
    'https://design.test/reference', 'https://docs.test/wxt', 'https://docs.test/extensions',
    'https://mail.test/inbox', 'https://notes.test/release']) await sampleTab(url, windowId);
  for (const urls of [
    ['https://research.test/board', 'https://research.test/palette', 'https://research.test/type'],
    ['https://team.test/inbox', 'https://team.test/calendar'],
  ]) {
    const first = await sampleTab(urls[0], undefined, false, true);
    for (const url of urls.slice(1)) await sampleTab(url, first.windowId);
  }
  await expect.poll(async () => worker.evaluate(async () =>
    (await chrome.tabs.query({})).filter((tab) => tab.status !== 'complete' || tab.pendingUrl).length)).toBe(0);
  await popup.bringToFront();
  await ready(popup);
  await expect(popup.locator('#duplicate-count')).toHaveText('1');
  await expect(popup.locator('#merge-count')).toHaveText('2');
  for (const id of ['close', 'sort', 'group', 'merge']) await expect(popup.locator(`#${id}-button`)).toBeEnabled();
  console.log('Workspace: 13 sample tabs + popup; 3 normal windows; current window: 8 sample tabs + popup.');
  console.log('Preview: 1 removable duplicate in a 2-copy set; 2 merge sources (3 and 2 tabs); sort/group enabled.');
  await capture(popup, 'popup-light');
  await popup.emulateMedia({ colorScheme: 'dark' });
  await ready(popup);
  await capture(popup, 'popup-dark');
  await popup.emulateMedia({ colorScheme: 'light' });
  await popup.locator('#duplicate-review summary').click();
  await ready(popup);
  await expect(popup.locator('.review-row')).toHaveCount(2);
  await expect(popup.locator('#duplicate-list input')).toHaveCount(1);
  await capture(popup, 'duplicates', '.duplicate-section');
  await popup.locator('#duplicate-review summary').click();
  await popup.locator('#merge-review summary').click();
  await ready(popup);
  await expect(popup.locator('#merge-list')).toContainText('3 tabs · Design research');
  await expect(popup.locator('#merge-list')).toContainText('2 tabs · Team inbox');
  await capture(popup, 'merge-windows', '.merge-section');

  const [options] = await Promise.all([context.waitForEvent('page'), popup.locator('#options-button').click()]);
  await options.waitForURL('**/options.html');
  await options.setViewportSize({ width: 1000, height: 1000 });
  await expect(options.locator('#settings-fields')).toBeEnabled();
  await expect(options.locator('#options-main')).toHaveAttribute('aria-busy', 'false');
  await expect(options.locator('#scope')).toHaveValue('current');
  await expect(options.locator('#sortBy')).toHaveValue('site');
  await expect(options.locator('#minimumGroupSize')).toHaveValue('2');
  const groups = await options.locator('[aria-labelledby="groups-heading"]').boundingBox();
  const saveBar = await options.locator('.save-bar').boundingBox();
  const height = Math.ceil(groups.y + groups.height);
  expect(height).toBeLessThan(saveBar.y);
  // A truthful top crop shows Scope and sort + Tab groups, before the sticky save bar.
  await capture(options, 'options', { x: 0, y: 0, width: 1000, height });
} finally {
  await context.close();
}
