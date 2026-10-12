---
name: Dooo Phone
description: Dooo project cards and explicit PC approvals in an installable phone workspace.
colors:
  ink: "#1e1e1e"
  control: "#242424"
  control-hover: "#414141"
  outline: "#292929"
  canvas: "#f4f4f4"
  surface: "#ffffff"
  muted: "#656565"
  completed: "#757575"
  field: "#f0f0f0"
  field-active: "#e7e7e7"
  quiet: "#ededed"
  separator: "#e8e8e8"
  ring-track: "#e4e4e4"
  focus: "#505050"
  ring-coral: "#db5a45"
  ring-teal: "#258d91"
  ring-yellow: "#b47b15"
  ring-blue: "#3d74ce"
  ring-purple: "#805ec3"
typography:
  headline:
    fontFamily: "Jakarta, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Jakarta, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 750
    lineHeight: 1.4
  body:
    fontFamily: "Jakarta, Segoe UI, sans-serif"
    fontSize: "13px"
    lineHeight: 1.65
  input:
    fontFamily: "Jakarta, Segoe UI, sans-serif"
    fontSize: "14px"
  label:
    fontFamily: "Jakarta, Segoe UI, sans-serif"
    fontSize: "12px"
    lineHeight: 1.65
  navigation:
    fontFamily: "Jakarta, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 650
rounded:
  card: "16px"
  panel: "14px"
  composer: "12px"
  control: "10px"
spacing:
  tight: "4px"
  compact: "8px"
  field: "10px"
  inset: "12px"
  regular: "16px"
  outer: "18px"
  header: "20px"
components:
  button-solid:
    backgroundColor: "{colors.control}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-solid-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.surface}"
  button-quiet:
    backgroundColor: "{colors.quiet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-icon:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    width: "44px"
    height: "44px"
  task-composer:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
    padding: "4px 5px 4px 12px"
  navigation-selected:
    backgroundColor: "{colors.control}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  project-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  approval-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "18px"
---

# Design System: Dooo Phone

## Overview

**Creative North Star: "Floating white project cards"**

The phone workspace extends the incumbent Dooo world: continuous white project cards, fine dark edges, hard downward shadows, neutral filled inputs and colored progress rings. It retains the familiar card silhouette while placing it in a single scrolling column on a quiet gray canvas.

This is an operating interface. Project content and the next concrete action carry the hierarchy. The Computer view uses the same card material for approvals, with the observed PC screen directly above the decision. Color stays sparse; wording distinguishes work in progress, an action awaiting approval and a result awaiting human review.

**Key Characteristics:**

- Continuous white cards with a fine dark edge and a hard downward shadow.
- Compact Jakarta typography, wrapping task content and neutral borderless composers.
- Truthful colored progress rings and visible completed tasks.
- Top navigation and a screen-before-approval sequence.

Scope: this document governs `apps/web`, extending the incumbent root `DESIGN.md` without replacing its desktop rules. Evidence: `public/app.css`, `public/app.js`, `public/index.html` and the phone review captures under the root `.impeccable/review/phone`. Tokens above are extracted from the shipped source. The bundled Plus Jakarta Sans asset is exposed locally as `Jakarta`; install icons derive from the incumbent `src/assets/icon.png` and retain embedded provenance.

## Colors

The palette is predominantly neutral, with ink defining controls and card edges and a small cyclic color family identifying project progress.

### Primary

- **Control ink:** solid actions, the selected top tab, completed checks and the hard card shadow. Its hover shade preserves the same quiet character.
- **Project coral, teal, ochre, blue and purple:** cycle through projects in order. They identify projects, not severity or priority.

### Neutral

- **Quiet canvas and white surface:** distinguish the page from its project and approval cards.
- **Text ink and muted gray:** separate actionable content from counts, device state and supporting copy.
- **Filled field and active fill:** show entry and focus without nesting outlined fields inside cards.
- **Separator, completion gray and ring track:** keep rows and incomplete progress legible without additional containers.

Status-only colors remain local to their meaning: a warm dot calls attention to pending approval, red identifies stop/denial-related emphasis, and the action marker distinguishes a proposed screen coordinate. Do not reuse those local treatments as project categories.

**The Truthful Progress Rule.** Derive completion counts and rounded percentages from actual tasks. An empty project shows zero percent and “No tasks yet.” At zero, render the gray track and hide the colored arc entirely, including its rounded cap.

## Typography

Use the bundled Plus Jakarta Sans through its `Jakarta` CSS alias, with Segoe UI and sans-serif fallbacks. The everyday hierarchy stays compact: a bold section heading, a smaller bold project title, readable task text, and quiet supporting labels. Inputs use the slightly larger input role. There is no separate display or monospace family in the workspace.

Project names and task text wrap rather than truncate. Project titles use the title role; run titles share its size. Supporting section headings use 14px at weight 750. At the wide breakpoint, section headings rise to 24px. Percentage numerals use 11px bold tabular figures, centered in the ring. The wordmark and pairing headline are local identity and onboarding treatments rather than a general display scale.

**The Content First Rule.** Keep the user's project names, task wording, action descriptions and observed run state readable. Use compact icon actions with accessible names; do not replace content with decorative labels.

## Layout

The phone workspace is one column with 18px horizontal gutters, a maximum width of 720px and safe-area-aware top and bottom padding. The wordmark and small action group sit above the Projects and Computer tabs. Tabs stay at the top; there is no bottom navigation. Settings occupies the same content region when opened.

Cards span the available column. Their headers pair left-aligned copy with a fixed 52px ring on the right. The header is at least 100px high, with 20px padding and a 16px gap. Expanded content stays inside the same silhouette: separated task rows followed by the filled add-task composer at the bottom. Rows are at least 58px high and grow for wrapped content. Completed tasks remain after unfinished tasks, ordered by completion time; they do not disappear into an archive.

At 760px and above, the column can reach 820px, headers gain 22px vertical and 24px horizontal padding, rows rise to a 62px minimum and the PC preview gains a 340px minimum height. The layout remains one column. Phone previews have a 200px minimum height and retain the screenshot's full width. The pairing surface uses its own centered, 420px maximum-width column.

The Computer sequence is device state, screen preview, any pending approval, run status, request composer and recent requests. Keep the proposed action's screen and decision close. Activity and history use native disclosure controls rather than filling the initial view.

## Elevation & Depth

Project cards and approval panels share a fine dark outline and an unblurred shadow directly below the surface (`0 3px 0 #242424`). This structural depth is part of the incumbent visual world. Inputs, task rows and the screenshot region use neutral fills or separators instead of independent elevation. A transient toast has its own soft overlay shadow; that is not the default card treatment.

**The Continuous Card Rule.** Keep each project header, task list and composer inside one outlined white silhouette. Use separators between tasks, not nested task cards.

## Shapes

Project cards use the largest radius. Approval panels and the screen preview use the panel radius, composers use the next step, and controls use the tightest shared radius. Rings and task completion checks are circular. Simple inline SVG paths provide the icon language: rounded strokes, no icon font or ornamental glyphs.

Controls generally provide a 44px minimum height; compact in-card controls retain their observed dimensions. Preserve the source's visible keyboard focus for buttons, links and disclosure summaries, and the fill change for inputs. Forced-colors mode adds system-color boundaries to controls.

## Components

### Buttons

Solid ink buttons carry the affirmative action; quiet filled buttons carry the adjacent alternative. Both retain the control radius and a 44px minimum height. Icon buttons use a compact outline SVG and an accessible name. Icon hover adds a neutral fill; solid hover lightens the ink. Pressing icon or solid controls scales them to 95%. Disabled controls visibly reduce opacity and stop accepting actions. Keyboard focus uses a two-pixel outline with a three-pixel offset.

### Inputs / Fields

The task composer is a neutral, borderless filled row at the bottom of an expanded project. Its background deepens on focus, with a transparent inner input and an arrow action. Retain entered wording when submission fails. The PC request composer follows the same material, with a wrapping textarea and a solid arrow action; it grows vertically within a bounded height. Optional new-project entry stays hidden until requested.

### Navigation

Projects and Computer are top tabs with explicit selected state. The selected tab uses solid ink and white text; the other stays quiet on the canvas. A small warm dot indicates an outstanding approval. The bell and settings actions stay in the topbar. Do not add a second navigation row at the bottom.

### Cards / Containers

The whole project header toggles its task region, exposes expansion semantics, and turns its chevron. Plain task rows use a right-side completion control and an optional PC-run action. Finished rows keep a dark check with muted struck text and remain at the bottom. Keep project creation separate from task creation; merely adding a task does not execute it.

### Progress Rings

Use a 52px ring with a gray track, rounded five-unit SVG stroke and centered percentage. Apply the project color only to the completed arc. Counts and the ring convey the same underlying data; the ring is decorative to assistive technology because the textual count remains available.

### Screen and Approval

The screenshot fills its region without decorative cropping. A compact caption identifies the screen, while a small circular marker may identify the proposed action coordinate. An approval panel immediately below states the concrete action and, when present, the exact typing content. Equal-width “Don't allow” and “Allow this action” choices communicate a decision about that action.

Keep visible capability claims precise: the PC must be awake and unlocked, with its worker online and control enabled. UI-TARS is the default; connected Claude and Codex sessions are optional. Every click, typing action, hotkey and drag needs approval; screenshot, scroll, hover and wait actions can proceed. Model-reported completion leads to “Ready to review”; marking the linked task done requires the owner's explicit review action. Notifications require a supported installed browser context, permission and configured push support. These are constraints on interface wording and states, not decorative promises.

### Motion

Use the incumbent ease-out curve for brief feedback: 160ms control transitions, 200ms chevron rotation, 230ms content reveal and 400ms ring changes. Motion explains state, not activity that has not occurred. Disable animation and transition when reduced motion is requested.

## Do's and Don'ts

- **Do** preserve continuous white cards, fine dark edges, hard downward shadows and right-aligned progress rings.
- **Do** retain readable wrapped content, neutral filled composers and visible focus states.
- **Do** keep completed tasks visible at the bottom and show only progress derived from real tasks.
- **Do** place the observed PC screen before the explicit action approval and keep completion review distinct from execution.
- **Do** keep the shared bundled font and incumbent icon asset provenance when producing install assets.
- **Don't** show a colored arc or round cap when project progress is zero.
- **Don't** add bottom navigation, greetings or nested task cards to this workspace.
- **Don't** imply that task entry starts PC work, that a sleeping or locked PC is controllable, or that model completion marks a task done.
- **Don't** promise notifications before browser support, installation, permission and push configuration are available.
