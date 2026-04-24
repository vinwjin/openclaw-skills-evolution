#!/bin/bash
# install.sh — OpenClaw Skills Evolution 一键安装
# 用法：curl -fsSL https://raw.githubusercontent.com/vinwjin/openclaw-skills-evolution/master/install.sh | bash

set -e

PLUGIN_ID="skills-evolution"
COMPACTION_PROVIDER_ID="skills-evolution-compactor"
NPM_PACKAGE="@vinwjin/openclaw-skills-evolution"
EXTENSION_DIR="$HOME/.openclaw/extensions/skills-evolution"
OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"
NPM_GLOBAL_DIR=$(npm root -g)

echo "[skills-evolution] 开始安装..."

# 1. npm 全局安装
echo "[1/5] 安装 npm 包..."
if ! command -v npm &>/dev/null; then
  echo "[ERROR] npm 未安装"
  exit 1
fi
npm install -g "$NPM_PACKAGE" 2>/dev/null || {
  echo "[ERROR] npm install 失败"
  exit 1
}

# 2. 复制到 extensions 目录（Gateway 安全策略阻止 symlink，必须用 cp）
echo "[2/5] 复制到扩展目录..."
NPM_PKG_DIR="$NPM_GLOBAL_DIR/@vinwjin/openclaw-skills-evolution"
if [ ! -d "$NPM_PKG_DIR" ]; then
  echo "[ERROR] npm 包未找到：$NPM_PKG_DIR"
  exit 1
fi

if [ -d "$EXTENSION_DIR" ]; then
  BACKUP_DIR="${EXTENSION_DIR}.backup.$(date +%Y%m%d%H%M%S)"
  echo "[2/5] 备份旧版到 $BACKUP_DIR ..."
  mv "$EXTENSION_DIR" "$BACKUP_DIR"
fi
mkdir -p "$(dirname "$EXTENSION_DIR")"
cp -r "$NPM_PKG_DIR" "$EXTENSION_DIR"

# 3. 自动配置 openclaw.json
echo "[3/5] 配置 openclaw.json..."
update_json() {
  local file="$OPENCLAW_JSON"
  if [ ! -f "$file" ]; then echo "[WARN] $file 不存在，跳过自动配置"; return; fi

  local tmp
  tmp=$(mktemp)
  jq \
    --arg plugin "$PLUGIN_ID" \
    --arg provider "$COMPACTION_PROVIDER_ID" \
    '
      .plugins = (.plugins // {}) |
      .plugins.entries = (.plugins.entries // {}) |
      .plugins.entries[$plugin] = ((.plugins.entries[$plugin] // {}) + {enabled: true}) |
      .plugins.allow = ((.plugins.allow // []) | if index($plugin) then . else . + [$plugin] end) |
      .agents = (.agents // {}) |
      .agents.defaults = (.agents.defaults // {}) |
      .agents.defaults.compaction = (.agents.defaults.compaction // {}) |
      .agents.defaults.compaction.provider = (.agents.defaults.compaction.provider // $provider)
    ' "$file" > "$tmp" && mv "$tmp" "$file"

  echo "  [OK] 已启用插件并确保 plugins.allow 包含 $PLUGIN_ID"
  echo "  [OK] 若未配置其他 provider，已设置 agents.defaults.compaction.provider=$COMPACTION_PROVIDER_ID"
}

if command -v jq &>/dev/null; then
  update_json
else
  echo "  [WARN] jq 未安装，跳过自动配置"
  echo "  请手动添加 skills-evolution 到 plugins.entries / plugins.allow，并设置 agents.defaults.compaction.provider=skills-evolution-compactor"
fi

# 4. 验证
echo "[4/5] 验证安装..."
if [ -f "$EXTENSION_DIR/index.js" ]; then
  VERSION=$(node -e "console.log(require('$EXTENSION_DIR/package.json').version)" 2>/dev/null || echo "unknown")
  echo "  [OK] skills-evolution v$VERSION 已安装到 $EXTENSION_DIR"
else
  echo "[ERROR] 安装验证失败"
  exit 1
fi

# 5. 重启 Gateway
echo "[5/5] 重启 Gateway..."
if command -v systemctl &>/dev/null; then
  systemctl --user restart openclaw-gateway.service 2>/dev/null && echo "  [OK] Gateway 已重启" || echo "  [WARN] Gateway 重启失败，请手动执行：systemctl --user restart openclaw-gateway.service"
else
  echo "  [WARN] systemctl 不可用，请手动重启 Gateway"
fi

echo ""
echo "[OK] 安装完成！"
echo "验证：openclaw plugins list"
