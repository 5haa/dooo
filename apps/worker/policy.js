'use strict';
const { digest } = require('../../packages/control');
const SAFE = new Set(['wait', 'scroll', 'mouse_move', 'hover']);
const END = new Set(['finished', 'call_user', 'user_stop']);
const ACTIONS = new Set([...SAFE, ...END, 'click', 'left_click', 'left_single', 'left_double', 'double_click', 'right_click', 'right_single', 'drag', 'hotkey', 'type']);
function validateAction(parsed) {
  if (!parsed || !ACTIONS.has(parsed.action_type)) throw new Error('The model proposed an unsupported action');
  const args = parsed.action_inputs || {};
  for (const name of ['start_box', 'end_box']) if (args[name]) {
    let values; try { values = JSON.parse(args[name]); } catch { throw new Error('Invalid action coordinates'); }
    if (!Array.isArray(values) || ![2, 4].includes(values.length) || values.some(x => typeof x !== 'number' || x < 0 || x > 1)) throw new Error('Action coordinates are outside the screen');
  }
  if (['click', 'left_click', 'left_single', 'left_double', 'double_click', 'right_click', 'right_single', 'drag', 'mouse_move', 'hover'].includes(parsed.action_type) && !args.start_box) throw new Error('Action is missing its screen target');
  if (parsed.action_type === 'drag' && !args.end_box) throw new Error('Drag is missing its destination');
  if (parsed.action_type === 'type' && (typeof args.content !== 'string' || args.content.length > 3000)) throw new Error('Typing request is too long');
  if (parsed.action_type === 'hotkey' && (typeof (args.key || args.hotkey) !== 'string' || (args.key || args.hotkey).length > 100)) throw new Error('Invalid keyboard shortcut');
  if (parsed.action_type === 'scroll' && !['up', 'down'].includes(args.direction)) throw new Error('Invalid scroll direction');
  return { type: parsed.action_type, args, requiresApproval: !SAFE.has(parsed.action_type) && !END.has(parsed.action_type), terminal: END.has(parsed.action_type) };
}
function describeAction(action) {
  if (action.type === 'type') return 'Type: ' + action.args.content;
  if (action.type === 'hotkey') return 'Press ' + (action.args.key || action.args.hotkey);
  const names = { click: 'Click', left_click: 'Click', left_single: 'Click', left_double: 'Double-click', double_click: 'Double-click', right_click: 'Right-click', right_single: 'Right-click', drag: 'Drag', scroll: 'Scroll', mouse_move: 'Move pointer', hover: 'Move pointer', wait: 'Wait' };
  const box = action.args.start_box ? JSON.parse(action.args.start_box) : null;
  return (names[action.type] || action.type) + (box ? ' at ' + Math.round((box[0] + (box[2] ?? box[0])) / 2 * 100) + '%, ' + Math.round((box[1] + (box[3] ?? box[1])) / 2 * 100) + '%' : '') + (action.args.direction ? ' ' + action.args.direction : '');
}
function screenChanged(before, after) {
  if (before.length !== after.length) return true;
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) if (Math.max(Math.abs(before[i] - after[i]), Math.abs(before[i + 1] - after[i + 1]), Math.abs(before[i + 2] - after[i + 2])) > 35) changed++;
  return changed > before.length / 4 * 0.015;
}
// PostgreSQL JSONB normalizes object-key order. Hash values canonically across that round trip.
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
module.exports = { validateAction, describeAction, screenChanged, actionHash: action => digest(JSON.stringify(canonical(action))) };
