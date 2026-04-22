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

# 4. 运行 npm postinstall，自动配置 openclaw.json
echo "[4/4] 运行 postinstall ..."
if command -v npm &>/dev/null; then
  (cd "$REPO_DIR" && npm run postinstall --silent)
else
  echo "[WARN] npm 未安装，未运行 postinstall"
  echo "请手动执行：cd \"$REPO_DIR\" && npm run postinstall --silent"
fi
