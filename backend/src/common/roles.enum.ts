export enum Role {
  SUPER_ADMIN = 'super_admin',
  NORMAL_USER = 'normal_user',
}

export enum NetworkScope {
  RESTRICTED = 'restricted', // 普通用户：仅白名单公网，禁内网（需求 #12）
  BROAD = 'broad', // 超级管理员：可 broad（仍受 Nginx 管控）
}

export enum Provider {
  OPENAI = 'openai', // ChatGPT 生图 / 出提示词
  RUNNINGHUB = 'runninghub', // 数字人对口型 / 视频
}

// Prisma 枚举（运行时值 + 类型），从 @prisma/client 再导出以便统一引用
export { TaskType, TaskStatus, PromptType } from '@prisma/client';
