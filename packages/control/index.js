'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const equalToken = (actual, expected) => !!expected && timingSafeEqual(Buffer.from(digest(actual)), Buffer.from(digest(expected)));
class ControlError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ControlError(status, message); };
function text(value, name, max = 2000) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'Invalid ' + name); return value.trim(); }
function uuid(value) { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) fail(400, 'Invalid ID'); return value; }
const ACTIVE = ['queued', 'running', 'waiting_approval'];
module.exports = { digest, equalToken, ControlError, fail, text, uuid, ACTIVE };
