#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { saveConfig, readConfig, configPath } = require('../src/agents/config');
const entry = path.resolve(__dirname, '../src/agents/mcp.js');
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.status !== 0) throw new Error('Could not configure ' + command + '. Check that its CLI is installed and available.');
  return result.stdout;
}
(async () => {
  if (process.argv.includes('--configure')) {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    saveConfig({ url: input.url, token: input.token });
  }
  const config = readConfig();
  const response = await fetch(config.url + '/api/agent', { method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list_projects', args: {}, session: { id: 'setup-check', client: 'Connection setup' } }) });
  if (!response.ok) throw new Error('The Dooo agent service is not ready or its key does not match');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of [path.join(os.homedir(), '.codex', 'config.toml'), path.join(os.homedir(), '.claude.json')]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.before-dooo-' + stamp + '.bak');
  }
  run(process.platform === 'win32' ? 'codex.exe' : 'codex', ['mcp', 'add', 'dooo', '--env', 'DOOO_AGENT_CLIENT=Codex', '--env', 'DOOO_AGENT_CONFIG=' + configPath(), '--', process.execPath, entry]);
  const claude = process.platform === 'win32' ? 'claude.exe' : 'claude';
  // Claude refuses duplicate names. A matching existing setup can be safely reused.
  const existing = spawnSync(claude, ['mcp', 'get', 'dooo'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (existing.status !== 0) run(claude, ['mcp', 'add', 'dooo', '--scope', 'user', '--transport', 'stdio', '--env', 'DOOO_AGENT_CLIENT=Claude Code', '--env', 'DOOO_AGENT_CONFIG=' + configPath(), '--', process.execPath, entry]);
  else if (!existing.stdout.includes(entry)) throw new Error('Claude Code already has a different dooo connection; it was left unchanged');
  console.log('Dooo configured for Codex and Claude Code. Credentials stay outside their configuration files. Restart/reconnect sessions to load the tools.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
