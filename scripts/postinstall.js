#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_ID = 'skills-evolution';
const CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');

function printNextSteps() {
  console.log('[OK] Installation complete');
  console.log('Next steps:');
  console.log('  1. Restart Gateway: systemctl --user restart openclaw-gateway.service');
  console.log('  2. Verify: openclaw plugins list');
}

async function main() {
  try {
    require('fs'); // just check it resolves
  } catch (e) {
    console.log('[WARN] fs module unavailable; skipping OpenClaw auto-config');
    printNextSteps();
    return;
  }

  if (!fs.existsSync(CONFIG)) {
    console.log(`[WARN] ${CONFIG} not found; skipping OpenClaw auto-config`);
    printNextSteps();
    return;
  }

  let config;
  try {
    const raw = fs.readFileSync(CONFIG, 'utf8');
    config = JSON.parse(raw);
  } catch (e) {
    console.log(`[WARN] Failed to parse ${CONFIG}; skipping OpenClaw auto-config`);
    printNextSteps();
    return;
  }

  // Ensure plugins structure
  config.plugins = config.plugins || {};
  config.plugins.entries = config.plugins.entries || {};
  config.plugins.allow = config.plugins.allow || [];

  // Set enabled: true in entries
  config.plugins.entries[PLUGIN_ID] = {
    ...(config.plugins.entries[PLUGIN_ID] || {}),
    enabled: true
  };

  // Add to allow list if not present
  if (!config.plugins.allow.includes(PLUGIN_ID)) {
    config.plugins.allow.push(PLUGIN_ID);
  }

  try {
    fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.log(`[OK] Added or updated plugins.entries.${PLUGIN_ID}`);
    console.log(`[OK] Added or verified plugins.allow contains ${PLUGIN_ID}`);
  } catch (e) {
    console.log(`[WARN] Failed to write ${CONFIG}; skipping OpenClaw auto-config`);
  }

  printNextSteps();
}

main();
