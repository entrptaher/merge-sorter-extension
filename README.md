# Tab tidy

Tab tidy is a Chromium Manifest V3 extension with four manual actions:

- **Close duplicates:** review matching pages and close selected copies.
- **Group by site:** create native tab groups for related tabs.
- **Sort:** arrange tabs by site, title, URL, site priority, or site encounter order.
- **Merge windows:** move eligible tabs into the current window.

Tab changes require a click or an assigned keyboard shortcut.
Browser events refresh the preview; they do not run these actions.
The extension opens no welcome, installation, update, or uninstall pages.

## Install the built extension

The manifest requires Chrome/Chromium 121 or later.
Only Playwright's bundled Chromium has been tested; this is not a compatibility claim for every branded browser or version.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the `.output/chrome-mv3` directory.
5. Open **Tab tidy** from the browser toolbar.

The packaged archive is `.output/tab-tidy-1.0.0-chrome.zip`.
Extract the ZIP before you select **Load unpacked**.
Select the extracted directory that contains `manifest.json`.
Chrome does not install this ZIP directly through **Load unpacked**.

## Build from source

The tested environment uses Node.js 24 and pnpm 10.33.2.
`package.json` pins pnpm and the project dependencies.
Run these commands from the project root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm zip
```

The production extension appears in `.output/chrome-mv3`.
The ZIP appears in `.output/tab-tidy-1.0.0-chrome.zip`.
These commands do not require a development server.

## Use the popup

1. Select **This window** or **All windows**.
2. Review the action count and any duplicate or source-window selections.
3. Select the action button.
4. Read the result and any warnings.

**This window** is the default scope.
**All windows** covers accessible windows in the same regular or incognito context.
Normal and incognito tabs stay separate.
Duplicate checks can span windows; group and sort actions operate within each window.
Merge selects source windows independently of this scope and targets the current normal window.

**Review duplicates** lets you deselect copies before closure.
Select a duplicate title to focus its existing tab.
**Choose source windows** lets you deselect windows before a merge.
Counts describe the current preview; the service checks live state again before it acts.

## Action rules and defaults

### Duplicate tabs

- The default match uses the complete HTTP or HTTPS URL, including its query and fragment.
- HTTP and HTTPS remain distinct. A leading `www.` remains significant for duplicate matches.
- All active, pinned, and audible copies stay open by default, even when several copies have these protections.
- Without protected copies, the default keeps the most recently used copy.
- **Most recently used** and **Least recently used** compare `lastAccessed`, not tab creation time.
- Equal or absent access times use a stable window/tab order.
- Tabs without an eligible URL, or with a navigation in progress, are skipped.

**Ignore the #fragment** and **Ignore ?query parameters** are optional and disabled by default.
These options can treat different routes, searches, documents, or account pages as duplicates.
Query exclusion still preserves a fragment unless fragment exclusion is also enabled.

### Tab groups

- Groups use the hostname, with a leading `www.` removed.
- `www.example.com` and `example.com` share a group; `mail.example.com` remains separate.
- Each new group requires at least two eligible tabs in one normal window.
- Options accepts a minimum group size from 2 to 20.
- Pinned tabs are not group targets.
- Existing groups stay intact by default; **Preserve existing groups** controls this group-by-site behavior.
- New groups start expanded unless **Collapse new groups** is enabled.
- The popup also offers **Ungroup tabs**, **Collapse groups**, and **Expand groups** for the selected scope.

### Sort

The default sort uses the site in ascending order.
Other modes use the title, URL, custom site priority, or the order of site encounters along the tab strip.
Site encounter order starts from the left or right, according to the saved direction.
Custom priority uses the hostname list in Options; the popup requires a nonempty list for this mode.
Equal sort values keep their previous relative order.

Sort keeps group blocks together and sorts their members.
**Order groups by name** enables group-title order.
Pinned tabs stay in place by default; **Also sort pinned tabs** sorts them within the pinned region.
Sort and whole-group merge retain group title, color, and collapse metadata in the verified scenarios.
Split-group merge has a collapse-state defect described below.
Sort skips popup windows with a warning.

### Merge windows

Merge gathers eligible source tabs into the current normal window.
It preserves pinned state and transfers tab groups.
Minimized and popup source windows are excluded by default; Options can include each explicitly.
An included single-tab popup uses a temporary normal window for the transfer.
A multi-tab popup remains intact and produces a warning.
Excluded tabs remain in the source window; a mixed group can split, with a warning.

### Excluded sites and special pages

The excluded-site list is empty by default.
Enter one hostname per line in Options.
`example.com` covers itself and subdomains such as `mail.example.com`, but not `notexample.com`.
Duplicate closure, group creation, ungroup, and merge skip excluded tabs.
Sort treats an excluded tab, or its whole group, as a fixed block.
Collapse and expand skip any group that contains an excluded tab.
Other tab moves can still shift tab indices.

Browser/internal pages and `file:` pages are not duplicate or site-group targets.
Sort and merge can move those pages where the browser permits the operation.

## Options and shortcuts

Open **Options** through the popup.
Select **Save options** to persist changes or **Restore defaults** to save the defaults.
Popup scope changes apply to that popup session; Options controls the default scope.
The popup saves its selected sort mode when you execute Sort.
**Open browser shortcuts** opens `chrome://extensions/shortcuts` for the four primary actions.
No shortcut keys are assigned by default.

## Undo and recovery limits

The popup exposes recovery for the latest action only, separately for each browser context.
Structural recovery uses original stable tab IDs to restore tab positions, windows, pinned state, and groups.
It does not recreate tabs that you subsequently close.
Duplicate recovery reopens saved URLs; it cannot guarantee form contents or navigation history.
The audit found recovery defects listed below. Do not treat the current Undo as a complete rollback guarantee.

Recovery snapshots use Chrome's memory-only `storage.session` area.
They survive popup closure and service-worker idling.
They do **not** survive a browser restart or an extension reload, update, or disable.
This lifetime follows the [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session).

Actions and recovery can complete partially if browser state changes or an API call fails.
The service retains incomplete recovery records for an explicit manual retry.
A subsequent action can replace the latest record, including an incomplete record.
There is no automatic retry or full transactional undo guarantee.

## Local data and permissions

The manifest requests exactly these permissions:

| Permission | Purpose |
| --- | --- |
| `tabs` | Read tab URLs and titles for the preview and action decisions. |
| `tabGroups` | Read and change native group metadata and positions. |
| `storage` | Save local options and the temporary recovery record. |

There are no host permissions, content scripts, telemetry, accounts, or remote server.
Complete tab URLs occur in transient browser state and memory-only recovery snapshots, not persistent local settings.
Settings use `storage.local`, including site-priority and excluded-hostname lists.
The browser remains the source of truth; settings and recovery are not a tab database.

The manifest uses incognito `split` mode.
Chrome shares local settings between regular and incognito contexts; tab operations and recovery records keep separate context boundaries.
Enable **Allow in Incognito** in the browser's extension details to permit incognito use.

## Maintainer map

| Path | Responsibility |
| --- | --- |
| `wxt.config.ts` | Manifest, permissions, icons, and manual commands. |
| `entrypoints/background.ts` | Sender checks, request validation, and command dispatch. |
| `entrypoints/popup/` | Preview, selections, actions, feedback, and recovery controls. |
| `entrypoints/options/` | Options form, validation, explicit save/reset, and shortcut access. |
| `utils/model.ts` | Shared types, defaults, validation, duplicate rules, group and sort plans. |
| `utils/service.ts` | Live browser reads, serial requests, native mutations, and recovery. |
| `utils/client.ts` | Typed message request and response handling. |
| `assets/`, `public/` | Shared CSS and original extension icons. |
| `tests/`, `playwright.config.ts` | Node model checks and isolated browser scenarios. |
| `PLAN.md`, `PRODUCT.md`, `DESIGN.md` | Scope, product requirements, and interface decisions. |

Request flow: preview → validated request → live browser state → recovery snapshot → awaited native API operations → result and refresh.
The background service serializes requests and saves recovery before tab mutations.

## Verification and known issues

Run `pnpm check` for TypeScript checks and `pnpm test` for the Node model tests.
Run `pnpm build` before `pnpm test:e2e`; browser tests load the production output.
If the browser is absent, run `pnpm exec playwright install chromium` before the browser tests.
Tests use isolated profiles, actual extension APIs, and fixture websites; no development server is required.
The popup is an extension page at a 400px viewport width, not the native toolbar popup with its real closure lifetime.

The baseline has six passing model tests and seven passing original browser scenarios.
The broader audit added fourteen checks: seven workflow passes, six failed regression checks, and one focus-state observation.
TypeScript also passes with `--noUnusedLocals --noUnusedParameters`.
The production build and ZIP integrity check pass. These results do not imply that every behavior is correct.

The added checks cover group controls, scope, custom sorts, minimized and single-tab popup windows, and recovery after manual changes.
Incognito behavior, worker interruption, high tab counts, multi-tab popups, and the native toolbar-popup lifetime remain unverified.

### Confirmed defects

| Issue | Reproduction and consequence | Runnable evidence |
| --- | --- | --- |
| Previous recovery is lost after a zero-change failure | Close a duplicate, then reject one group-collapse call. The useful close record becomes an empty collapse record. | `tests/review.spec.ts`, recovery boundary B |
| A retry adopts an unrelated window | Reject one window-create call during Undo, move its seed tab elsewhere, then retry. The unrelated window receives the source bounds and activation. | `tests/review.spec.ts`, recovery boundary C |
| Undo reports success with incorrect placement | Group separated same-site tabs, move the group to the start, then Undo. Original neighbor placement is wrong, but recovery is erased. | `tests/review.spec.ts`, recovery boundary A |
| Split-group merge expands the excluded source half | The destination keeps the original collapse state; the surviving source group expands. Undo does restore the original group. | `tests/review.spec.ts`, split-group test |
| Frequent title updates disable popup actions | Each update restarts a 140ms delay. A document-title change every 40ms prevents a usable preview. | `tests/ui-review.spec.ts`, repeated-title test |
| Invalid settings block the reset control | An out-of-range saved value prevents Options from loading. Reset works through the service, but its button stays disabled. | `tests/ui-review.spec.ts`, invalid-settings test |

Boundary B and C explicitly inject one rejected API call in an isolated service worker, then restore the native method.
Other browser operations remain native. These tests prove error-path defects, not that Chrome always rejects those calls.
The remaining regressions use native APIs with controlled tabs, titles, or persisted settings.
The failed assertions remain active so these defects cannot appear as a passing suite.

One additional observation concerns focus: Undo does not restore the original active tab in a source window that survived the merge.
That behavior is outside the current documented recovery guarantees and needs an explicit product decision.

## Official references

- [WXT project structure](https://wxt.dev/guide/essentials/project-structure.html) and [entrypoints](https://wxt.dev/guide/essentials/entrypoints.html)
- [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) and [tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage) and [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome incognito modes](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)
- [Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions)
