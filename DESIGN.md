---
name: Tab tidy
description: Compact native controls for manual tab actions.
colors:
  surface: "#f0f4f5"
  panel: "#ffffff"
  surface-soft: "#e8eff0"
  ink: "#20342e"
  muted: "#526861"
  line: "#cbd8d3"
  accent: "#21533e"
  accent-hover: "#173d2d"
  on-accent: "#f5fcf7"
  header: "#173f30"
  header-muted: "#d0e2d7"
  selected: "#dceae1"
  focus: "#397e5b"
  danger: "#9a332d"
  danger-surface: "#f9eeeb"
  warning: "#775520"
  warning-surface: "#f6f0e3"
  dark-surface: "#182320"
  dark-panel: "#202e28"
  dark-surface-soft: "#293a32"
  dark-ink: "#e5eee8"
  dark-muted: "#b2c4b9"
  dark-line: "#465b4e"
  dark-accent: "#a1d3b2"
  dark-accent-hover: "#b8e1c6"
  dark-on-accent: "#183425"
  dark-header: "#123226"
  dark-header-muted: "#c4dacf"
  dark-selected: "#344f3e"
  dark-focus: "#a1d3b2"
  dark-danger: "#ffb0a7"
  dark-danger-surface: "#422c28"
  dark-warning: "#efd299"
  dark-warning-surface: "#3b3425"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  headline:
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.3
  title:
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.4
  brand:
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.3
  label:
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.5
  button:
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.25
  hint:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  status:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  radius: "8px"
  scope-option: "6px"
  badge: "4px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-6: "24px"
  space-8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.radius}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.radius}"
    padding: "8px 12px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    typography: "{typography.button}"
    rounded: "{rounded.radius}"
    padding: "4px 0"
  button-header:
    backgroundColor: "transparent"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.radius}"
    padding: "8px"
    width: "36px"
  select:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.radius}"
    padding: "8px 32px 8px 12px"
    width: "100%"
  textarea:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.radius}"
    padding: "8px 12px"
    width: "100%"
  scope-option-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.scope-option}"
    padding: "8px"
  tab-badge:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.badge}"
    padding: "2px 4px"
  tab-badge-close:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.accent}"
  feedback:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.status}"
    padding: "8px 16px"
---

# Design System: Tab tidy

## Overview

Tab tidy uses a compact, practical interface with native system typography, forest-green actions, pale surfaces, and aligned counts. Popup and options share controls.

**Key Characteristics:**
- Native controls and direct manual actions.
- Compact rows, restrained borders, and line icons.
- Shared light and dark themes.

This record extracts source values from `assets/tidy.css`, `entrypoints/popup/style.css`, and the popup/options markup. It does not establish visual QA results.
Product constraints remain in `PRODUCT.md`; the surface contract remains in `.impeccable/surfaces/entrypoints-popup-index-html.md`.

## Colors

Forest green supplies the primary action, links, and header. Neutral tokens distinguish the page, controls, text, hints, and dividers.
The selected scope uses `panel`; selected removable-tab badges use `selected` with `accent` text.
Errors use `danger`; warnings use `warning`. Options caution notes pair `danger` with `danger-surface`.
`warning-surface` exists in the source but has no current component use.

`prefers-color-scheme: dark` replaces the corresponding CSS variables with the `dark-` values above. The component references describe the light defaults.
Dark actions use a pale green fill and dark text. Header text remains the light `on-accent` value in both themes.
Header hover overlays and focus exceptions remain literal values in the sidecar snippets.

## Typography

All interface text uses the native system stack. Controls inherit it; no web font exists.
The options page uses `headline` and `title`; the identity label uses `brand`.
Popup labels and status text use compact sizes. Supporting popup text reaches 11px; tab badges use 10px.
Counts use tabular numerals. Long tab titles, URLs, and feedback wrap rather than force horizontal growth.

## Layout

The popup is 400px wide, with a 320px minimum and a 600px maximum height. Its content scrolls vertically.
At widths through 399px, it uses `100vw` while retaining the minimum width.
Action rows use `72px minmax(0, 1fr) 64px` columns, reduced to `64px minmax(0, 1fr) 60px` at that breakpoint.
Popup sections generally use 16px horizontal insets. Feedback reserves at least 48px.

Options use centered header and content containers with a 760px maximum width. The content has 24px horizontal insets and a 32px top inset.
At widths through 480px, horizontal insets become 16px and paired fields become one column. The save bar remains sticky at the bottom.
Standard controls have a 36px minimum height; the duplicate action has a 44px minimum height.
Coarse pointers increase buttons, selects, number inputs, and checkbox-label targets to a 44px minimum height.

## Elevation & Depth

The source defines no shadows, gradients, transitions, or animations. Surface colors and one-pixel borders separate regions.
The options save bar uses the page surface and a top border rather than a shadow.

## Shapes

Controls use `radius`; scope options use the smaller inset radius. Count boxes and tab badges use `badge`.
Checkboxes and radio controls retain native appearance and measure 16px. Most controls have a one-pixel `line` border.
Line SVG icons use an 18px box, a 1.75-unit stroke, rounded caps and joins, and no fill.
The identity icon uses a 28px box; review markers use 16px.

## Components

- **Buttons:** Primary actions use the accent pair. Secondary actions use `panel`, then `surface-soft` on hover and `selected` while active.
- **Text actions:** Recovery and retry use transparent controls with accent text and an underline on hover.
- **Focus:** Controls use a 2px `focus` outline with a 3px offset. Scope options use a 1px offset; header focus stays pale green.
- **Disabled states:** Buttons use 0.48 opacity. Fields and scope options use 0.6 opacity. Controls become unavailable during relevant busy or stale states.
- **Scope:** Native radios form a two-option strip. The selected option receives a panel fill; focus remains distinct from selection.
- **Duplicate review:** Checkboxes select removable copies and update the action count. Text badges distinguish `Close`, `Keep`, and `Protected`.
- **Empty states:** Plain text explains absent duplicates or eligible source windows. The associated action remains disabled when there is no valid target.
- **Feedback:** A stable region contains status text, warning details, and conditional recovery or retry controls. The status region uses polite live announcements.
- **Options:** Native fields, disclosure sections, default notes, and the sticky save bar share the popup palette and control geometry.
- **Icons:** `public/icon-provenance.json` records original artwork, no external assets, and the source `assets/create-icons.py`.
  The original two-tab/check motif appears on a forest-green rounded square in `public/icon-{16,32,48,128}.png`.
  The generator uses 4× supersampling and embeds provenance in each PNG. The header uses the same motif as inline SVG.

## Do's and Don'ts

- Do retain the native system font, shared tokens, and compact control geometry.
- Do preserve visible counts, text state labels, and keyboard focus.
- Do keep popup and options controls visually consistent across both themes.
- Don't add promotional surfaces or decorative controls.
- Don't copy code or assets from the supplied reference extensions.
