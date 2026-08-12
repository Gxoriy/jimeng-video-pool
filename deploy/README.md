# aigen-panel 裸机 Linux 部署指南（无 Docker）

本项目已打包为 `aigen-panel-linux.tar.gz`，解压后结构：

```
aigen-panel/
├── backend/
│   ├── dist/          # 后端编译产物 (node dist/main.js 启动)
│   ├── dist/client/   # 前端静态文件（install.sh 自动从 frontend/dist 复制）
│   ├── prisma/        # schema.prisma + migrations/（数据库迁移）
│   ├── package.json
│   ├── package-lock.json
│   └── .env.example
├── frontend/dist/      # 前端静态产物
└── deploy/             # 部署脚本与配置
    ├── install.sh              # 主安装脚本
    ├── start.sh / stop.sh      # 手动启停（无 systemd 备用）
    ├── aigen-panel.service     # systemd 单元模板
    └── nginx-aigen-panel.conf  # 可选 Nginx 反代
```

## 服务器前置条件

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | >= 18 | 后端运行环境（建议 20 LTS） |
| npm | 随 Node | 安装依赖 |
| PostgreSQL | >= 14 | 数据库（可远程） |
| Nginx | 可选 | 仅当你需要域名 / HTTPS 反代 |

## 一键部署

```bash
# 1. 上传并解压
scp aigen-panel-linux.tar.gz user@server:/opt/
ssh user@server
cd /opt && tar -xzf aigen-panel-linux.tar.gz

# 2. 配置环境变量
cd /opt/aigen-panel/backend
cp .env.example .env
vim .env          # 至少修改 DATABASE_URL、JWT_SECRET、SESSION_SECRET

# 3. 安装并启动（自动：装依赖→建表→注册 systemd）
cd /opt/aigen-panel/deploy
chmod +x *.sh
sudo ./install.sh
```

完成后访问 `http://服务器IP:8000/`，默认管理员 `admin / admin123456`（首次启动自动创建，请尽快改密码）。

## 不使用 systemd（容器 / WSL1 / 手动）

```bash
cd /opt/aigen-panel/deploy
sudo ./install.sh --no-systemd                 # 仅装依赖建表，不注册服务
./start.sh            # 后台启动，日志 backend/logs/app.log
./start.sh status     # 查看运行状态与 PID
./start.sh stop       # 停止
./start.sh restart    # 重启
# 前台调试可用: ./start.sh foreground
```

## 使用 systemd 管理

```bash
systemctl status aigen-panel       # 状态
systemctl restart aigen-panel      # 重启
journalctl -u aigen-panel -f        # 跟随日志
```
服务以专用低权限用户 `aigen` 运行，仅 `backend/data` 可写。

## 可选：Nginx 反代（HTTPS / 域名）

```bash
sudo cp /opt/aigen-panel/deploy/nginx-aigen-panel.conf /etc/nginx/sites-available/aigen-panel
sudo sed -i 's/your-domain.com/你的域名/' /etc/nginx/sites-available/aigen-panel
sudo ln -s /etc/nginx/sites-available/aigen-panel /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

后端已开启 CORS 并直接托管前端 SPA，`/health` 为健康检查端点（systemd 可据此加 HealthCheck）。

## 注意事项

- 数据库迁移由 `install.sh` 和后端启动时**双重保障**：先 `migrate deploy`，再 `db push` 兜底补齐表结构。
- Prisma 引擎在 `install.sh` 执行 `npm ci` 时按**服务器平台（Linux）**生成，请勿在 Windows 上预装 node_modules 后整体拷到 Linux。
- `STORAGE_PATH`（默认 `./data/media`）存放下载的媒体文件，请确保该目录可被服务用户写入。
- 若服务器无法访问外网 npm registry，请先在能联网的机器执行 `npm ci --omit=dev` 后随包带上 `node_modules/linux` 引擎，或配置私有 registry。
