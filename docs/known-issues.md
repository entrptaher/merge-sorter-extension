# Known issues

[← Overview](../README.md) · [User guide](guide.md) · [Development](development.md)

**Status: all six defects below remain open and are not fixed.**
The failed assertions remain active so these defects cannot appear as a passing suite.
The documentation update does not change extension behavior.

## Confirmed defects

| Issue | Reproduction and consequence | Runnable evidence |
| --- | --- | --- |
| **Previous recovery is lost after a zero-change failure** | Close a duplicate, then reject one group-collapse call. The useful close record becomes an empty collapse record. | [`tests/review.spec.ts`](../tests/review.spec.ts), recovery boundary B |
| **A retry adopts an unrelated window** | Reject one window-create call during Undo, move its seed tab elsewhere, then retry. The unrelated window receives the source bounds and activation. | [`tests/review.spec.ts`](../tests/review.spec.ts), recovery boundary C |
| **Undo reports success with incorrect placement** | Group separated same-site tabs, move the group to the start, then Undo. Original neighbor placement is wrong, but recovery is erased. | [`tests/review.spec.ts`](../tests/review.spec.ts), recovery boundary A |
| **Split-group merge expands the excluded source half** | The destination keeps the original collapse state; the surviving source group expands. Undo does restore the original group. | [`tests/review.spec.ts`](../tests/review.spec.ts), split-group test |
| **Frequent title updates disable popup actions** | Each update restarts a 140ms delay. A document-title change every 40ms prevents a usable preview. | [`tests/ui-review.spec.ts`](../tests/ui-review.spec.ts), repeated-title test |
| **Invalid settings block the reset control** | An out-of-range saved value prevents Options from loading. Reset works through the service, but its button stays disabled. | [`tests/ui-review.spec.ts`](../tests/ui-review.spec.ts), invalid-settings test |

## Evidence names

The exact test names in [`tests/review.spec.ts`](../tests/review.spec.ts) are:

- `recovery boundary B: FAILURE INJECTION preserves close recovery after zero-change collapse failure`
- `recovery boundary C: FAILURE INJECTION rejects ambiguous window adoption after a failed create`
- `recovery boundary A: native Undo restores exact placement around untouched neighbors`
- `merge splits excluded group members and Undo restores both halves and metadata`

The exact test names in [`tests/ui-review.spec.ts`](../tests/ui-review.spec.ts) are:

- `review: repeated title updates must not starve manual actions`
- `review: invalid stored settings must leave a usable reset path`

Boundary B and C explicitly inject one rejected API call in an isolated service worker, then restore the native method.
Other browser operations remain native.
These tests prove error-path defects, not that Chrome always rejects those calls.
The remaining regressions use native APIs with controlled tabs, titles, or persisted settings.

### Recorded recovery details

- **Boundary A:** expected order `[L,A,M,B,R]`; actual order `[A,L,M,B,R]`. Undo reported success and erased recovery.
- **Boundary B:** one rejected `tabGroups.update` call caused zero browser changes, but replaced the previous close record.
- **Boundary C:** one rejected `windows.create` call preceded a manual seed-tab move. Retry adopted the unrelated window.
  Its bounds changed from `720×560` at `(20,20)` to `620×500` at `(0,0)`; activation changed and recovery was erased.
- **Split-group merge:** the destination retained `collapsed: true`; the excluded source group became `collapsed: false`.
  Undo restored membership, order, and metadata. No tabs disappeared in the reproduction.

## Focus observation

Undo does not restore the original active tab in a source window that survived the merge.
This behavior is outside the current documented recovery guarantees and needs an explicit product decision.
It is an additional observation, not a seventh confirmed defect.

Evidence: [`tests/review.spec.ts`](../tests/review.spec.ts),
`recovery boundary D: observe active-tab restoration in a surviving source window`.

## Run the audit

Run these commands from the project root after dependency installation:

```sh
pnpm build
pnpm test:e2e tests/review.spec.ts tests/ui-review.spec.ts
```

The recorded audit added fourteen checks: seven workflow passes, six failed regressions, and one focus-state observation.
The baseline had six passed Node model tests and seven passed original browser scenarios.
See [Development](development.md#recorded-audit-results) for the full command list, recorded checks, and coverage limits.
