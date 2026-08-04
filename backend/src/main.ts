import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX } from './common/constants';
import { HttpExceptionFilter, AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ResponseNormalizeInterceptor } from './common/interceptors/response-normalize.interceptor';

async function bootstrap() {
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
  await app.listen(port, host);
  console.log(`🚀 aigen-panel backend listening on http://${host}:${port}/${API_PREFIX}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`🌐 frontend available at http://${host}:${port}`);
  }
}

bootstrap();
