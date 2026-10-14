# User guide

[← Overview](../README.md) · [Development](development.md) · [Known issues](known-issues.md)

> **Preview:** six confirmed defects remain open. Read [known issues](known-issues.md) before you rely on recovery.

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

Tab changes require a click or an assigned keyboard shortcut.
Browser events refresh the preview; they do not run actions.

## Duplicate tabs

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

## Tab groups

- Groups use the hostname, with a leading `www.` removed.
- `www.example.com` and `example.com` share a group; `mail.example.com` remains separate.
- Each new group requires at least two eligible tabs in one normal window.
- Options accepts a minimum group size from 2 to 20.
- Pinned tabs are not group targets.
- Existing groups stay intact by default; **Preserve existing groups** controls this group-by-site behavior.
- New groups start expanded unless **Collapse new groups** is enabled.
- The popup also offers **Ungroup tabs**, **Collapse groups**, and **Expand groups** for the selected scope.

## Sort

The default sort uses the site in ascending order.
Other modes use the title, URL, custom site priority, or the order of site encounters along the tab strip.
Site encounter order starts from the left or right, according to the saved direction.
Custom priority uses the hostname list in Options; the popup requires a nonempty list for this mode.
Equal sort values keep their previous relative order.

Sort keeps group blocks together and sorts their members.
**Order groups by name** enables group-title order.
Pinned tabs stay in place by default; **Also sort pinned tabs** sorts them within the pinned region.
Sort and whole-group merge retain group title, color, and collapse metadata in the verified scenarios.
Split-group merge has a [collapse-state defect](known-issues.md#confirmed-defects).
Sort skips popup windows with a warning.

## Merge windows

Merge gathers eligible source tabs into the current normal window.
It preserves pinned state and transfers tab groups.
Minimized and popup source windows are excluded by default; Options can include each explicitly.
An included single-tab popup uses a temporary normal window for the transfer.
A multi-tab popup remains intact and produces a warning.
Excluded tabs remain in the source window; a mixed group can split, with a warning.

## Excluded sites and special pages

The excluded-site list is empty by default.
Enter one hostname per line in Options.
`example.com` covers itself and subdomains such as `mail.example.com`, but not `notexample.com`.

| Action | Effect of an excluded site |
| --- | --- |
| Duplicate closure, group creation, ungroup, merge | Skip excluded tabs. |
| Sort | Treat an excluded tab, or its whole group, as a fixed block. |
| Collapse and expand | Skip any group that contains an excluded tab. |

Other tab moves can still shift tab indices.
Browser/internal pages and `file:` pages are not duplicate or site-group targets.
Sort and merge can move those pages where the browser permits the operation.

## Options and shortcuts

Open **Options** through the popup.
Select **Save options** to persist changes.
Select **Restore defaults** to save the defaults.
Popup scope changes apply to that popup session; Options controls the default scope.
The popup saves its selected sort mode when you execute Sort.
**Open browser shortcuts** opens `chrome://extensions/shortcuts` for the four primary actions.
No shortcut keys are assigned by default.

Defaults and validation live in [`utils/model.ts`](../utils/model.ts).
Invalid saved settings currently prevent the reset button from becoming available; see [known issues](known-issues.md).

## Undo and recovery limits

> **Undo is not a complete rollback guarantee.** The audit found [three recovery defects](known-issues.md#confirmed-defects).

The popup exposes recovery for the latest action only, separately for each browser context.
Structural recovery uses original stable tab IDs to restore tab positions, windows, pinned state, and groups.
It does not recreate tabs that you subsequently close.
Duplicate recovery reopens saved URLs; it cannot guarantee form contents or navigation history.

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
The extension opens no welcome, installation, update, or uninstall pages.

The manifest uses incognito `split` mode.
Chrome shares local settings between regular and incognito contexts; tab operations and recovery records keep separate context boundaries.
Enable **Allow in Incognito** in the browser's extension details to permit incognito use.
Incognito behavior has not been browser-tested in this project.

## Official references

- [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) and [tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome incognito modes](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)
