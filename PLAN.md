# Tab tidy implementation plan

## Objective and exact scope

Create one WXT Chromium Manifest V3 extension for duplicate closure, grouping, sorting, and window merging.
Use a compact toolbar popup and a separate options page. Keep all changes manual and all data local.
Replicate useful behavior, not the source code, visual clutter, or promotional features of the supplied extensions.

## User Requirements and Corrections

| Requirement | Workflow and current problem | Required result | Validation |
| --- | --- | --- | --- |
| Use WXT | Empty workspace | Production WXT extension | Type check and production build |
| Inspect all three supplied ZIP files | Three separate extensions | Unified core behavior | Archive comparison and browser flows |
| Close duplicates, group, sort, merge windows | Tabs require separate tools | Four clear actions in one popup | Playwright with actual tab and window APIs |
| Easy to manage by click; nice options | Existing extensions have noisy controls | Compact task-first popup and useful grouped options | Screenshots, keyboard and interaction checks |
| Simple, smart, not overcomplicated | Risk of excessive features | Conservative defaults, visible scope, protected tabs, duplicate review | Edge-case Node tests and browser checks |
| No welcome, installation, or uninstallation pages | Archives open unwanted pages | No automatic pages at install, update, or removal | Production source/manifest guard and install tab-count check |
| Manual actions only | User explicitly selected this option | No automatic closure, grouping, sorting, or merging | No-change event checks |
| “use playwright and such. dont try to manually do everything.” | Validation and execution | Delegate production work and use Playwright | Real extension E2E report and screenshots |
| “Build the main extension before worrying about testing and checking.” | Work order | Complete the main extension before the test phase | Implement core and UI first; defer test files and test execution |
| Canceled the original core agent; requested a replacement and fast completion | Interrupted implementation | Preserve existing files, finish concrete gaps, build and verify promptly | Replacement agent, focused checks, production ZIP |
| Review the full implementation with fresh eyes, prepare a README, and assess whether everything is correct | System-wide review | Evidence-based mental model, assumptions, three approaches, tradeoffs, level-1 quality review, failure points, execution steps, and short summary | Source trace, official API documentation, targeted browser probes, README review |
| Create a private GitHub repository and push all completed work; keep the response short | Repository publication | Private repository with source, documentation, design assets, and tests | Confirm private visibility and matching local/remote commit |
| Add good README screenshots and a presentation like `https://github.com/vanila-io/wireflow` | Repository documentation | Branded overview, fresh screenshots, clear feature/navigation sections, and linked detailed docs | Real Playwright captures, local asset/link checks, and published README |
| Reject the “Preview — six known defects remain open” README banner | README presentation | Remove internal audit banners and defect-count summaries from the product overview | Inspect README and publish the correction |

Archive paths:
- `/Users/developer/Downloads/cgfpgnepljlgenjclbekbjdlgcodfmjp.zip` (Simple Tab Sorter).
- `/Users/developer/Downloads/mmpokgfcmbkfdeibafoafkiijdbfblfg.zip` (Merge Windows).
- `/Users/developer/Downloads/lccfnphpgnpeghoffocbacbkohbapinm.zip` (Close Duplicate Tabs).

Extracted behavior references: `/private/var/folders/9n/xt7dwvys3wj93m400m5pzrb00000gn/T/opencode/tab-tools-reference.az6KIX/`.

## Current and intended behavior

The workspace began empty. The archives offer URL/title/custom sorting, group-aware sorting, pinned-tab rules,
window exclusions, minimized/popup window controls, group preservation, duplicate review, and URL matching options.

The replacement offers those useful operations through a smaller interface. It omits automatic behavior,
achievements, statistics, sounds, donation links, icon customization, and source-specific suspended-tab integrations.
These omissions preserve the user's simple, manual-only constraint. Existing browser-discarded tabs remain normal tabs.

## Architecture and data flow

- `entrypoints/popup/`: compact UI with current/all-window scope, live action counts, duplicate review and selection, direct actions, last-action recovery, options link.
- `entrypoints/options/`: explicit save/reset, grouped settings, input validation, excluded sites, shortcut access.
- `entrypoints/background.ts`: synchronous listener registration and validated request dispatch. No tab mutation from browser events.
- `utils/model.ts`: shared types, defaults, settings validation, URL matching, eligibility, stable sort and grouping plans.
- `utils/service.ts`: browser reads, validated action execution, serial mutation queue, and recovery using session storage.
- `wxt.config.ts`: Chromium MV3, minimum required permissions (`tabs`, `tabGroups`, `storage`; `sessions` only if needed for native recovery).
- After the main extension is built, native Node tests verify pure decisions. Playwright loads `.output/chrome-mv3` in a separate persistent Chromium profile.

Flow: popup action → extension message → validate sender/request → reload browser state and settings →
validate live tab IDs and scope → save recovery state before mutation → await browser APIs →
report actual changes and partial failures → refresh the popup.

There is no remote backend, database, login, account, content script, external API, or job queue.
Browser permissions control access. Settings use local storage. Recovery data uses session storage and respects incognito separation.

## Business and safety rules

- Default scope: current window. Merge explicitly gathers eligible source windows into the current window regardless of the tab-action scope.
- Keep normal and incognito windows separate. Never move a tab across that boundary.
- Exact URL matching by default. Optional fragment/query exclusions are explicit. Never merge HTTP and HTTPS or unrelated query values by default.
- Ignore internal browser pages and missing/loading URLs for duplicate closure and site grouping.
- Protect pinned, active, and audible tabs from duplicate closure by default. Preserve all protected copies if several exist.
- Prefer the most recently accessed eligible copy, with a stable fallback. Allow least-recently-used preference.
- Review rows show actual removable copies. Selected closure revalidates every tab and duplicate relationship before removal.
- Group by hostname, ignoring a leading `www.` only for grouping/sorting. Require at least two tabs by default. Preserve existing groups by default.
- Sort by site, title, URL, or configured site priority. Preserve groups and their metadata. Keep pinned tabs in place unless enabled.
- Include original left/right site encounter-order choices if they can remain simple; otherwise site priority covers explicit custom ordering.
- Excluded hostnames match themselves and subdomains, not similarly named sites. Explain their exact action coverage in the UI.
- Merge preserves pinned state and group title/color/collapse state. Skip minimized and popup windows by default; expose explicit options.
- Serial execution prevents overlapping operations. Await all browser mutations. Do not report dispatch as completion.
- Recovery must survive worker suspension. Label duplicate recovery honestly if it reopens URLs rather than restoring page state.
- Preserve failed recovery records for retry. Avoid removing placeholder tabs until a replacement tab is present.
- Prefer correct conservative behavior over silent best-effort data loss. Report partial actions clearly.

## Implementation phases

### Phase 1: Core and project foundation

1. Create pnpm/WXT/TypeScript configuration and the shared model.
   - Expected: supported Chromium MV3 project and an explicit typed UI/service contract.
   - Validation: integration source review now; type check and Node tests in Phase 3, per the user's correction.
2. Implement browser state, safe actions, source feature parity, and recovery.
   - Expected: real browser behavior with live validation, metadata preservation, and honest failures.
   - Validation: source flow review now; Node and Playwright checks in Phase 3.
3. Register background handlers and optional manual commands.
   - Expected: actions require explicit messages or keyboard commands; installation opens no tabs.
   - Validation: production build after Phase 2; request and install checks in Phase 3.

Phase 1 and Phase 2 may proceed in parallel with non-overlapping write scopes and the fixed contract below.
Do not create or run tests before the main extension exists.

### Shared implementation contract

Core owns `utils/model.ts`, `utils/service.ts`, `entrypoints/background.ts`, and project/package configuration.
UI owns `entrypoints/popup/`, `entrypoints/options/`, `assets/`, `public/`, and `utils/client.ts`.

`utils/model.ts` exports:
- `Scope = 'current' | 'all'`.
- `Action = 'close-duplicates' | 'group' | 'sort' | 'merge' | 'ungroup' | 'collapse' | 'expand'`.
- `Settings` with fields: `scope`, `sortBy` (`site`, `title`, `url`, `custom`, `encounter`), `sortDirection` (`asc`, `desc`),
  `siteOrder: string[]`, `sortGroupsByTitle: boolean`, `sortPinned: boolean`, `preserveGroups: boolean`,
  `minimumGroupSize: number`, `collapseNewGroups: boolean`, `ignoreHash: boolean`, `ignoreQuery: boolean`,
  `keeper` (`recent`, `oldest`), `protectPinned: boolean`, `protectActive: boolean`, `protectAudible: boolean`,
  `excludedSites: string[]`, `mergeMinimized: boolean`, and `mergePopups: boolean`.
- `DEFAULT_SETTINGS`, `validateSettings(input)`, and `getSite(url): string | null`.
- `DuplicateGroup = { key: string; title: string; url: string; tabs: Browser.tabs.Tab[]; closeIds: number[]; keepIds: number[] }`.
- `ExtensionState = { tabs: Browser.tabs.Tab[]; windows: Browser.windows.Window[]; groups: Browser.tabGroups.TabGroup[];
  currentWindowId: number; settings: Settings; duplicateGroups: DuplicateGroup[]; mergeWindowIds: number[];
  undo: { label: string; kind: 'structure' | 'close' } | null }`.
  State tabs/windows/groups reflect the requested scope. `mergeWindowIds` always lists all eligible merge sources.
- `ActionResult = { message: string; changed: number; warnings: string[]; undoLabel: string | null }`.

Background messages use `{ok:true,data:T}` or `{ok:false,error:string}`:
- `{type:'get-state', windowId:number, scope:Scope}` → `ExtensionState`.
- `{type:'run-action', windowId:number, scope:Scope, action:Action, tabIds?:number[], windowIds?:number[]}` → `ActionResult`.
- `{type:'undo'}` → `ActionResult`.
- `{type:'get-settings'}` → `Settings`.
- `{type:'save-settings', settings:Settings}` → saved `Settings`.
- `{type:'reset-settings'}` → restored `Settings`.

Action overrides such as popup sort selection save settings through the existing save message before execution.
Duplicate `tabIds` restrict closure to selected safe removable copies. Missing `tabIds` closes the currently safe default copies.
Merge `windowIds` restrict sources; missing `windowIds` uses all eligible sources.
The core must revalidate IDs and boundaries. The UI must never claim a count is a completed change before the result arrives.

### Phase 2: Popup and options

1. Implement the task-first popup against the completed shared contract.
   - Expected: useful counts, scoped actions, duplicate selection, feedback, recovery, and options access.
   - Validation: Playwright interactions, focus checks, and popup screenshots.
2. Implement useful settings with the same visual system.
   - Expected: persistent validated choices, clear defaults, exclusions, and save/reset feedback.
   - Validation: save/reload and rejected-input browser checks; narrow-width screenshot.
3. Produce original extension icons without copying reference assets.
   - Expected: identifiable toolbar icon at required sizes.
   - Validation: production manifest and loaded extension.

### Phase 3: Integrated browser verification and delivery

1. Add and run Playwright checks using actual Chromium extension APIs, isolated test windows, and no development server.
   - Expected: deduplication, selection, protected copies, grouping, sorting, merging, options, and recovery proven end to end.
   - Validation: executable Playwright suite with an honest result record.
2. Inspect popup/options screenshots once, fix material defects in one batch, then confirm.
   - Expected: readable compact UI, consistent states, no clipping, and complete keyboard paths.
   - Validation: screenshot review and mechanical design detector.
3. Produce a build and ZIP.
   - Expected: loadable unpacked output plus an installable archive.
   - Validation: final type check, Node suite, Playwright suite, build and archive inspection.

## Likely files and protected areas

Likely files: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `wxt.config.ts`, `entrypoints/background.ts`,
`utils/model.ts`, `utils/service.ts`, `entrypoints/popup/*`, `entrypoints/options/*`, `assets/*`, `public/icon-*.png`,
`tests/*`, and `playwright.config.ts`.
Do not change supplied archives, user browser profiles, parent instructions, unrelated projects, or global tools.
The user now authorizes Git initialization, an initial commit, private GitHub repository creation, and push for this publication task.
Do not start a development server.

## Risks and material assumptions

- Initial target is Chromium because all references use Chrome APIs, including tabGroups.
- Use WXT with native TypeScript/HTML/CSS rather than an unnecessary UI framework.
- Browser tabs can change during an action; reload state and revalidate stable IDs.
- A browser can block a move or close. Count actual success and retain recovery data on failure.
- URL-based recovery cannot restore unsaved forms or full navigation history. Do not claim that it can.
- Custom third-party suspender behavior is intentionally excluded, not approximated with unsafe URL parsing.
- Context7 is unavailable in this session. Official WXT and Chrome documentation was retrieved through TinyFish instead.
- Cached Playwright Chromium exists. The global `chromium` command is broken; use Playwright's browser instead.

## Completion criteria

All requested manual operations work in one extension. The popup and options are fully connected.
Safe defaults, scope, exclusions, group metadata, pinned state, permissions, errors, persistence, and recovery are tested.
No automatic tab changes or unwanted pages exist. A production build and ZIP exist.
Report implemented-and-verified features separately from incomplete checks or intentional simplifications.

## Progress

- [x] Read all three manifests and relevant behavior sources.
- [x] Confirm manual-only behavior with the user.
- [x] Read official WXT and Chrome API documentation.
- [x] Record the user's Playwright and delegation correction.
- [x] Record the user's build-first correction and defer all tests until Phase 3.
- [x] Phase 1 implemented and source-reviewed. The production build succeeds; the six model checks pass.
- [x] Phase 2 implemented and source-reviewed, including stable duplicate-tab navigation. Runtime verification remains deferred to Phase 3.
- [x] Phase 3 build and package exist. Six model tests and all seven original browser scenarios passed, including focused reruns after fixes.
- [x] System-wide review and README complete. Six defects remain open; the regression suite deliberately exposes them.

## Current state and review scope

The replacement agent completed the core. The production output is `.output/chrome-mv3`.
The ZIP is `.output/tab-tidy-1.0.0-chrome.zip`. Type checks and six Node tests passed.
The seven original Playwright scenarios passed across the complete run and subsequent focused reruns.
That suite uses actual Chrome APIs in isolated Chromium, with synthetic website content and the popup opened as an extension page.
It does not prove real toolbar-popup lifetime, every optional mode, incognito behavior, interruptions, or high tab counts.

The prior tests found and drove fixes for two concrete defects:
1. URL recovery queried navigation too early and falsely reported failure. The service now records accepted navigation requests.
2. Merge read group metadata after its own tab movement changed activation/collapse state. It now retains pre-action metadata and destination activation.

The current review traces sibling operations for the same asynchronous and state-transition mistakes.
Read-only review and targeted test probes precede any proposed production changes. The deliverable includes `README.md` and an honest assessment.
Review steps: define state model; verify API semantics; inspect action/recovery/UI boundaries; reproduce suspected defects;
compare three bounded approaches; document supported behavior, limitations, and prioritized fixes; provide a short summary.

The UI detector reported one options hierarchy warning. Its report assumes 16px defaults and does not resolve the imported CSS.
Actual shared CSS defines 21px h1, 15.75px h2, and 14px body; confirm these sizes in the browser rather than changing them blindly.
Source review corrected recovery buttons to say `Undo:` for structural actions and changed the keeper label to `Least recently used`.
These changes and the compact popup spacing are included in the current build and ZIP.
Original icon files include an embedded PNG `Provenance` text chunk and `public/icon-provenance.json`.
The generic Impeccable scanner does not recognize that custom metadata key; source provenance is present and was inspected directly.

## System review evidence

### Confirmed interface defects

1. Invalid persisted settings disable the options form and `Restore defaults`.
   - Cause: `entrypoints/options/main.ts` requires non-null `savedSettings` for reset, although the reset service does not.
   - Reproduction: real `storage.local` contains `minimumGroupSize: 21`; open Options; the load error appears and reset remains disabled.
   - Evidence: `tests/ui-review.spec.ts`, `review: invalid stored settings must leave a usable reset path` fails at the enabled assertion.
   - Required correction: keep validation strict but allow the independent reset path after a load failure.

2. Frequent title updates prevent manual actions indefinitely.
   - Cause: every `tabs.onUpdated` event marks the entire preview stale and restarts a 140ms trailing debounce.
   - Reproduction: a real duplicate tab updates its document title every 40ms without changing its URL or eligibility.
   - Evidence: `review: repeated title updates must not starve manual actions` fails because `Close duplicates` remains disabled.
   - Required correction: bound refresh latency and separate display-only changes from changes that affect action eligibility.

These are review findings, not production fixes. Source behavior remains unchanged during the audit.

### Confirmed sibling merge defect

3. Splitting a mixed group during merge expands the excluded source half.
   - Cause: `mergeWindows` restores pre-action metadata only on the destination group.
   - Evidence: `tests/review.spec.ts` test `merge splits excluded group members and Undo restores both halves and metadata`.
   - Actual: the destination retains `collapsed: true`; the excluded source group becomes `collapsed: false`.
   - Undo restores the original membership, order, and metadata. No tabs disappeared in the reproduction.
   - Required correction: account for native activation side effects on both surviving group halves.

### Confirmed recovery boundary defects

- A zero-change API failure can replace useful previous recovery because the cleanup requires `work.failures === 0`.
- Structural recovery checks affected-tab relative order but can miss incorrect placement against unaffected original neighbors.
- A pending window intent treats a seed tab's changed window as proof that reconstruction created that window.
  A manual move can satisfy that condition and cause unrelated window metadata to be overwritten.
- Existing source windows do not receive the active-tab restoration applied to reconstructed windows.

Independent memory-based probes were followed by actual Chromium probes in `tests/review.spec.ts`.
Boundary A reproduced incorrect placement with native APIs: expected `[L,A,M,B,R]`, actual `[A,L,M,B,R]`, success reported, record erased.
Boundary B rejected exactly one `tabGroups.update` call: zero browser changes, prior close record replaced with an empty collapse record.
Boundary C rejected exactly one `windows.create` call, then moved the seed tab manually: retry adopted the unrelated window,
changed its bounds from `720×560` at `(20,20)` to `620×500` at `(0,0)`, changed activation, reported success, and erased recovery.
The two fault-injection tests restore the original method after the single rejection. Other APIs remain native.
Boundary D recorded the active-tab limitation in a surviving source window. It is a product-policy observation, not a claimed existing guarantee.

Final evidence: six baseline model tests passed; seven baseline browser scenarios passed; the fourteen additional checks produced
seven workflow passes, six failed regression checks, and one focus-state observation. Strict and unused-symbol TypeScript checks passed.
ZIP integrity passed. No production behavior was changed during this review. `README.md` records current features, limits, commands, and defects.

### Level-1 quality evidence

- `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters` passed after the audit tests compiled.
- All configured settings have consumers. No material unused production function was found in source review.
- Error logs serve keyboard-command failures; no routine telemetry or debug log path was found.
- Tab titles/URLs use `textContent`; the sole popup `innerHTML` assignment contains a static SVG literal.
- The package contains only extension files and original icon provenance, with the expected three permissions.
- Minor obsolete CSS remains: `--warning-surface` has no consumer, and `.feedback > .hint` has no current matching child.
- Stale plan status and two stale design-padding examples were corrected during documentation review.

### Approach comparison

1. Tighten existing recovery and refresh invariants. Preserve the small UI and native API architecture. Recommended.
2. Restore entire saved window layouts. Simpler exact-layout target, but it can overwrite unrelated later user choices.
3. Add a durable per-step journal. Stronger restart semantics, but substantially more state, privacy, and maintenance complexity.

Recommended subsequent implementation order: recovery ownership and prior-record retention; placement verification;
source/destination metadata; bounded popup refresh; reset access after invalid settings; focused regressions and release checks.
Each correction must first pass its concrete reproducer, then the connected action/undo scenarios.

## README presentation follow-up

The Wireflow reference uses a branded banner, prominent product screenshots, feature sections, a workflow graphic, and clear setup/developer sections.
Adapt those presentation patterns to Tab tidy without copying assets or implying that known defects are fixed.

1. Capture the current built extension with sample tabs through isolated Playwright Chromium.
   - Expected: real light/dark popup, duplicate review, source-window selection, and options images.
   - Validation: inspect the generated images and record their actual dimensions and fixture context.
2. Refine README into a short visual overview, with original header/workflow SVGs.
   - Expected: clear features, quick start, screenshots, and ordinary documentation links. The user rejected a leading internal audit banner.
   - Validation: check GitHub-compatible markup, local links, image paths, and factual claims.
3. Move detailed behavior, developer notes, and all six open defects into linked documentation.
   - Expected: useful detail remains accessible without overwhelming the README.
   - Validation: reconcile the moved content against the current README and audited code.
4. Publish the documentation changes to the existing private repository.
   - Expected: source and documentation share the same GitHub entry point.
   - Validation: verify the pushed commit and private repository visibility.

Write scope: README.md, docs/, scripts/capture-readme.mjs, and this plan. Production extension behavior remains outside this follow-up.

Presentation validation completed: five fresh Playwright screenshots, two original SVG illustrations, and three linked detail pages.
The screenshots use sample tabs in an isolated profile. Duplicate and merge views use truthful detail crops.
Both SVGs passed XML validation and visual inspection in Chromium. All 67 local references resolved.
GitHub's Markdown renderer retained all seven images and the expandable sections. All six known defects remain documented.
