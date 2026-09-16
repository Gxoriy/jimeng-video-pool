# AI 生成面板（aigen-panel）

> 多用户 Web 服务，面向**数字人内容生产**：以统一的**视频工作区**（`/video-workspace`）为主线，挂接形象库 / 歌曲库 / 提示词库三大共享素材库，并叠加**即梦资源池**作为另一条生成链路。
> 早期思路源自 `jimen2api`，后演进为「统一视频工作区 + 素材库 + 即梦账号池」架构（设计文档见 `docs/需求2-系统设计.md`）。
> 配套：AI 渠道配置管理（仅管理员）· 即梦账号池管理（仅超级管理员）· 任务管理 + 多用户数据隔离 + SSRF 防护。

---

## 1. 核心功能（视频工作区 + 素材库 + 即梦资源池）

多用户 Web 服务，面向**数字人内容生产**。当前主线入口是统一的**视频工作区**（`/video-workspace`）：选素材 → 写 / 扩写动作提示词 → RunningHub 生成视频；其下挂三个全站共享的**素材库**（形象库 / 歌曲库 / 提示词库），并可叠加**即梦资源池**（§8）作为另一条生成链路。

| 页面（侧边栏） | 路由 | 说明 |
| --- | --- | --- |
| 概览 | `/dashboard` | 仪表盘 |
| **视频工作区** | `/video-workspace` | 统一视频生成：选形象 / 歌曲 → 填动作提示词（可「提示词扩写」）→ 生成 |
| 形象库 | `/libraries/characters` | 数字人形象（多风格图）管理、批量导入、再生成新风格（§11） |
| 歌曲库 | `/libraries/songs` | 歌曲管理与批量导入 + AI 识别归档（§5.4） |
| 提示词库 | `/libraries/prompts` | 形象 / 动作提示词，支持 AI 智能分类（§10） |
| 即梦生成 | `/jimeng-gen` | 用即梦账号池直接生图 / 视频（§8） |
| 任务管理 / 任务日志 | `/tasks` / `/task-logs` | 任务与执行日志（按 `user_id` 隔离） |
| 个人设置 | `/settings` | RunningHub Key / Hedra Cookie（加密存储） |

**关于 P1 / P2 / P3 端点：** 早期独立的三个阶段页面（`/character-gen`、`/inspiration`、`/video`）已全部重定向到 `/video-workspace`。其对应的后端端点仍保留并作为内部能力被复用：

- `POST /api/pipeline/character`（生成形象）—— 被形象库「再生成新风格」调用；
- `POST /api/pipeline/inspiration`（获取灵感，产出动作提示词）—— 作为「提示词扩写」失败时的降级链路（§9）；
- `POST /api/pipeline/video`（视频生成，RunningHub）—— 由视频工作区在用户确认后调用。

**关键设计约束：**
- 形象生成 / 灵感等 AI 能力必须走**管理员在后台配置的 AI 渠道**（用户不能自建渠道）；AI 渠道为系统级，仅 `super_admin` 可增删改（`/api/ai-channels`，受 `RolesGuard` 保护）。
- 视频生成消耗 RunningHub **R 币**，新用户免费额度仅 100R，**不足以覆盖一次视频生成**。因此改为**每个用户在「个人设置」里填写自己的 RunningHub API Key**（AES-256-GCM 加密存储于 `users.runninghubKeyEnc`），后端 `requireRunninghubKey(userId)` 仅在密钥存在时放行，不存在即拦截并提示去填写。
- 用户数据隔离：`tasks` / `media` / `users.runninghubKeyEnc` 按 `user_id` 隔离；`characters` / `songs` / `prompts` 为全站共享素材库。
- 平台内置**即梦资源池（§8）**：管理员统一导入即梦账号 Cookie、自动查活与每日签到养号，普通用户即可用账号池直接生成图片 / 视频，作为 RunningHub 之外的另一条生成链路。

视频工作区的动作提示词可保存到提示词库（§10）、从提示词库选取，亦可一键「提示词扩写」（§9，基于 Hedra 逆向 API）得到更专业的提示词。

---

## 2. 项目入口（Entry Points）

| 模块 | 入口文件 | 说明 |
| --- | --- | --- |
| 后端（NestJS） | `backend/src/main.ts` | 启动文件，`app.listen(PORT, HOST)`，仅监听内网/回环（Nginx 前置）；全局前缀 `/api` |
| 后端根模块 | `backend/src/app.module.ts` | 全局模块装配（Config / Prisma / Egress / Auth / Users / Settings / Uploads / Pipeline / Libraries / Tasks / AiChannels / Media / TaskLogs） |
| 前端（Vite+React） | `frontend/index.html` → `frontend/src/main.tsx` → `frontend/src/App.tsx` | SPA 入口，路由：`/video-workspace`、`/libraries/characters`、`/libraries/songs`、`/libraries/prompts`、`/jimeng-gen`、`/settings`、`/ai-channels` 等（旧 `/character-gen`、`/inspiration`、`/video` 已重定向到 `/video-workspace`） |
| 一键部署 | `docker-compose.yml` | app + postgres(+redis) + backend + frontend |

后端所有路由以 `/api` 前缀暴露，例如：
- `POST /api/auth/login` · `GET /api/auth/me`
- `POST /api/pipeline/character` · `POST /api/pipeline/inspiration` · `POST /api/pipeline/video`
- `GET  /api/pipeline/channels?stage=character` — 列出可用 AI 渠道（不含 Key）
- `GET  /api/pipeline/video/node-map` — 当前 RunningHub 节点映射配置完整性自检
- `GET  /api/pipeline/video/account` — 当前用户 RunningHub 账户状态
- `GET  /api/settings` · `PUT /api/settings/runninghub-key` · `POST /api/settings/runninghub-key/test`
- `GET/POST/PUT/DELETE /api/ai-channels` — **AI 渠道配置 CRUD（仅 super_admin）**
- `GET  /api/libraries/characters` · `/songs` · `/prompts`

---

## 3. 目录结构

```
aigen-panel/
├── docker-compose.yml          # 一键编排（postgres + redis + backend + frontend）
├── README.md                   # 本文件
├── docs/
│   └── 需求2-系统设计.md        # 系统设计文档
├── backend/
│   ├── .env.example            # 配置模板（含 RUNNINGHUB_NODE_MAP）
│   ├── package.json
│   ├── prisma/schema.prisma    # 数据模型（users/ai_channels/characters/songs/prompts/tasks/task_logs/uploads/media/tags）
│   └── src/
│       ├── main.ts             # ★ 后端入口
│       ├── app.module.ts       # ★ 根模块
│       ├── common/             # 角色枚举、守卫、过滤器、分页 DTO、加密工具、常量
│       ├── config/             # 集中读取 .env（含 RUNNINGHUB_NODE_MAP 解析）
│       ├── prisma/             # PrismaService（@Global）
│       ├── auth/               # 登录、JWT(access+refresh, HttpOnly Cookie)、argon2 哈希、角色守卫
│       ├── users/              # 仅 super_admin 可管理的用户 CRUD
│       ├── settings/           # ★ 用户个人设置（RunningHub Key 加密存取、余额自检）
│       ├── uploads/            # ★ 参考图/音频上传（multer，按 user_id 隔离）
│       ├── pipeline/           # ★ 统一视频工作区（workspace）+ 三阶段流水线能力（character/inspiration/video）
│       │   ├── pipeline.controller.ts
│       │   ├── character-gen.service.ts   # 生成形象（P1）
│       │   ├── inspiration.service.ts     # 获取灵感 / 动作提示词（P2）
│       │   ├── video-gen.service.ts       # 视频生成（P3，RunningHub）
│       │   ├── workspace.service.ts       # 统一视频工作区任务（提示词扩写→视频生成）
│       │   ├── clients/                   # ai-channel.client / runninghub.client / hedra.client（提示词扩写）
│       │   ├── asset-resolver.service.ts  # 上传/形象库/歌曲库 资源解析
│       │   ├── task-recorder.service.ts   # 任务与日志落地
│       │   └── dto/pipeline.dto.ts
│       ├── ai-channels/        # AI 渠道配置（CRUD + 获取模型列表 + 测试 + 加密存储，仅管理员）
│       ├── egress/             # EgressGuard：SSRF 防护（@Global）
│       ├── libraries/          # 形象库 / 歌曲库 / 提示词库 CRUD（含批量导入）
│       ├── tasks/              # 任务 CRUD + 分页 + 按 user_id 隔离
│       ├── task-logs/          # 任务执行日志
│       ├── media/              # 生成结果自动下载落地（@Global）
│       └── jimeng/             # 即梦资源池：账号池 / Cookie 导入 / 查活·签到·自愈 / 图·视频生成 / 外部号池
└── frontend/
    ├── index.html
    └── src/
        ├── main.tsx            # ★ 前端入口
        ├── api/                # axios 客户端（携带 Cookie 凭证）+ pipeline.ts 封装
        ├── layout/             # 侧边栏布局（视频工作区/素材库/设置/AI渠道 导航）
        ├── components/         # SourcePickers（图片/音频来源选择器）
        └── pages/              # Login / Dashboard / VideoWorkspace(统一视频工作区) / Characters(形象库) / Songs(歌曲库) / Prompts(提示词库) / JimengGen / JimengAccounts / Settings / AiChannels / Tasks / TaskLogs / Users / MediaLibrary
```

---

## 4. 快速开始

### 方式 A：Docker Compose（推荐）
```bash
cp backend/.env.example backend/.env   # 务必修改 JWT_SECRET 等
docker compose up -d --build
# 前端 http://localhost ，后端 http://localhost:8000/api
```

### 方式 B：本地开发
```bash
# 1) 数据库（需 PostgreSQL 18）
createdb jimen2api-all   # 与《需求2-系统设计》约定的 DATABASE_URL 一致

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
npm run dev              # http://127.0.0.1:5173 （SPA 回退已配置，刷新不再 404）
```

初始化首个管理员：`npm run prisma:seed` → admin / admin123456

---

## 5. 部署配置要点

### 5.1 AI 渠道（P1/P2 用，管理员配置）
- 入口：侧边栏「AI 渠道配置」（仅 `super_admin` 可见）或顶部「更多 → AI 渠道配置」。
- 每个渠道包含：名称、协议（OpenAI 兼容）、Base URL、API Key（AES 加密存储）、默认模型 + 「获取模型列表」按钮（`/v1/models`）、`usableFor`（可用于 character / inspiration 哪些阶段）、能力开关（supportsImage / supportsVision / streaming）、可选代理地址。
- 用户在前端生成形象 / 获取灵感等流程中**只能选择**已启用且声明支持对应阶段的渠道，不能自建。

### 5.2 RunningHub 节点映射（P3 用，运维/部署者配置）
RunningHub 工作流 `2031016553440878594` 的「表单字段 → ComfyUI 节点」映射通过 `.env` 的 `RUNNINGHUB_NODE_MAP` 配置（**JSON 对象**，按字段名索引，完整结构见 `backend/src/config/configuration.ts` 的 `DEFAULT_NODE_MAP`）：

```json
{
  "image":             { "nodeId": "444",  "fieldName": "image" },
  "audio":             { "nodeId": "1755", "fieldName": "audio" },
  "durationSeconds":   { "nodeId": "1583", "fieldName": "value" },
  "audioStartSeconds": { "nodeId": "1776", "fieldName": "value" },
  "actionPrompt":      { "nodeId": "1624", "fieldName": "value" },
  "maxResolution":     { "nodeId": "1606", "fieldName": "value" },
  "fps":               { "nodeId": "1586", "fieldName": "value" }
}
```

> **已内置默认值**：上述节点编号取自官方 API 文档、对应工作流 `2031016553440878594`，已在 `configuration.ts` 的 `DEFAULT_NODE_MAP` 预置。**只要你的工作流节点编号与此一致，无需任何配置即可直接跑通**；仅当节点编号不同时，才用 `.env` 的 `RUNNINGHUB_NODE_MAP` 覆盖同名键。

- 该工作流只有「音频起始秒」单个对口型偏移节点，**没有独立的「结束秒」节点**，因此 `audioEndSeconds` 不在此映射中（前端也只暴露起始秒输入框）。
- `video-gen.service.ts` 的 `buildNodeInfoList` 按字段名查表组装 `nodeInfoList`（含可选的 `description` 调试图示）；缺失映射的字段会被跳过并告警，若最终列表为空则直接报错。
- 前端 `GET /api/pipeline/video/node-map` 会返回「已配置 / 缺失」清单，部署后若视频生成报错，先到该接口核对映射是否补全。
- 简写支持：单个字段也可写作 `"image": "444:image"`（即 `nodeId:fieldName`）。

**视频生成（RunningHub）实际调用的 OpenAPI（均带 `Authorization: Bearer <用户自己的 Key>`）：**
- 上传文件：`POST {RUNNINGHUB_API_BASE}/openapi/v2/media/upload/binary`（multipart `file`，返回 `data.fileName`/`download_url`）
- 提交工作流：`POST {RUNNINGHUB_API_BASE}/openapi/v2/run/ai-app/{workflowId}`（body `{nodeInfoList, instanceType, usePersonalQueue}`）
- 轮询状态：`POST {RUNNINGHUB_API_BASE}/openapi/v2/query`（body `{taskId}`，`status` 取 `QUEUED/RUNNING/SUCCESS/FAILED`，`results[].url` 有效期仅 24h，需尽快落地）

### 5.3 用户个人 RunningHub Key（P3 用，终端用户填写）
- 入口：侧边栏「个人设置」→ 填写 RunningHub API Key；支持「测试」按钮（best-effort 调用账户余额接口，展示 R 币余额）。
- 加密存储于 `users.runninghubKeyEnc`；后端取用时 `SettingsService.requireRunninghubKey` 解密，**不存在即拦截**并提示用户去填写，绝不使用共享 Key。

### 5.4 歌曲库批量导入 + AI 识别归档
歌曲库页面提供「批量导入」标签页，支持两种方式录入：

1. **本地文件上传**：多选音频文件 → 经 `/uploads/audio` 落盘 → ffprobe 读取时长 → 文件名猜测「歌名-作者」→ AI 识别。
2. **歌名-作者 自动下载**：粘贴多行「歌名-作者」文本（支持 `-`/`—`/`–` 分隔）→ 调音乐聚合源（默认 `kw-api.cenguigui.cn`，可改 `MUSIC_SOURCE_BASE`）搜索并下载 mp3 + 元数据 + LRC 歌词 → AI 识别。
   - 音乐源逻辑参考 `suno_auto_production-master/docs/歌曲下载与歌词获取_功能实现文档.md`（kuwo 聚合 API）。
   - 下载音频落盘到 `storagePath/songs/`；出站统一走受信 BROAD 范围（仍受 EgressGuard 内网拦截保护）。

**AI 识别与归档流程（核心）**：
- 录入的每首歌都会先调**管理员配置的 `song` 阶段 AI 渠道**（无则回退 `inspiration` 渠道，再无则退化为「原名 + `待分类` 标签」），由 AI 补全/标准化歌名、识别语种、给出一级分类与 3~6 个细粒度标签。
- 所有导入歌曲**先以 `pending_review` 状态入库**，进入「歌曲库 / 待审核」列表；由人工对 AI 给出的标签与基本信息做**增删改查**检验后，点击「归档」才转为 `active`。
- 只有 `active` 状态的歌曲会出现在视频工作区 / 形象库 / 生成流程的音频选择器中；`pending_review` 不会被选入生成流程，避免未审核素材污染产出。
- 同名（歌名+作者）已存在时默认跳过，可勾选「覆盖」更新。
- 后端接口：`POST /api/song-import/from-text`、`POST /api/song-import/from-upload`、`POST /api/libraries/songs/:id/archive`、`GET /api/libraries/songs?status=...`。

---

## 6. 设计要点速查

- **鉴权**：JWT access(15m)+refresh(7d)，HttpOnly+SameSite=Lax Cookie；argon2id 加盐哈希；仅 `super_admin` 可建用户。
- **隔离**：`tasks` / `media` / `users.runninghubKeyEnc` 按 `user_id` 隔离；`characters` / `songs` / `prompts` 全站共享。
- **AI 渠道权限**：`ai_channels` 为系统级，**仅管理员**维护；用户只能选用，不能新增/修改/查看 Key。
- **网络范围**：`EgressGuard` 在出站前解析 DNS 拒绝内网地址，普通用户仅放行 `ALLOWED_EGRESS_HOSTS`。
- **自动下载保存**：P1/P3 生成结果 URL 经 `MediaService` 落地到 `STORAGE_PATH`（`@Global`）。
- **分页**：所有列表接口统一 `page/page_size/q/sort/order/tag/category` 参数。
- **取消 Key 池**：出于「视频生成 R 币 > 新用户免费额度」的考量，已**移除** Bearer 拆分 + 随机选号逻辑，视频生成统一使用用户自填 Key。
- **前端工作区草稿**：视频工作区的素材选择、动作提示词、生成参数实时写入 `localStorage`（key: `aigen-panel-video-workspace-draft`），切换菜单 / 按 F5 / 关标签页重开都能恢复；退出登录时清除。
- **响应格式约定**：控制器统一返回 `{ code, message, data }`，`data` 必须是已 `await` 的值。全局 `ResponseNormalizeInterceptor` 会兜底 await 嵌套 Promise，防止 `data` 被序列化成 `{}`。

详见 `docs/需求2-系统设计.md`。

---

## 7. 桌面端打包（Electron）与 macOS「文件已损坏」问题

桌面端由 `frontend` 的 Electron + electron-builder 打包，CI 见 `.github/workflows/build.yml`，产出 Windows NSIS 安装包与 macOS arm64 dmg。

### 7.1 为什么 macOS 会提示「文件已损坏，无法打开」
macOS 的 Gatekeeper 会拦截**未签名 / 未公证**的 `.app`。当前默认配置 `frontend/package.json` 中 `mac.identity: null`，即**不签名**，
因此下载到他人 Mac 上双击会报 `“AI生成面板” 已损坏，无法打开。 请移到废纸篓。`。

这是**预期行为**，不是构建 Bug。有三种解决路径：

| 方案 | 成本 | 效果 | 适用 |
| --- | --- | --- | --- |
| A. 用户侧手动放行 | 0 | 仅本机可用，需每台机器执行一次 | 内部小范围分发 |
| B. 仅签名（无公证） | 需 $99 Apple Developer | 本机/同账号可正常打开，跨设备仍可能被拦 | 团队内部分发 |
| C. 签名 + 公证（推荐） | 需 $99 + 配置 Secrets | 任意 Mac 直接打开，无警告 | 正式对外发布 |

**方案 A（临时救急，用户执行一次）：**
```bash
# 在「系统设置 → 隐私与安全性」点「仍要打开」；或终端放行：
sudo xattr -rd com.apple.quarantine /Applications/AI生成面板.app
```

**方案 C（彻底解决，配置一次即自动化）：** 在仓库 `Settings → Secrets` 增加以下 Secrets，CI 会通过 `electron-builder` 自动签名并公证：
```
MAC_CSC_LINK                 # 导出的 Apple 发行证书 p12（base64 或文件 URL）
MAC_CSC_KEY_PASSWORD         # p12 密码
APPLE_ID                     # 开发者 Apple ID
APPLE_APP_SPECIFIC_PASSWORD  # 专用密码（appleid.apple.com 生成）
APPLE_TEAM_ID                # 团队 ID
```
配置后，`build.yml` 会注入这些变量并自动将 `mac.identity` 从 `null` 切到证书；同时 `hardenedRuntime: true` 已开启以兼容公证。
未配置时 CI 仍按未签名方式构建，但**会做 dmg 完整性校验**（hdiutil + 体积检查），避免上传真正的坏包。

### 7.2 构建健壮性增强（已落地）
- `frontend/package.json`：移除硬编码的本地 Windows 输出路径，统一输出到相对目录 `release`；`mac.hardenedRuntime: true` 为公证铺路。
- `build.yml`：Windows / macOS 构建后都会**校验产物真实存在且体积 > 1MB**，并通过 `hdiutil imageinfo` 校验 dmg 是否为合法镜像；发布到 GitHub Release 后再做一次完整性检查，杜绝「坏包上线」。
- `frontend/electron/main.cjs`：
  - 后端启动由固定 `setTimeout(2000)` 改为**健康检查轮询**（`/health`，最多等 30s），就绪后再弹窗；
  - 后端异常退出时**自动自愈重启**（最多 3 次），主动退出（`before-quit`）不触发重启；
  - 优雅关闭对 `kill` 做异常兜底，避免偶发 EPERM 崩溃。

### 7.3 本地打包命令
```bash
cd frontend
npm install
npm run build && npx electron-builder --mac --config.directories.output=release --publish never
# 产物位于 frontend/release/*.dmg
```

---

## 8. 即梦资源池（Jimeng Account Pool）

即梦（Jimeng）资源池是平台内置的「账号 / Cookie 池」能力：管理员导入即梦网站账号的 Cookie，系统统一保管、查活、养号（每日签到）、按需选号，为**图片生成**与**视频生成**提供即梦平台的调用身份。所有出网请求都经 `EgressGuard` 做 SSRF 防护（仅放行 `allowedEgressHosts` 并拒绝内网地址）。

### 8.1 角色与权限

| 能力 | 控制器 | 路由前缀 | 权限 |
| --- | --- | --- | --- |
| 账号池管理（导入 / 查活 / 签到 / 编辑 / 删除 / 同步外部号池） | `JimengAdminController` | `/api/admin/jimeng-accounts` | 仅 `super_admin`（`RolesGuard` + `JimengEnabledGuard`） |
| 生成（图 / 视频）、列表、上传 | `JimengController` | `/api/jimeng` | 任意登录用户（`JwtAuthGuard` + `JimengEnabledGuard`） |

- 功能总开关：`system_config.hideJimeng`。值为 `'true'` 时 `JimengEnabledGuard` 返回 403，前端 `/jimeng-gen`、`/jimeng-accounts` 路由被 `RequireJimengEnabled` 重定向到 `/dashboard`。
- 前端入口：侧边栏「即梦账号池」（`/jimeng-accounts`，仅管理员）与「即梦生成」（`/jimeng-gen`）。

### 8.2 数据模型

- **`jimeng_accounts`**（账号记录），关键字段：
  - `sessionid`：从导入 Cookie 提取的核心 token（= `sid_tt` = `sessionid_ss`），用于重建调用即梦的 Cookie；
  - `cookie_enc`：整份 Cookie map 的**加密**存储（AES-256-GCM），仅作登录失败时的兜底查值来源；
  - `status`：`active` / `disabled` / `expired`；
  - `credits` / `credits_used`：最近查询到的剩余积分 / 累计消耗（用于选号权重与养号闭环）；
  - `last_checkin_at` / `checkin_streak`：最近一次每日签到时间 / 连续签到天数；
  - `expire_at`：由 sessionid 的过期时间推断，用于过期提醒。
- **`jimeng_tasks`**：即梦异步生成任务（关联 `tasks.id`），记录 `external_task_id`、状态、进度、`account_id`、本次 `credits_used`。
- **`system_config`**：全局开关（含 `hideJimeng`）。**首次部署务必执行 `prisma migrate deploy` 或 `prisma db push` 建表**，否则即梦接口会报「读取即梦功能开关失败」。

### 8.3 Cookie 导入

入口：管理员「即梦账号池」→ 导入 Cookie，或 `POST /api/admin/jimeng-accounts/import`（`{ cookies, source }`）。

支持以下输入格式（`jimeng-cookie-parser`）：

1. **浏览器导出的整份 Cookie JSON 数组**：`[{"name":"sessionid","value":"...","domain":"..."}, ...]`；
2. **多账号换行分隔**：每段一个账号；
3. **Netscape Cookie 文本**（Tab 分隔，`domain\tTRUE\tpath\t...\tsessionid\tvalue`）；
4. **`name=value; name2=value2` 头字符串**。

导入时只提取 `sessionid`（缺失时回退 `sessionid_ss` / `sid_tt`），并用它**重建**调用即梦时使用的 Cookie；整份 Cookie map 加密落库作为兜底。列表接口对 sessionid 做脱敏掩码（`xxxx****xxxx`）。

> **Cookie 说明**：即梦长效 Cookie 可能过期。系统通过「查活」用长效 Cookie 访问即梦网站接口兑换**短效 Cookie**（`/passport/account/info/v2` 的 `Set-Cookie`），并写回 `sessionid` 等字段，从而延长可用期。

### 8.4 账号运营（查活 / 签到 / 自愈 / 选号）

- **查活（check）**：`refreshSession` → 先用 `/commerce/v1/benefits/user_credit` 查积分作为最可靠的存活判定（积分不足 `ret=5000/1006` 仍视为存活），再尝试从护照接口捕获刷新的短效 Cookie 写回。回写 `status` / `credits` / `last_check_at`。
- **每日签到（checkin / 养号）**：`/commerce/v1/benefits/credit_receive` 领取当日积分；若登录态失效先 `selfHeal`。`JimengCheckinService` 按 `JIMENG_CHECKIN_INTERVAL_MS`（默认 30 分钟）**自动全量签到**，按 `Asia/Shanghai` 判定「今日是否已签」，并累计连续签到天数 `checkin_streak`。开关：`JIMENG_CHECKIN_ENABLED=false` 可关闭。
- **自愈（selfHeal）**：生成或签到遇登录失效时，优先 `refresh` 兑换短效 Cookie；失败再从加密的整份 Cookie map 取真实 sessionid 兜底。
- **选号（selectOne）**：生成前从 `active` 且未过期账号中，按「可用积分 = `credits - credits_used`」**加权随机**选取，并实时回刷即梦真实余额；自动跳过余额为 0 或已失效的号，将 `1006/5000` 标记为 `credits=0`、其他失败标记为 `expired`，避免反复选中空号触发积分不足。单实例并发锁避免同号并发。

### 8.5 图 / 视频生成流程

用户侧接口（`/api/jimeng`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/jimeng/image/generate` | 提交图片生成 |
| GET | `/jimeng/image/task/:taskId` | 轮询图片结果 |
| POST | `/jimeng/video/generate` | 提交视频生成 |
| GET | `/jimeng/video/task/:taskId` | 轮询视频结果 |
| POST | `/jimeng/upload` | 上传参考图 / 视频 / 音频（`category`） |
| GET | `/jimeng/accounts` · `/jimeng/accounts/summary` | 账号列表 / 汇总（含总积分） |

流程（`JimengVideoService` / `JimengImageService`）：

1. 解析提示词与 `@提及` 参考（`ReferenceItemDto`：角色 / 动作 / 风格 / 全能参考 `omni`）；
2. `accountService.selectOne()` 按权重选号；
3. 参考图经 `JimengCoreService.uploadFile` 上传到 ByteDance ImageX（`imagex.bytedanceapi.com`，AWS SigV4），拿到 `image_uri`；
4. 调即梦 `aigc_draft/generate` 提交任务，轮询 `get_history_by_ids` 直到完成，结果按 `MediaService` / `STORAGE_PATH` 配置落地；
5. 任务全程记入 `jimeng_tasks`，回写 `account_id` 与本次 `credits_used`。

内置模型映射（旧模型名已下线，自动映射到可用内部名）：

- **图片**：`jimeng-5.0 / 4.6 / 4.5 / 4.1 / 4.0`（内部 `high_aes_general_vXX`）；
- **视频**：`jimeng-video-3.5-pro / 3.0-pro / 3.0 / 2.0`、`seedance-2.0 / 2.0-mini`。

### 8.6 外部号池（可选，概念 B）

配置 `EXTERNAL_POOL_BASE_URL`（默认关闭）后，可在账号池点击「同步外部号池」（`POST /api/admin/jimeng-accounts/sync-external`）从外部 `:18813` 号池服务拉取账号，落地为 `source='external'`，与本地导入账号（`source='local'`）共用同一套查活 / 签到 / 选号逻辑。

### 8.7 部署与配置要点

- **SSRF / 出网**：所有即梦请求经 `EgressHttpService`，`jimeng.jianying.com` 已在默认 `allowedEgressHosts` 放行；管理员请求用 `BROAD` 范围，普通用户用 `RESTRICTED`。`EgressGuard` 会解析 DNS 拒绝内网地址（私网 / 回环 / 链路本地）。
  - 在把外部域名解析到出口代理的沙箱环境里，若域名同时解析出 `fd00::/8` 这类 ULA IPv6，可能被误判为内网而拦截；本服务已采用「**仅当全部解析地址均为私网才拒绝**」的判定，放行此类双栈环境。
- **环境变量**：
  - `EXTERNAL_POOL_BASE_URL`：外部号池地址（留空则功能关闭）；
  - `JIMENG_CHECKIN_ENABLED`：每日自动签到开关（`false` 关闭）；
  - `JIMENG_CHECKIN_INTERVAL_MS`：签到扫描间隔，默认 `1800000`（30 分钟）；
  - `ALLOWED_EGRESS_HOSTS`：追加出网白名单（CSV），默认已含 `jimeng.jianying.com`、`*.bytedanceapi.com`、`*.byteimg.com`、`www.hedra.com`、`*.hedra.com`。
- **加密**：Cookie 与 sessionid 均用 AES-256-GCM（`common/utils/encryption.util`）加密存储；密钥来自 `.env`，请勿泄露。

---

## 9. 提示词扩写（基于 Hedra 逆向 API）

视频工作区的「**提示词扩写**」按钮可在用户填好简短动作提示词后，调用 Hedra 接口将其扩写为更专业、更具镜头 / 情绪细节的版本，结果回填到输入框，由用户决定是否继续生成视频（不会自动覆盖原意）。

- **接口**：`POST /api/pipeline/hedra/expand`（纯文本，不生成视频）；`POST /api/pipeline/hedra/test` 用于验证 Hedra cookie 与网络连通性。
- **底层实现**：`backend/src/pipeline/clients/hedra.client.ts` 的 Hedra 提示词扩写客户端（浏览器无关、纯 HTTP）。其端点（`POST https://www.hedra.com/api/messages`）来自**逆向**得到的 Hedra API（源文件注释「逆向来源：Hedra 逆向 API 结果」），因此也常被称为「逆向扩写」。
- **降级策略**（仅手动点「提示词扩写」时触发）：先用 Hedra 扩写；若 Hedra 失败（cookie 无效 / 网络异常），自动降级到 **AI 灵感**（`POST /api/pipeline/inspiration`，需参考图 + 参考音频作为上下文）；两者都失败才报错。
- **个人 Hedra Cookie**：用户在「个人设置 → Hedra Cookie」填写自己的 Hedra 账户 cookie（`PUT /settings/hedra-cookie`，AES-256-GCM 加密），生成时优先用个人 cookie，缺省回退全局 `.env` 的 `HEDRA_COOKIE_PATH`；`POST /settings/hedra-cookie/test` 可验登录态。该请求走受信 `BROAD` 范围。
- **注意**：Hedra cookie 为第三方账户态，过期需重新填写；它只用于文本扩写，不参与视频渲染。

---

## 10. 提示词库

三库共享素材库之一（另两个为形象库 §11、歌曲库 §5.4），全站共享、不参与 `user_id` 隔离。页面：`/libraries/prompts`。

- **两类提示词**：
  - `type=character`（形象提示词）：用于生成形象 / 形象库「再生成新风格」；
  - `type=action`（动作提示词）：用于视频工作区的动作提示词。
- **CRUD**：`GET/POST/PUT/DELETE /api/libraries/prompts`；列表支持 `page/page_size/q/type/tag` 分页与筛选（前端 `Prompts.tsx`）。
- **AI 智能分类**：`POST /api/libraries/prompts/:id/classify` 调用管理员配置的 `song` 阶段 AI 渠道（回退 `inspiration`），依据「标题 + 正文」产出 `category` 与 3~6 个 `tags`（一级分类候选：人物写真 / 二次元 / 古风 / 写实风 / 商业广告 / 演唱表演 / 舞蹈表演 / 口播讲解 / 情感叙事 / 其他）。AI 不可用或失败时保留原值不中断；批量导入时默认对新条目自动跑一次分类。
- **在生成流程中的使用**：视频工作区可「从提示词库选取 / 保存到提示词库」；形象库「再生成新风格」同样可选取 / 保存提示词。
- **数据模型**：`prompts(id, title, content, type, category, tags[], description, createdBy, ...)`。

---

## 11. 形象库

三库共享素材库之一，管理数字人**形象**及其**多张不同风格 / 背景的图**。页面：`/libraries/characters`。

- **数据模型**：
  - `characters`：形象主记录（`name` / `coverUrl` / `category` / `tags[]` / `description` / `status`）；
  - `character_images`：同一形象下的多张图（`url` / `localPath` 本地副本 / `prompt` / `model` / `style` 风格标签 / `status`）。
- **入库状态机**：批量导入经视觉 AI 识别后进入 `pending_review`（待审核）；人工「归档」后转 `active`。**只有 `active` 形象才会出现在视频工作区 / 生成选择器中**，避免未审核素材污染产出。
- **批量导入**：`POST /api/character-import/from-upload`（本地图片 → 视觉 AI 识别主体并自动分类 → 待审核）。同名默认跳过，`overwrite=true` 覆盖；`enableAi=false` 跳过 AI 直接入库。
- **形象管理**：编辑信息（改名 / 分类 / 标签）、删除（级联删图）、向已有形象**追加图片**（`POST /api/libraries/characters/:id/images`，含请求内与库内去重、并下载落盘本地副本）、单张图**风格重命名**（PATCH）、删除某张图（同步维护封面）、`backfill-local` 补全缺失的本地副本（外部链接可能过期时）。
- **再生成新风格**：勾选 1 张参考图 + 填提示词 → 调生成形象端点（`POST /api/pipeline/character`，`referenceCharacterImageId` + `saveToCharacterId`）。来源可选 **AI 渠道**（`size` 参数）或 **即梦生成**（`source=jimeng`，模型 `jimeng-5.0/4.6/4.5/4.1/4.0`，比例 `1:1/16:9/...`，分辨率 `1k/2k/4k`）；生成结果「确认后入库」。
- **本地副本**：生成的图会尽量下载到 `STORAGE_PATH` 得到 `localPath` 本地副本（即梦 CDN 需带 `Referer` 才能正确下载）；视频生成若引用**无本地副本**的远程图会报错，故提供「补全本地副本」按钮补回。
- **接口汇总**：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/libraries/characters` | 形象列表（分页 / `status` 过滤） |
| GET | `/api/libraries/characters/:id` | 形象详情（含全部风格图） |
| POST | `/api/libraries/characters/:id/images` | 追加图片（去重 + 落盘） |
| PATCH | `/api/libraries/characters/:id/images/:imageId` | 改风格 / 提示词 / URL |
| DELETE | `/api/libraries/characters/:id/images/:imageId` | 删图（维护封面） |
| POST | `/api/libraries/characters/:id/archive` | 待审核 → 归档 |
| POST | `/api/libraries/characters/:id/backfill-local` | 补全缺失本地副本 |
| PUT | `/api/libraries/characters/:id` | 编辑信息 |
| DELETE | `/api/libraries/characters/:id` | 删除形象 |
| POST | `/api/character-import/from-upload` | 批量导入（视觉 AI 识别） |

