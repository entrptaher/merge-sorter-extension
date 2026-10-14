# Tab tidy project rules

Read and obey `/Users/developer/AGENTS.md` and `/Users/developer/.config/opencode/AGENTS.md`.

## Scope

Build the unified Chromium extension described in `PLAN.md` and `PRODUCT.md`.
Use WXT, TypeScript, native HTML/CSS, pnpm, Node tests, and Playwright.
Use the supplied archives only as behavior references. Do not copy their code or assets.
All tab changes require a manual action. Do not add welcome, installation, update, or uninstall pages.
Do not start a development server. Test the production extension with Playwright and an isolated browser profile.

## Subagent Rules and Git Safety

- Subagents must not create nested agents.
- Subagents must not run any Git command.
- Preserve files outside the assigned write scope.
- Use the patch tool for source edits.
- Report changed files, checks, failures, and uncertainty honestly.
- The main agent owns `PLAN.md` and integration review.

## Package manager

Use pnpm. Do not create other lockfiles. Do not install global tools.

## Validation

Use focused Node tests for pure logic and Playwright for real extension behavior.
Use only isolated test tabs and windows. Never operate on the user's browser profile.
Do not claim browser checks passed when only mocks or source checks passed.
