# Development

[← Overview](../README.md) · [User guide](guide.md) · [Known issues](known-issues.md)

## Tools and build

The tested environment uses Node.js 24 and pnpm 10.33.2.
[`package.json`](../package.json) pins pnpm and the project dependencies.
The project uses WXT, TypeScript, native HTML/CSS, Node tests, and Playwright.

Run commands from the project root.

| Command | Purpose |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install the pinned dependencies. |
| `pnpm build` | Build the production extension into `.output/chrome-mv3`. |
| `pnpm zip` | Create `.output/tab-tidy-1.0.0-chrome.zip` locally. |
| `pnpm check` | Prepare WXT types and check TypeScript. |
| `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters` | Check unused symbols after WXT preparation. |
| `pnpm test` | Run the Node model tests. |
| `pnpm exec playwright install chromium` | Install Playwright's Chromium when it is absent. |
| `pnpm test:e2e` | Run all browser checks against the production build. |
| `pnpm test:e2e tests/extension.spec.ts` | Run the seven original browser scenarios. |
| `pnpm test:e2e tests/review.spec.ts tests/ui-review.spec.ts` | Run the broader audit, including active failure regressions. |
| `unzip -t .output/tab-tidy-1.0.0-chrome.zip` | Check the generated ZIP's integrity. |
| `node scripts/capture-readme.mjs` | Capture the documentation screenshots from the production build. |

The build, tests, and screenshot workflow require no development server.
The build output and ZIP are generated locally; the repository does not supply them as downloads.
See [Quick start](../README.md#quick-start) for **Load unpacked** instructions.

## Validation sequence

The full browser suite currently contains [six known failed regressions](known-issues.md).
The original scenarios alone do not establish a clean result for the full suite.

1. Run `pnpm check`.
2. Run `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters`.
3. Run `pnpm test`.
4. Run `pnpm build`.
5. Run `pnpm test:e2e`.
6. Run `pnpm zip`.
7. Run `unzip -t .output/tab-tidy-1.0.0-chrome.zip`.

Browser tests use isolated profiles, actual extension APIs, and fixture websites.
They do not use the user's browser profile.
The popup runs as an extension page at a 400px viewport width, not as the native toolbar popup.
That distinction does not reproduce the toolbar popup's real closure lifetime.

### Recorded audit results

These results describe the existing audit, not a new test run for the documentation update.

| Check | Recorded result |
| --- | --- |
| Node model tests | 6 passed. |
| Original browser scenarios | 7 passed. |
| Additional audit checks | 7 workflow passes, 6 failed regressions, 1 focus-state observation. |
| TypeScript | Passed, including `--noUnusedLocals --noUnusedParameters`. |
| Production build and ZIP integrity | Passed. |

The audit covers group controls, scope, custom sorts, minimized and single-tab popup windows, and recovery after manual changes.
Incognito behavior, worker interruption, high tab counts, multi-tab popups, and the native toolbar-popup lifetime remain unverified.
Only Playwright's bundled Chromium has been tested.
The manifest requires version 121 or later; this is not a compatibility claim for every branded browser or version.

## Documentation screenshots

1. Run `pnpm build`.
2. Run `node scripts/capture-readme.mjs`.
3. Inspect the five PNG files in [`docs/assets/`](assets/).

The capture uses the built extension in isolated Chromium with sample tabs.
Popup images show the extension page at popup dimensions, not the native toolbar popup.

| Asset | View |
| --- | --- |
| `docs/assets/popup-light.png` | Main popup, light theme. |
| `docs/assets/popup-dark.png` | Main popup, dark theme. |
| `docs/assets/duplicates.png` | Detail crop of duplicate review. |
| `docs/assets/merge-windows.png` | Detail crop of source-window selection. |
| `docs/assets/options.png` | Options page, cropped to scope, sort, and group settings. |

[`header.svg`](assets/header.svg) and [`workflow.svg`](assets/workflow.svg) are original documentation illustrations, not screenshots.
They use the project's palette, system fonts, and tab/check motif without external assets.

## Project map

| Path | Responsibility |
| --- | --- |
| [`wxt.config.ts`](../wxt.config.ts) | Manifest, permissions, icons, and manual commands. |
| [`entrypoints/background.ts`](../entrypoints/background.ts) | Sender checks, request validation, and command dispatch. |
| [`entrypoints/popup/`](../entrypoints/popup/) | Preview, selections, actions, feedback, and recovery controls. |
| [`entrypoints/options/`](../entrypoints/options/) | Options form, validation, explicit save/reset, and shortcut access. |
| [`utils/model.ts`](../utils/model.ts) | Shared types, defaults, validation, duplicate rules, group and sort plans. |
| [`utils/service.ts`](../utils/service.ts) | Live browser reads, serial requests, native mutations, and recovery. |
| [`utils/client.ts`](../utils/client.ts) | Typed message request and response handling. |
| [`assets/`](../assets/) · [`public/`](../public/) | Shared CSS and original extension icons. |
| [`tests/`](../tests/) · [`playwright.config.ts`](../playwright.config.ts) | Node model checks and isolated browser scenarios. |
| [`scripts/capture-readme.mjs`](../scripts/capture-readme.mjs) | Repeatable documentation screenshot capture. |
| [`PLAN.md`](../PLAN.md) · [`PRODUCT.md`](../PRODUCT.md) · [`DESIGN.md`](../DESIGN.md) | Scope, product requirements, and interface decisions. |

### Request flow

```text
Popup preview → validated request → live browser state
             → recovery snapshot → awaited native API operations
             → result and refresh
```

The background service serializes requests and saves recovery before tab mutations.
Browser events refresh the preview; tab mutations require a manual action.
There is no remote backend or database.
See the [user guide](guide.md#local-data-and-permissions) for storage and browser-context boundaries.

## Official references

- [WXT project structure](https://wxt.dev/guide/essentials/project-structure.html) and [entrypoints](https://wxt.dev/guide/essentials/entrypoints.html)
- [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) and [tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage) and [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome incognito modes](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)
- [Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions)
