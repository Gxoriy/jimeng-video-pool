export enum Role {
  SUPER_ADMIN = 'super_admin',
  NORMAL_USER = 'normal_user',
}

export enum NetworkScope {
  RESTRICTED = 'restricted', // 普通用户：仅白名单公网，禁内网
  BROAD = 'broad', // 超级管理员：可 broad（仍受 Nginx 管控）
}

/** 执行方：P1/P2 走管理员配置的 AI 渠道；P3 走用户自备的 RunningHub Key */
export enum Executor {
  AI_CHANNEL = 'ai_channel',
  RUNNINGHUB = 'runninghub',
}

// Prisma 枚举（运行时值 + 类型），从 @prisma/client 再导出以便统一引用
export { TaskType, TaskStatus, PromptType } from '@prisma/client';
