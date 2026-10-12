---
name: Dooo
description: Independent floating project cards for the Windows desktop.
colors:
  text: "#171717"
  ink: "#1e1e1e"
  muted: "#707070"
  line: "#e2e2e2"
  surface: "#ffffff"
  hover: "#eeeeee"
  accent: "#505050"
  danger: "#b62c3c"
  field: "#f4f4f4"
  field-active: "#eeeeee"
  focus-surface: "#dedede"
  complete: "#1e1e1e"
  status-text: "#505050"
  field-muted: "#636363"
  progress-track: "#e3e3e3"
  ring-coral: "#db5a45"
  ring-teal: "#258d91"
  ring-yellow: "#b47b15"
  ring-blue: "#3d74ce"
  ring-purple: "#805ec3"
  ring-green: "#428366"
typography:
  body:
    fontFamily: "Plus Jakarta Sans, Segoe UI, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  headline:
    fontSize: "14px"
    fontWeight: 750
  title:
    fontSize: "14px"
    fontWeight: 750
    lineHeight: "19px"
    letterSpacing: "-0.02em"
  task:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "20px"
  action:
    fontSize: "11px"
  label:
    fontSize: "10px"
    lineHeight: "15px"
rounded:
  card: "16px"
  palette: "14px"
  composer: "12px"
  task-menu: "9px"
  project-input: "8px"
  icon-button: "7px"
  field: "6px"
  menu-item: "5px"
  tag: "4px"
spacing:
  outer: "8px"
  header: "16px"
  task-inset: "14px"
components:
  floating-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
  project-summary:
    height: "102px"
    padding: "16px 22px 16px 16px"
  composer:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.composer}"
    padding: "8px 10px"
  submit:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.icon-button}"
    width: "30px"
    height: "30px"
  edge-toggle:
    backgroundColor: "{colors.surface}"
    width: "44px"
    height: "44px"
  control-palette:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.palette}"
    padding: "10px"
---

# Design System: Dooo

## Overview

**Creative North Star: "Floating white project cards"**

The user's supplied reference remains the visual authority for the outer cards: white rounded surfaces, thin dark outlines, hard downward shadows, and colored progress rings on the right. The latest refinement removes input borders and focus rings in favor of filled surfaces, and strengthens status text and progress. Each project is an independent transparent native window that can be dragged by its header. Clicking the header extends the same card downward to reveal its tasks.

**Key Characteristics:**

- Independent cards directly on the desktop.
- One continuous white surface from project summary through tasks.
- Restrained color, live progress and visible completion feedback.

Source: `src/renderer/css/base.css`, `css/app.css`, `css/dock.css`, `index.html`, `dock.html`, and `src/main/bounds.js`. Product behavior is described in `README.md`.

## Colors

Ink defines the outer outline, shadow and solid controls. Muted gray supports metadata; completion counts use darker status text. Fields use a neutral gray fill that deepens with focus. Keyboard focus uses a visible background change without an outline; retain the system focus outline in Windows high-contrast mode. Completed checks and fully completed project status use the standard dark ink. Red identifies destructive or overdue states. The deeper ring colors cycle by project and do not encode priority. Optional priority labels retain their existing pale red, amber and green treatments.

**The Truthful Progress Rule.** Counts and percentages derive from real project tasks. Show completed divided by total, rounded to a whole percentage; an empty project shows zero percent and “No tasks yet.” Keep the gray ring track visible and hide the colored arc at zero.

## Typography

Retain bundled Plus Jakarta Sans and the fallback stack above. Use the compact 10–14px hierarchy: bold project names, quieter task titles, small metadata and icon controls with accessible names and hover labels. Project names wrap to at most two lines; task titles wrap freely. Percentage numerals are 12px, weight 800, with tabular figures. Completion status is 11px at weight 600; task counts use weight 650.

## Layout

Each project owns one native transparent window with an 8px outer inset and no shared background. Default native width is 380px, with a 300–800px range constrained to the display. Collapsed height is 120px including the insets; the header is 102px. Expanded height defaults to 480px with a 280px minimum, also constrained to the display.

The task dropdown grows downward within the existing card. Task rows scroll above the bottom composer; optional details begin collapsed and expand upward within its available space. Keep the resize control at the expanded card's bottom-right. Completed rows move to the bottom, ordered from earliest to latest completion. Restoring a task returns it to its original manual position.

The plus can be dragged freely and snaps to either vertical screen edge within 24px. Its saved anchor belongs to the button, so opening or resizing the icon tray never shifts it. The 44px handle has 14px corners, peeks 8px at a screen edge, and can also be moved with arrow keys. The 180px-wide tray slides alongside it, chooses the available side, and stays inside the current display. Its default content is about 159px high; project entry and settings grow it only when requested. The native transparent window fits the handle and tray together.

Reference captures: `test-results/floating-expanded.png`, `floating-compact.png`, `compact-icon-tray.png`, and `compact-icon-tray-left.png`.

## Elevation & Depth

The white floating card, task menu and edge palette use a 1px ink outline and `0 3px 0 var(--ink)` shadow. The shadow is hard, unblurred and directly downward. Task rows use light separators inside the parent surface. The composer, optional fields, rename field and project-name entry use filled backgrounds with no border, outline or shadow.

**The Continuous Card Rule.** Preserve the project summary and dropdown as one white outlined silhouette. Do not introduce nested task cards or a surrounding dashboard.

## Shapes

The primary card uses the largest corner radius; the control palette and edge tab use the next step. Fields and small controls use the tighter radii above. Progress rings and 24px completion buttons are circular. Use simple outlined SVG icons. The edge tab rounds its inward corners when snapped; all four corners round when floating freely.

## Components

- **Project summary:** draggable and clickable, with copy on the left and a 56px ring on the right. The ring has a rounded 6px stroke, deeper project color and a stronger percentage. A small chevron conveys expansion; the minimize control appears on hover or keyboard focus.
- **Task rows:** plain separated rows, 52px minimum height, wrapping task title, optional metadata, quiet delete control and right-aligned check. Completed rows stay visible below unfinished tasks, with muted text and an animated strike.
- **Composer:** borderless filled field at the bottom, with a subtle background change while typing. The arrow-up action appears when typing and becomes a check while editing; the sliders and AI toggle share the input row on the right, with soft neutral active fills; the sliders reveal optional fields. Fields and controls show keyboard focus through their fill, with no nested outlines. Keep text and placeholder contrast readable on both resting and focused backgrounds.
- **AI wording:** a neutral sparkle toggle sits beside the sliders when the private AI service is configured. Tasks save immediately; a small inline spinner marks wording in progress without blocking the composer. A failed request keeps the original wording and reveals one quiet status line. Manual edits take precedence. Original wording is available through Undo and the title's hover label. Folder linking and context refresh remain icons inside the project menu.
- **Icon tray:** six 40px-high action buttons in a three-column grid; a compact footer holds colored project folder icons and a gear. Project names and actions appear in hover labels. The folder-plus reveals the name field; the gear reveals pin/startup toggles. Keep fields hidden by default and preserve the handle’s screen position.
- **Motion:** native expansion uses 240ms quartic ease-out. Dropdown opacity takes 180ms and its 6px movement takes 240ms; rings update in 360ms. Completion draws the check in 220ms, pops it over 300ms and strikes text in 220ms. Minimize fades in 150ms; the edge peek takes 260ms. The tray slides/scales over 280ms with 180ms opacity, and native contraction waits 200ms for the fade. Added tasks settle over 220ms; reordered tasks settle over 280ms from their current visual position. Undo sits in the task toolbar without changing list height. Respect reduced motion in both native resizing and CSS feedback.

## Do's and Don'ts

- **Do** preserve independent floating cards, the white outline-and-shadow silhouette and right-side rings.
- **Do** keep completed tasks visible at the bottom with clear check and strike feedback.
- **Do** use real data, readable wrapped titles, visible focus and display-constrained sizing.
- **Don't** restore the shared overview, back navigation, Personal sections, greetings or bottom navigation.
- **Don't** expose optional task details by default or put task rows in nested cards.

**Action labels.** Use icons for controls, with descriptive aria-label and title attributes. Keep task and project content readable. Optional field labels appear only when the user reveals the fields.
