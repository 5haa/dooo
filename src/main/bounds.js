'use strict';

/**
 * Pure window-geometry helpers (no Electron imports, so they are easy to reason about).
 * All rectangles are { x, y, width, height } in DIPs, like Electron's screen API.
 */

const DEFAULT_SIZE = { width: 420, height: 680 };
const MIN_SIZE = { width: 360, height: 480 };
const MAX_WIDTH = 760;
const EDGE_MARGIN = 24; // default placement: top-right of the primary work area
const PANEL_INSET = 14; // the renderer's glass panel sits this far inside the window
const GRAB_STRIP = 48; // height of the panel's top strip (where the drag handle lives)
// The safe core sits this far inside the panel: clear of its rounded corners, the corner
// hide badge and the resize grip, so it is always over the interactive panel.
const SAFE_CORE_MARGIN = 24;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function maxHeightFor(workArea) {
  return Math.max(MIN_SIZE.height, Math.floor(workArea.height));
}

/** Rounds and clamps a size to min 360x480, max 760 x work-area height. */
function clampSize(width, height, workArea) {
  return {
    width: clamp(Math.round(width), MIN_SIZE.width, MAX_WIDTH),
    height: clamp(Math.round(height), MIN_SIZE.height, maxHeightFor(workArea)),
  };
}

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/**
 * True when the window still intersects a work area well enough to be grabbed again:
 * part of the panel's top strip (the drag area) must be on some display.
 */
function isReachable(bounds, workAreas) {
  const strip = {
    x: bounds.x + PANEL_INSET,
    y: bounds.y + PANEL_INSET,
    width: Math.max(1, bounds.width - 2 * PANEL_INSET),
    height: GRAB_STRIP,
  };
  return workAreas.some((area) => {
    const o = overlap(strip, area);
    return o.width >= Math.min(80, strip.width) && o.height >= 24;
  });
}

/** Default placement: top-right of the given (primary) work area with a 24px margin. */
function defaultBounds(workArea) {
  const roomForHeight = Math.floor(workArea.height - 2 * EDGE_MARGIN);
  const height = clamp(Math.min(DEFAULT_SIZE.height, roomForHeight), MIN_SIZE.height, maxHeightFor(workArea));
  const width = clamp(DEFAULT_SIZE.width, MIN_SIZE.width, MAX_WIDTH);
  return {
    x: Math.round(workArea.x + workArea.width - width - EDGE_MARGIN),
    y: Math.round(workArea.y + EDGE_MARGIN),
    width,
    height,
  };
}

function sameBounds(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * The part of the window that is always over the interactive panel: the window bounds
 * inset by PANEL_INSET + SAFE_CORE_MARGIN on every side. Empty for a too-small window.
 */
function safeCore(bounds) {
  const inset = PANEL_INSET + SAFE_CORE_MARGIN;
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: Math.max(0, bounds.width - 2 * inset),
    height: Math.max(0, bounds.height - 2 * inset),
  };
}

/** True when a screen point (DIPs) lies inside the window's safe core. */
function isInSafeCore(point, bounds) {
  if (!point || !bounds) return false;
  const core = safeCore(bounds);
  return (
    core.width > 0 &&
    core.height > 0 &&
    point.x >= core.x &&
    point.x < core.x + core.width &&
    point.y >= core.y &&
    point.y < core.y + core.height
  );
}

module.exports = {
  DEFAULT_SIZE,
  MIN_SIZE,
  MAX_WIDTH,
  PANEL_INSET,
  SAFE_CORE_MARGIN,
  clampSize,
  isReachable,
  defaultBounds,
  sameBounds,
  safeCore,
  isInSafeCore,
};
