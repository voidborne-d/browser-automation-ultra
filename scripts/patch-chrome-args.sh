#!/bin/bash
# patch-chrome-args.sh — 移除 OpenClaw Chrome 启动参数中的自动化痕迹
#
# 移除的参数（会暴露自动化特征）：
#   --disable-background-networking  → 导致 navigator.connection.rtt=0
#   --disable-session-crashed-bubble → 自动化工具特征
#   --hide-crash-restore-bubble      → 自动化工具特征
#
# 用法：
#   ./scripts/patch-chrome-args.sh
#   # 然后重启 Gateway + Chrome：
#   openclaw gateway restart
#   openclaw browser --browser-profile openclaw stop
#   openclaw browser --browser-profile openclaw start
#
# ⚠️ OpenClaw 更新后需要重新运行此脚本

set -e

OPENCLAW_DIR=$(npm root -g 2>/dev/null)/openclaw
if [ ! -d "$OPENCLAW_DIR" ]; then
  OPENCLAW_DIR=$(dirname $(which openclaw 2>/dev/null))/../lib/node_modules/openclaw
fi
if [ ! -d "$OPENCLAW_DIR" ]; then
  echo "❌ Cannot find OpenClaw installation"
  exit 1
fi

echo "📍 OpenClaw: $OPENCLAW_DIR"

PATCHED=0
for f in $(grep -rl "disable-background-networking" "$OPENCLAW_DIR/dist/" 2>/dev/null); do
  sed -i.bak '/"--disable-background-networking",/d' "$f"
  sed -i.bak '/"--disable-session-crashed-bubble",/d' "$f"
  sed -i.bak '/"--hide-crash-restore-bubble",/d' "$f"
  rm -f "${f}.bak"
  PATCHED=$((PATCHED + 1))
  echo "  ✅ $(basename $f)"
done

# Also patch Playwright's chromium switches if present
PW_SWITCHES="$OPENCLAW_DIR/node_modules/playwright-core/lib/server/chromium/chromiumSwitches.js"
if [ -f "$PW_SWITCHES" ] && grep -q "disable-background-networking" "$PW_SWITCHES"; then
  sed -i.bak '/"--disable-background-networking",/d' "$PW_SWITCHES"
  rm -f "${PW_SWITCHES}.bak"
  PATCHED=$((PATCHED + 1))
  echo "  ✅ playwright chromiumSwitches.js"
fi

if [ $PATCHED -eq 0 ]; then
  echo "ℹ️  Already patched (no changes needed)"
else
  echo ""
  echo "✅ Patched $PATCHED file(s). Now restart:"
  echo "   openclaw gateway restart"
  echo "   openclaw browser --browser-profile openclaw stop"
  echo "   openclaw browser --browser-profile openclaw start"
fi
