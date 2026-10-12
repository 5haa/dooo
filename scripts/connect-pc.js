#!/usr/bin/env node
'use strict';
const { randomUUID } = require('node:crypto');
const { saveConfig, readConfig } = require('../apps/worker/config');
(async () => {
  const url = process.argv[2];
  if (!url || process.stdin.isTTY) throw new Error('Pass the HTTPS service origin and pipe the worker key through standard input.');
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 4096) throw new Error('Worker key is too long'); chunks.push(chunk); }
  const token = Buffer.concat(chunks).toString('utf8').trim();
  let previous; try { previous = readConfig(); } catch {}
  saveConfig({ url, token, deviceId: previous?.deviceId || randomUUID() });
  console.log('PC connection saved. Start or restart Dooo, then choose Connect phone in its tray menu.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
