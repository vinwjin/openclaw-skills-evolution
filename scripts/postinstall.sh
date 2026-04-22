#!/bin/bash
set -euo pipefail

PLUGIN_ID="skills-evolution"
CONFIG="${HOME}/.openclaw/openclaw.json"

print_next_steps() {
  echo "[OK] Installation complete"
  echo "Next steps:"
  echo "  1. Restart Gateway: systemctl --user restart openclaw-gateway.service"
  echo "  2. Verify: openclaw plugins list"
}

if ! command -v jq >/dev/null 2>&1; then
  echo "[WARN] jq unavailable; skipping OpenClaw auto-config"
  print_next_steps
  exit 0
fi

if [ ! -f "$CONFIG" ]; then
  echo "[WARN] $CONFIG not found; skipping OpenClaw auto-config"
  print_next_steps
  exit 0
fi

TEMP="$(mktemp)"
cleanup() {
  rm -f "$TEMP"
}
trap cleanup EXIT

jq --arg plugin "$PLUGIN_ID" '
  .plugins = (.plugins // {}) |
  .plugins.entries = (.plugins.entries // {}) |
  .plugins.entries[$plugin] = ((.plugins.entries[$plugin] // {}) + {enabled: true}) |
  .plugins.allow = ((.plugins.allow // []) | if index($plugin) then . else . + [$plugin] end)
' "$CONFIG" > "$TEMP"

mv "$TEMP" "$CONFIG"
trap - EXIT

echo "[OK] Added or updated plugins.entries.${PLUGIN_ID}"
echo "[OK] Added or verified plugins.allow contains ${PLUGIN_ID}"
print_next_steps
