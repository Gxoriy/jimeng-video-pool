import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX } from './common/constants';
import { HttpExceptionFilter, AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ResponseNormalizeInterceptor } from './common/interceptors/response-normalize.interceptor';

/**
 * 解析后端根目录（兼容两种打包布局）：
 *  - 本地 nest build：main.js 在 backend/dist/，prisma 在 backend/prisma
 *  - electron 打包：main.js 在 resources/backend/，prisma 在 resources/backend/prisma
 */
function resolveBackendDir(): string {
  const candidates = [
    join(__dirname, 'prisma', 'schema.prisma'),
    join(__dirname, '..', 'prisma', 'schema.prisma'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return join(c, '..', '..'); // X/prisma/schema.prisma -> X
  }
  return __dirname;
}

function resolvePrismaCli(backendDir: string): string | null {
  const candidates = [
    join(backendDir, 'node_modules', 'prisma', 'build', 'index.js'),
    join(backendDir, '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/**
 * 仅生产环境（Electron / 部署）执行，让新用户开箱即用：
 *  1) prisma migrate deploy —— 自动建表，确保即梦等新模块的数据表存在
 *  2) 若 user 表为空，创建默认管理员（admin / admin123456），否则无法登录
 * 失败仅记录日志，不阻断启动（让用户能在前端看到明确错误并自行修复）。
 */
async function ensureDatabase() {
  const backendDir = resolveBackendDir();
  const schemaPath = join(backendDir, 'prisma', 'schema.prisma');
  const prismaCli = resolvePrismaCli(backendDir);

  if (!prismaCli || !existsSync(schemaPath)) {
    console.warn('[init] 未找到 prisma CLI 或 schema.prisma，跳过自动迁移（请确认打包包含 backend/prisma）');
  } else {
    try {
      console.log('[init] 正在应用数据库迁移 (prisma migrate deploy)...');
      execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
        cwd: backendDir,
        stdio: 'inherit',
        env: process.env,
      });
      console.log('[init] 数据库迁移完成');
      // 兜底：开发期可能用 db push 跳过迁移，导致 migrations/ 落后于当前 schema。
      // 再用 db push 把数据库结构与 schema 完全对齐（补齐缺失的表/列），确保新用户开箱即用。
      console.log('[init] 校验并补齐表结构 (prisma db push)...');
      execFileSync(
        process.execPath,
        [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', schemaPath],
        { cwd: backendDir, stdio: 'inherit', env: process.env },
      );
      console.log('[init] 表结构已与 schema 对齐');
    } catch (e: any) {
      console.error(
        '[init] 迁移失败：请检查 .env 的 DATABASE_URL 是否指向可达的 PostgreSQL：',
        e?.message || e,
      );
    }
  }

  // 默认管理员（新用户首次启动即可登录）
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const count = await prisma.user.count();
    if (count === 0) {
      const username = process.env.SEED_ADMIN_USER || 'admin';
      const password = process.env.SEED_ADMIN_PASS || 'admin123456';
      const argon2Mod: any = await import('argon2');
      const hashFn = argon2Mod.default?.hash ?? argon2Mod.hash;
      const argon2id = argon2Mod.default?.argon2id ?? argon2Mod.argon2id;
      const passwordHash = await hashFn(password, { type: argon2id });
      await prisma.user.create({
        data: { username, passwordHash, role: 'super_admin', networkScope: 'broad' },
      });
      console.log(`[init] 已创建默认管理员：${username} / ${password}`);
    } else {
      console.log('[init] 已存在用户，跳过默认管理员创建');
    }
    await prisma.$disconnect();
  } catch (e: any) {
    console.error('[init] 默认管理员创建失败（可稍后手动运行 prisma seed）：', e?.message || e);
  }
}

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    await ensureDatabase();
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 受限 CORS（设计 §2.1）：仅允许凭证 + 指定来源（生产请收紧 origin）
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  });

  app.use(cookieParser());

  // 生产环境直接托管前端打包产物（Electron 仅作为服务启动器，用户在浏览器访问）
  // 注意：必须在 setGlobalPrefix 之前注册，否则 NestJS 的全局前缀路由会优先拦截根路径 /
  if (process.env.NODE_ENV === 'production') {
    // 本地 nest build: main.js 在 backend/dist/，client 在 backend/client/
    // electron-builder 打包: extraResources 把 backend/dist/* 平铺到 resources/backend/，
    // main.js 在 resources/backend/，client 在 resources/backend/client/
    const clientPath = existsSync(join(__dirname, 'client'))
      ? join(__dirname, 'client')
      : join(__dirname, '..', 'client');
    app.useStaticAssets(clientPath);
    app.use((req, res, next) => {
      if (req.path.startsWith(`/${API_PREFIX}`)) {
        return next();
      }
      res.sendFile(join(clientPath, 'index.html'));
    });
  }

  app.setGlobalPrefix(API_PREFIX);

  // 增加 JSON 和 URL-encoded 请求体大小限制到 10MB（默认仅 100KB）
  // 参考图 base64 内联后可能超过默认限制，导致 413 错误
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(), new HttpExceptionFilter());
  // 兜底：自动 await 嵌套在 data 字段里的 Promise（防止响应变成空对象）
  app.useGlobalInterceptors(new ResponseNormalizeInterceptor());

  const host = process.env.HOST || '127.0.0.1';
  const port = parseInt(process.env.PORT || '8000', 10);
  // 仅监听内网/回环，Nginx 前置（设计 §2.1）
  try {
    await app.listen(port, host);
  } catch (e) {
    console.error(
      `[启动失败] 无法监听 ${host}:${port}，可能被占用或无权限：`,
      (e as Error)?.message,
    );
    process.exit(1);
  }
  console.log(`🚀 aigen-panel backend listening on http://${host}:${port}/${API_PREFIX}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`🌐 frontend available at http://${host}:${port}`);
  }
}

bootstrap();
