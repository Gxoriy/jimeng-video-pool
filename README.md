# AI 生成面板（aigen-panel）

> 多用户 Web 服务，围绕**数字人内容生产的三阶段流水线**组织：
> **P1 生成形象**（AI 渠道生图）· **P2 获取灵感**（AI 渠道生成动作提示词）· **P3 视频生成**（RunningHub 工作流）
> 配套：AI 渠道配置管理（仅管理员）· 形象库 / 歌曲库 / 提示词库 · 任务管理 + 多用户数据隔离 + SSRF 防护
> 早期思路源自 `jimen2api`，但已重构为三阶段流水线（设计文档见 `docs/需求2-系统设计.md`）。

---

## 1. 三阶段流水线（核心）

| 阶段 | 路径（前端） | 后端端点 | 由谁完成 | 关键入参 |
| --- | --- | --- | --- | --- |
| **P1 生成形象** | `/character-gen` | `POST /api/pipeline/character` | 管理员配置的 **AI 渠道**（OpenAI 兼容生图） | 提示词（必填，可取自提示词库）/ 参考图（可选）/ 歌曲（音乐信息参考）/ 尺寸·数量 |
| **P2 获取灵感** | `/inspiration` | `POST /api/pipeline/inspiration` | 管理员配置的 **AI 渠道**（多模态 vision 对话） | 参考图（必填）+ 参考音频/歌曲（必填）→ 产出「动作提示词」 |
| **P3 视频生成** | `/video` | `POST /api/pipeline/video` | **用户自备 RunningHub Key** 调 RunningHub 工作流 | 图片（或数字人形象）+ 音频 + 生成秒数 + 对口型起止 + 动作提示词 + 分辨率 + 帧率 |

**关键设计约束（来自需求澄清）：**
- P1 / P2 必须走**管理员在后台配置的 AI 渠道**（用户不能自建渠道）；AI 渠道为系统级，仅 `super_admin` 可增删改（`/api/ai-channels`，受 `RolesGuard` 保护）。
- P3 视频生成消耗 RunningHub **R 币**，新用户免费额度仅 100R，**不足以覆盖一次视频生成**。因此**取消**了早期设计的「Bearer 拆分 + 随机选号 Key 池」策略，改为**每个用户在自己「个人设置」里填写自己的 RunningHub API Key**（AES-256-GCM 加密存储于 `users.runninghubKeyEnc`）。后端 `SettingsService.requireRunninghubKey(userId)` 仅在密钥存在时放行，不存在则直接报错提示用户去填写。
- 用户数据隔离：`tasks` / `media` / `users.runninghubKeyEnc` 按 `user_id` 隔离；`characters` / `songs` / `prompts` 为全站共享素材库。

P2 产出的动作提示词可一键「带入 P3 视频生成」（前端 `location.state` 透传）；P1 结果可保存进形象库供 P2/P3 直接选用。

---

## 2. 项目入口（Entry Points）

| 模块 | 入口文件 | 说明 |
| --- | --- | --- |
| 后端（NestJS） | `backend/src/main.ts` | 启动文件，`app.listen(PORT, HOST)`，仅监听内网/回环（Nginx 前置）；全局前缀 `/api` |
| 后端根模块 | `backend/src/app.module.ts` | 全局模块装配（Config / Prisma / Egress / Auth / Users / Settings / Uploads / Pipeline / Libraries / Tasks / AiChannels / Media / TaskLogs） |
| 前端（Vite+React） | `frontend/index.html` → `frontend/src/main.tsx` → `frontend/src/App.tsx` | SPA 入口，路由：`/character-gen`、`/inspiration`、`/video`、`/settings`、`/ai-channels` 等 |
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
│       ├── pipeline/           # ★ 三阶段流水线
│       │   ├── pipeline.controller.ts
│       │   ├── character-gen.service.ts   # P1
│       │   ├── inspiration.service.ts     # P2
│       │   ├── video-gen.service.ts       # P3（RunningHub）
│       │   ├── clients/                   # ai-channel.client / runninghub.client
│       │   ├── asset-resolver.service.ts  # 上传/形象库/歌曲库 资源解析
│       │   ├── task-recorder.service.ts   # 任务与日志落地
│       │   └── dto/pipeline.dto.ts
│       ├── ai-channels/        # AI 渠道配置（CRUD + 获取模型列表 + 测试 + 加密存储，仅管理员）
│       ├── egress/             # EgressGuard：SSRF 防护（@Global）
│       ├── libraries/          # 形象库 / 歌曲库 / 提示词库 CRUD（含批量导入）
│       ├── tasks/              # 任务 CRUD + 分页 + 按 user_id 隔离
│       ├── task-logs/          # 任务执行日志
│       └── media/              # 生成结果自动下载落地（@Global）
└── frontend/
    ├── index.html
    └── src/
        ├── main.tsx            # ★ 前端入口
        ├── api/                # axios 客户端（携带 Cookie 凭证）+ pipeline.ts 封装
        ├── layout/             # 侧边栏布局（P1/P2/P3/素材库/设置/AI渠道 导航）
        ├── components/         # SourcePickers（图片/音频来源选择器）
        └── pages/              # Login / Dashboard / CharacterGen(P1) / Inspiration(P2) / VideoGen(P3) / Settings / AiChannels / Characters / Songs / Prompts / Tasks / TaskLogs / Users
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
- 用户在前端 P1/P2 表单中**只能选择**已启用且声明支持对应阶段的渠道，不能自建。

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
- 前端 `GET /api/pipeline/video/node-map` 会返回「已配置 / 缺失」清单，部署后若 P3 报错，先到该接口核对映射是否补全。
- 简写支持：单个字段也可写作 `"image": "444:image"`（即 `nodeId:fieldName`）。

**P3 实际调用的 RunningHub OpenAPI（均带 `Authorization: Bearer <用户自己的 Key>`）：**
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
- 只有 `active` 状态的歌曲会出现在 P1/P2/P3 的音频选择器中；`pending_review` 不会被选入生成流程，避免未审核素材污染产出。
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
- **前端工作区草稿**：P1/P2/P3 的表单值、素材选择、任务进度与结果统一存放在 `TaskSessionProvider`，并实时写入 `localStorage`（key: `aigen-panel-workspace-v2`）。切换菜单、按 F5、关标签页重开都能恢复；点「清空表单」或退出登录时清除。
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

