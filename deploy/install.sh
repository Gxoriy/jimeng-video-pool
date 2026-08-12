#!/usr/bin/env bash
#
# aigen-panel 裸机 Linux 部署脚本（无 Docker）
# 用法：
#   chmod +x install.sh
#   sudo ./install.sh            # 安装依赖、初始化数据库、注册 systemd
#   sudo ./install.sh --no-systemd   # 仅安装，不注册 systemd（适合手动 PM2 / nohup 运行）
#
# 前置依赖（脚本会自动检测并提示缺失项）：
#   - node (>=18) 与 npm
#   - PostgreSQL (>=14)，且 DATABASE_URL 指向的库可连接
#   - (可选) nginx，用于 HTTPS / 域名反代
#
set -euo pipefail

# ---------- 路径定义 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIST_DIR="$ROOT_DIR/frontend-dist"
if [ ! -d "$FRONTEND_DIST_DIR" ] && [ -d "$ROOT_DIR/frontend/dist" ]; then
  FRONTEND_DIST_DIR="$ROOT_DIR/frontend/dist"
fi
SYSTEMD_TARGET="/etc/systemd/system/aigen-panel.service"
SERVICE_USER="${SERVICE_USER:-aigen}"
REGISTER_SYSTEMD=1

for arg in "$@"; do
  case "$arg" in
    --no-systemd) REGISTER_SYSTEMD=0 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

echo "==> 部署根目录: $ROOT_DIR"

# ---------- 1. 依赖检查 ----------
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "::error:: 缺少命令: $1，请先安装后重试。" >&2
    return 1
  fi
}

echo "==> 检查系统依赖..."
require_cmd node
require_cmd npm
require_cmd psql || true   # psql 不存在也能连远程 PG，仅警告

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "${NODE_VER:-0}" -lt 18 ]; then
  echo "::error:: Node 版本过低（当前 v$(node -v)），需要 >= 18。" >&2
  exit 1
fi
echo "    node $(node -v), npm $(npm -v) OK"

# ---------- 2. 放置前端静态文件到 backend/dist/client ----------
# main.ts 在生产环境从 <backendDir>/dist/client 托管 SPA，因此必须把前端产物放到这里。
echo "==> 部署前端静态文件到 backend/dist/client ..."
rm -rf "$BACKEND_DIR/dist/client"
mkdir -p "$BACKEND_DIR/dist/client"
if [ -d "$FRONTEND_DIST_DIR" ]; then
  cp -r "$FRONTEND_DIST_DIR/." "$BACKEND_DIR/dist/client/"
  echo "    已复制 frontend-dist -> backend/dist/client"
else
  echo "::error:: 未找到 frontend-dist 目录，请确认部署包完整。" >&2
  exit 1
fi

# ---------- 3. 安装后端依赖（生成 Linux 平台 Prisma 引擎） ----------
echo "==> 安装后端依赖（npm ci）..."
cd "$BACKEND_DIR"
if [ ! -f package-lock.json ]; then
  echo "    未找到 package-lock.json，改用 npm install"
  npm install --omit=dev --no-audit --no-fund
else
  npm ci --omit=dev --no-audit --no-fund
fi

# ---------- 4. 生成 Prisma Client + 数据库迁移 + 默认管理员 ----------
# main.ts 启动时会自动执行 migrate deploy + db push + 创建 admin，
# 但此处显式跑一次，便于提前暴露 DATABASE_URL 配置问题。
if [ -f "$BACKEND_DIR/.env" ]; then
  echo "==> 生成 Prisma Client..."
  npx prisma generate

  echo "==> 应用数据库迁移 (prisma migrate deploy)..."
  npx prisma migrate deploy || echo "::warn:: migrate deploy 失败（可能是首次使用 db push 或 DATABASE_URL 不可达），启动时会再次尝试。"

  echo "==> 首次建表兜底 (prisma db push)..."
  npx prisma db push --skip-generate --accept-data-loss || echo "::warn:: db push 失败，请检查数据库连通性。"
else
  echo "::warn:: 未找到 $BACKEND_DIR/.env，跳过程序库初始化。"
  echo "    请先复制 .env.example 为 .env 并填写 DATABASE_URL 等，再运行本脚本。"
fi

# ---------- 5. 注册 systemd（可选） ----------
if [ "$REGISTER_SYSTEMD" -eq 1 ]; then
  if [ ! -d /etc/systemd/system ]; then
    echo "::warn:: 当前系统不支持 systemd（如 WSL1 / 容器），跳过注册。" >&2
  else
    echo "==> 注册 systemd 服务..."
    # 创建专用运行用户（若已存在则忽略）
    if ! id "$SERVICE_USER" >/dev/null 2>&1; then
      useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER" || true
    fi
    chown -R "$SERVICE_USER":"$SERVICE_USER" "$ROOT_DIR" 2>/dev/null || true

    # 渲染 service 文件中的工作目录
    sed "s|__WORKING_DIRECTORY__|$BACKEND_DIR|g; s|__SERVICE_USER__|$SERVICE_USER|g" \
      "$SCRIPT_DIR/aigen-panel.service" > "$SYSTEMD_TARGET"

    systemctl daemon-reload
    systemctl enable aigen-panel.service
    systemctl restart aigen-panel.service
    echo "    服务已启用并启动。查看状态: systemctl status aigen-panel"
    echo "    查看日志:   journalctl -u aigen-panel -f"
  fi
else
  echo "==> 已跳过 systemd 注册。"
  echo "    手动启动: cd $SCRIPT_DIR && ./start.sh"
  echo "    查看状态: ./start.sh status   停止: ./start.sh stop   重启: ./start.sh restart"
fi

echo ""
echo "✅ 部署完成。"
echo "   后端监听: ${HOST:-127.0.0.1}:${PORT:-8000}"
echo "   前端页面: 直接访问 http://${HOST:-127.0.0.1}:${PORT:-8000}/"
echo "   默认管理员: admin / admin123456（首次启动自动创建，请尽快修改密码）"
