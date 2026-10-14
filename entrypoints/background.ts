import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { validateMessage, type Response } from '../utils/model';
import { errorText, handleRequest, runCommand } from '../utils/service';

function isExtensionSender(sender: Browser.runtime.MessageSender): boolean {
  if (sender.id !== browser.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === browser.runtime.id;
  } catch {
    return false;
  }
}

export default defineBackground({
  main() {
    const incognito = browser.extension.inIncognitoContext;
    browser.runtime.onMessage.addListener((input: unknown, sender, sendResponse) => {
      if (!isExtensionSender(sender)) {
        sendResponse({ ok: false, error: 'Only Tab tidy extension pages can send this request.' } satisfies Response<never>);
        return false;
      }
      let request;
      try {
        request = validateMessage(input);
      } catch (error) {
        sendResponse({ ok: false, error: errorText(error) } satisfies Response<never>);
        return false;
      }
      void handleRequest(request, incognito).then(
        (data) => sendResponse({ ok: true, data } satisfies Response<unknown>),
        (error: unknown) => sendResponse({ ok: false, error: errorText(error) } satisfies Response<never>),
      );
      return true;
    });
    browser.commands.onCommand.addListener((command) => {
      void runCommand(command, incognito).then(async (result) => {
        if (result.warnings.length) console.warn('Tab tidy command:', result.message, ...result.warnings);
        await browser.action.setBadgeText({ text: result.warnings.length ? '!' : '' });
        await browser.action.setTitle({ title: `${result.message}${result.warnings.length ? ' Open Tab tidy to review recovery.' : ''}` });
      }).catch(async (error: unknown) => {
        console.error('Tab tidy command:', errorText(error));
        try {
          await browser.action.setBadgeText({ text: '!' });
          await browser.action.setTitle({ title: `Tab tidy: ${errorText(error)}` });
        } catch (badgeError) {
          console.error('Tab tidy could not report the command error:', errorText(badgeError));
        }
      });
    });
  },
});
