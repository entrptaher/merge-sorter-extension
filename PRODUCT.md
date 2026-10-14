# Tab tidy

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

WXT, as requested. The implementation uses TypeScript and native web controls. The initial target is Chromium Manifest V3, consistent with the three supplied Chrome extension archives.

## Users

People with many browser tabs and windows who need direct, simple control over their workspace.

## Product Purpose

Combine duplicate closure, tab sorting, site grouping, and window merging in one extension. Make common operations easy to reach from the toolbar.

## Operating Context

The toolbar popup operates on real browser tabs. Options remain separate from everyday actions. All tab changes require a user action. The user explicitly selected manual actions only.

## Capabilities and Constraints

- Close duplicate tabs, group tabs, sort tabs, and merge browser windows.
- Preserve useful functionality from the three supplied archives without copying their implementation or assets.
- Provide useful options without excessive complexity.
- Do not open welcome, installation, update, or uninstallation pages.
- Do not add automatic tab closure, automatic sorting, or automatic merging.
- Do not add accounts, external services, telemetry, achievements, or promotional pages.
- Use conservative defaults for tabs that are pinned, active, or playing audio.

## Brand Commitments

The user requires a simple, practical interface without hype or unnecessary complexity. Tab tidy is an implementation name, not a user-supplied brand.

## Evidence on Hand

- `/Users/developer/Downloads/cgfpgnepljlgenjclbekbjdlgcodfmjp.zip`: Simple Tab Sorter.
- `/Users/developer/Downloads/mmpokgfcmbkfdeibafoafkiijdbfblfg.zip`: Merge Windows.
- `/Users/developer/Downloads/lccfnphpgnpeghoffocbacbkohbapinm.zip`: Close Duplicate Tabs.
- The workspace is initially empty.

## Product Principles

1. Make the scope and effects of each action visible.
2. Protect valuable tabs and preserve existing groups by default.
3. Prefer direct actions and native controls over complex workflows.
4. Keep browser data local.
5. Report partial failures and provide recovery where possible.
