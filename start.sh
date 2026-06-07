#!/usr/bin/env bash
# 高级编辑小助手启动脚本

set -e
cd "$(dirname "$0")"

PORT=8765
URL="http://127.0.0.1:${PORT}"

# 自动开浏览器（Mac）
if command -v open >/dev/null 2>&1; then
  ( sleep 1 && open "$URL" ) &
fi

echo "🚀 启动本地服务于 $URL"
echo "按 Ctrl+C 停止"
python3 -m http.server $PORT
