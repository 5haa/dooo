'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { protect } = require('../../src/agents/config');
const { uuid } = require('../../packages/control');
const file = () => process.env.DOOO_WORKER_CONFIG || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Dooo', 'worker.json');
function saveConfig(config) {
  const url = new URL(config.url); if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('Use HTTPS');
  uuid(config.deviceId); if (typeof config.token !== 'string' || config.token.length < 32) throw new Error('Worker key missing');
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const data = { url: url.origin, deviceId: config.deviceId, ...(process.platform === 'win32' ? { encryptedToken: protect(config.token, true) } : { token: config.token }) };
  fs.writeFileSync(file(), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}
function readConfig() {
  if (!fs.existsSync(file())) return null;
  const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  const url = new URL(data.url), token = data.encryptedToken ? protect(data.encryptedToken, false) : data.token;
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) || typeof token !== 'string' || token.length < 32) throw new Error('Invalid worker configuration');
  return { url: url.origin, deviceId: uuid(data.deviceId), token };
}
module.exports = { readConfig, saveConfig, file };
