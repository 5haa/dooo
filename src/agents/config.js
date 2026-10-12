'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function configPath() { return process.env.DOOO_AGENT_CONFIG || path.join(process.env.APPDATA || path.join(os.homedir(), ...(process.platform === 'win32' ? ['AppData', 'Roaming'] : ['.config'])), 'Dooo', 'agent.json'); }
function protect(value, encrypt) {
  if (process.platform !== 'win32') throw new Error('Windows credential protection is unavailable');
  // Secret data travels through pipes, never command arguments or model-visible output.
  const command = 'Add-Type -AssemblyName System.Security; $data = [Console]::In.ReadToEnd(); ' + (encrypt
    ? '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($data), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($data), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { input: value, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error('Cannot unlock Dooo credentials for this Windows user');
  return result.stdout.trim();
}
function validate(config) {
  let url; try { url = new URL(config.url); } catch { throw new Error('Invalid Dooo service URL'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Dooo requires HTTPS');
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Use the Dooo service origin');
  if (typeof config.token !== 'string' || config.token.length < 32) throw new Error('Dooo agent key is missing');
  return { url: url.origin, token: config.token };
}
function readConfig() {
  if (process.env.DOOO_AGENT_URL && process.env.DOOO_AGENT_TOKEN) return validate({ url: process.env.DOOO_AGENT_URL, token: process.env.DOOO_AGENT_TOKEN });
  let config; try { config = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { throw new Error('Dooo connection is not configured. Run the connection setup first.'); }
  return validate({ url: config.url, token: config.encryptedToken ? protect(config.encryptedToken, false) : config.token });
}
function saveConfig(config) {
  const valid = validate(config), file = configPath();
  const data = process.platform === 'win32' ? { url: valid.url, encryptedToken: protect(valid.token, true) } : valid;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  return file;
}
module.exports = { readConfig, saveConfig, configPath };
