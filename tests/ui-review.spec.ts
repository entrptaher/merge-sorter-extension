import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { DEFAULT_SETTINGS } from '../utils/model.ts';

declare const chrome: typeof import('wxt/browser').browser;

test('review: invalid stored settings must leave a usable reset path', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2]!;
    await worker.evaluate((settings) => chrome.storage.local.set({ settings }), {
      ...DEFAULT_SETTINGS, minimumGroupSize: 21,
    });
    const page = context.pages()[0]!;
    await page.goto(`chrome-extension://${id}/options.html`);
    await expect(page.locator('#settings-status')).toContainText('Could not read saved options');
    // The supported reset request works without loading the invalid settings.
    const resetResult = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'reset-settings' }));
    expect(resetResult).toMatchObject({ ok: true });
    await expect(page.locator('#settings-fields')).toBeEnabled();
    // Recreate the failure and check that a person can reach that same reset operation.
    await page.evaluate((settings) => chrome.storage.local.set({ settings }), {
      ...DEFAULT_SETTINGS, minimumGroupSize: 21,
    });
    await page.reload();
    await expect(page.locator('#settings-status')).toContainText('Could not read saved options');
    await expect(page.locator('#reset-button')).toBeEnabled();
  } finally {
    await context.close();
  }
});

test('review: repeated title updates must not starve manual actions', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 400, height: 600 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    await context.route('https://*.test/**', (route) => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: '<title>Review document</title><p>A tab with a changing title.</p>',
    }));
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2]!;
    const popup = context.pages()[0]!;
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.locator('#popup-main')).toHaveAttribute('aria-busy', 'false');
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto('https://document.test/review');
    await second.goto('https://document.test/review');
    await popup.bringToFront();
    await expect(popup.locator('#close-button')).toBeEnabled();
    await first.evaluate(() => {
      let count = 0;
      const timer = setInterval(() => { document.title = `Review document ${++count}`; }, 40);
      window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    });
    await expect.poll(() => first.title()).not.toBe('Review document');
    // URL and duplicate eligibility remain constant; only display text changes.
    await expect(popup.locator('#close-button')).toBeEnabled({ timeout: 3000 });
  } finally {
    await context.close();
  }
});
