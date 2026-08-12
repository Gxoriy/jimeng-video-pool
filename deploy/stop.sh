#!/usr/bin/env bash
# 停止 aigen-panel 后端（封装 start.sh stop）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/start.sh" stop
