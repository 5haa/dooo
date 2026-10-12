# Dooo

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner manages Neuvix, Almarkaz and other projects on Windows and a phone.

## Product Purpose

Keep shared project tasks and control the owner's awake, unlocked PC remotely from an installable phone web app.

## Operating Context

Existing Electron desktop cards sync with PostgreSQL on Railway. The phone uses a paired, authenticated web app. A local PC worker executes UI-TARS actions using the OpenRouter model. Codex and Claude Code remain optional through the existing MCP connection.

## Capabilities and Constraints

Phone task entry, project lists, natural-language PC requests, visible run progress, stop controls and approval notifications. Routine actions continue automatically; sensitive actions pause for the owner after a screenshot/target consequence check. Browser mode runs in a separate Chromium session with independent input. Desktop mode uses the shared Windows mouse and keyboard. The PC worker must be online; locked or sleeping Windows cannot be controlled. No task executes merely because it exists.

## Brand Commitments

Keep the existing Dooo white project cards, neutral filled fields, compact icon actions, and colored progress rings. Avoid greetings, clutter and bottom navigation.

## Evidence on Hand

Existing source, DESIGN.md, supplied project-card screenshots, real private task data and the official UI-TARS source.

## Product Principles

- Tasks stay easy to add and read.
- Preserve original wording and data during failures.
- Show actual work status and observed results.
- Remote control requires pairing and explicit user requests.
