'use strict';
const COLLAPSED_HEIGHT = 120;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function projectBounds(rect, area, expanded) {
  const width = clamp(Math.round(rect.width), Math.min(300, area.width), Math.min(800, area.width));
  const maxHeight = Math.max(COLLAPSED_HEIGHT, area.height - 16);
  const height = expanded ? clamp(Math.round(rect.height), Math.min(280, maxHeight), maxHeight) : COLLAPSED_HEIGHT;
  return { width, height, x: clamp(Math.round(rect.x), area.x, area.x + area.width - width),
    y: clamp(Math.round(rect.y), area.y, area.y + area.height - height) };
}
function projectPosition(index, area, width = 380) {
  const rows = Math.max(1, Math.floor((area.height - 40) / (COLLAPSED_HEIGHT + 12)));
  const cols = Math.max(1, Math.floor((area.width - 80) / (width + 16)));
  return { x: area.x + area.width - 64 - width - (Math.floor(index / rows) % cols) * (width + 16),
    y: area.y + 24 + (index % rows) * (COLLAPSED_HEIGHT + 12) };
}
// Anchor coordinates refer to the plus button itself, so opening the tray never moves it.
function dockLayout(anchor, area, open, panelHeight = 160) {
  const size = 44, gap = 12, inset = 8, panelWidth = 180;
  const x = clamp(Math.round(anchor.x), area.x, area.x + area.width - size);
  const y = clamp(Math.round(anchor.y), area.y + inset, area.y + area.height - size - inset);
  const side = x + size / 2 > area.x + area.width / 2 ? 'left' : 'right';
  const edge = x === area.x ? 'left' : x === area.x + area.width - size ? 'right' : 'floating';
  const height = clamp(Math.round(panelHeight), 140, Math.min(360, area.height - 16));
  const px = clamp(side === 'left' ? x - gap - panelWidth : x + size + gap, area.x + inset, area.x + area.width - panelWidth - inset);
  const py = Math.round(clamp(y + size / 2 - height / 2, area.y + inset, area.y + area.height - height - inset));
  const left = Math.max(area.x, Math.min(x, open ? px : x) - inset);
  const top = Math.max(area.y, Math.min(y, open ? py : y) - inset);
  const right = Math.min(area.x + area.width, Math.max(x + size, open ? px + panelWidth : x + size) + inset);
  const bottom = Math.min(area.y + area.height, Math.max(y + size, open ? py + height : y + size) + inset);
  return { anchor: { x, y }, bounds: { x: left, y: top, width: right - left, height: bottom - top },
    buttonLeft: x - left, buttonTop: y - top, panelLeft: px - left, panelTop: py - top, side, edge };
}
module.exports = { projectBounds, projectPosition, dockLayout, COLLAPSED_HEIGHT };
