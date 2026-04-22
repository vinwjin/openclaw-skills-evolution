#!/bin/bash
# install.sh — OpenClaw Skills Evolution 一键安装
set -e

REPO_DIR="$HOME/.openclaw/extensions/skills-evolution"
TEMP_DIR=$(mktemp -d)
REPO_URL="https://github.com/vinwjin/openclaw-skills-evolution.git"

echo "[skills-evolution] 开始安装..."

# 1. Clone 到临时目录
echo "[1/4] 克隆仓库..."
git clone --depth=1 "$REPO_URL" "$TEMP_DIR" 2>/dev/null || {
  echo "[ERROR] git clone 失败，请检查网络"
  exit 1
}

# 2. 备份旧版本（如果存在）
if [ -d "$REPO_DIR" ]; then
  BACKUP_DIR="${REPO_DIR}.backup.$(date +%Y%m%d%H%M%S)"
  echo "[2/4] 备份旧版到 $BACKUP_DIR ..."
  mv "$REPO_DIR" "$BACKUP_DIR"
fi

# 3. 复制到扩展目录
echo "[3/4] 安装到 $REPO_DIR ..."
mkdir -p "$(dirname "$REPO_DIR")"
mv "$TEMP_DIR" "$REPO_DIR"

# 4. 确保 openclaw.json 配置正确
CONFIG="$HOME/.openclaw/openclaw.json"
if [ -f "$CONFIG" ]; then
  echo "[4/4] 检查 openclaw.json 配置..."

  # 用 jq 自动写入，避免手动配置
  if command -v jq &>/dev/null; then
    # 写入 plugins.entries.skills-evolution
    if ! grep -q '"skills-evolution"' "$CONFIG"; then
      TEMP=$(mktemp)
      jq '.plugins.entries["skills-evolution"] = {"enabled": true}' "$CONFIG" > "$TEMP" && mv "$TEMP" "$CONFIG"
      echo "  [OK] 已添加 plugins.entries.skills-evolution"
    fi

    # 写入 plugins.allow
    if ! grep -q 'skills-evolution' "$CONFIG"; then
      TEMP=$(mktemp)
      jq '.plugins.allow += ["skills-evolution"]' "$CONFIG" > "$TEMP" && mv "$TEMP" "$CONFIG"
      echo "  [OK] 已添加 plugins.allow"
    fi
  else
    echo "  [WARN] jq 未安装，无法自动配置"
    echo "  请手动添加：{ \"id\": \"skills-evolution\", \"enabled\": true }"
  fi
fi

echo ""
echo "[OK] 安装完成！"
echo ""
echo "下一步："
echo "  1. 重启 Gateway：systemctl --user restart openclaw-gateway.service"
echo "  2. 验证：openclaw plugins list"
echo ""
