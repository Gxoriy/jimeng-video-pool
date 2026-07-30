# AI 生成面板（aigen-panel）

> 多用户 Web 服务：图片（ChatGPT / OpenAI 兼容生图）· 数字人对口型（RunningHub）· 视频（可插拔 provider）
> 形象库 / 歌曲库 / 提示词库 + 任务管理 + 多用户鉴权隔离 + SSRF 防护
> 基于 `jimen2api` 的「Bearer 拆分 + 随机选号」思路扩展而来（设计文档见 `docs/需求2-系统设计.md`）

---

## 1. 项目入口（Entry Points）

| 模块 | 入口文件 | 说明 |
| --- | --- | --- |
| 后端（NestJS） | `backend/src/main.ts` | 启动文件，`app.listen(PORT, HOST)`，仅监听内网/回环（Nginx 前置） |
| 后端根模块 | `backend/src/app.module.ts` | 全局模块装配（Config / Prisma / Egress / Auth / Users / KeyPool / Generation / Libraries / Tasks） |
| 前端（Vite+React） | `frontend/index.html` → `frontend/src/main.tsx` → `frontend/src/App.tsx` | SPA 入口 |
| 一键部署 | `docker-compose.yml` | app + postgres(+redis) + 前端 |

后端所有路由以 `/api` 前缀暴露，例如：
- `POST /api/auth/login`
- `GET  /api/auth/me`
- `POST /api/generation`
- `GET  /api/tasks`
- `GET  /api/libraries/characters`

---

## 2. 目录结构

```
aigen-panel/
├── docker-compose.yml          # 一键编排（postgres + redis + backend + frontend）
├── README.md                   # 本文件
├── docs/
│   └── 需求2-系统设计.md        # 系统设计文档（与 jimen2api 的关系、数据模型、鉴权矩阵…）
├── backend/
│   ├── .env.example            # 配置模板（DATABASE_URL / JWT / Key 池 / 出站白名单 …）
│   ├── package.json
│   ├── prisma/schema.prisma    # 数据模型（users/api_keys/characters/songs/prompts/tasks/media/tags）
│   └── src/
│       ├── main.ts             # ★ 后端入口
│       ├── app.module.ts       # ★ 根模块
│       ├── common/             # 角色枚举、守卫、过滤器、分页 DTO、tokenSplit/_.sample 工具
│       ├── config/             # 集中读取 .env
│       ├── prisma/             # PrismaService
│       ├── auth/               # 登录、JWT(access+refresh, HttpOnly Cookie)、argon2 哈希、角色守卫
│       ├── users/              # 仅 super_admin 可管理的用户 CRUD
│       ├── key-pool/           # Bearer 拆分 + 随机选号（复用 jimen2api），系统/用户级 Key 池
│       ├── egress/             # EgressGuard：SSRF 防护（禁内网 + 出站白名单）
│       ├── generation/         # 生成编排 + 各 provider（image/digital-human/video）
│       ├── libraries/          # 形象库 / 歌曲库 / 提示词库 CRUD（共享、标签分类）
│       ├── tasks/              # 任务 CRUD + 分页 + 按 user_id 隔离
│       └── media/              # 生成结果自动下载落地
└── frontend/
    ├── index.html
    └── src/
        ├── main.tsx            # ★ 前端入口
        ├── api/                # axios 客户端（携带 Cookie 凭证）
        ├── layout/             # 侧边栏布局
        └── pages/              # Login / ImageGen / DigitalHuman / VideoGen / Characters / Songs / Prompts / Tasks / Users / ApiKeys
```

---

## 3. 快速开始

### 方式 A：Docker Compose（推荐）
```bash
cp backend/.env.example backend/.env   # 务必修改 JWT_SECRET 等
docker compose up -d --build
# 前端 http://localhost ，后端 http://localhost:8000/api
```

### 方式 B：本地开发
```bash
# 1) 数据库（需 PostgreSQL 18）
createdb aigen_panel   # 或 docker run -e POSTGRES_DB=aigen_panel -e POSTGRES_PASSWORD=abc123 -p 5432:5432 postgres:18

# 2) 后端
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev

# 3) 前端
cd ../frontend
npm install
npm run dev
```

初始化首个管理员：调用 `POST /api/users`（需先用 seed 或临时把首个请求放开）。本项目附带 `prisma/seed.ts`：
```bash
npm run prisma:seed   # 创建管理员 admin / admin123456（仅首次）
```

---

## 4. 与 jimen2api 的核心复用点

| 概念 | jimen2api 来源 | 本系统落点 |
| --- | --- | --- |
| Bearer 拆分 | `core.ts:824 tokenSplit` | `common/utils/token-split.util.ts` |
| 随机选号 | `routes/images.ts:32 _.sample` | `token-split.util.ts#sampleToken` |
| 系统 Key 池 | 请求头塞多个 token | `.env` 逗号拆分 + `KeyPoolService.getSystemKeys` |
| 合并池选号 | 运行时随机一个 session | `KeyPoolService.selectKey`（用户 Key ∪ 系统 Key ∪ 请求自带池） |

差异：本系统在 jimen2api 基础上补齐了 **多用户鉴权、数据隔离、SSRF 出站管控、凭据加密、PostgreSQL 持久化、三库与任务管理**。

---

## 5. 设计要点速查

- **鉴权**：JWT access(15m)+refresh(7d)，HttpOnly+SameSite=Lax Cookie；argon2id 加盐哈希；仅 super_admin 可建用户。
- **隔离**：`tasks`/`character_images`/`api_keys` 按 `user_id` 隔离；`characters`/`songs`/`prompts` 全站共享。
- **网络范围（需求 #12）**：`EgressGuard` 在出站前解析 DNS 拒绝内网地址，普通用户仅放行 `ALLOWED_EGRESS_HOSTS`。
- **自动下载保存**：生成结果 URL 经 `MediaService` 落地到 `STORAGE_PATH`（可切换 S3/MinIO）。
- **分页（需求 #2）**：所有列表接口统一 `page/page_size/q/sort/order/tag/category`，参数拼 URL。

详见 `docs/需求2-系统设计.md`。
