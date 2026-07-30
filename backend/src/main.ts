import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { API_PREFIX } from './common/constants';
import { HttpExceptionFilter, AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 受限 CORS（设计 §2.1）：仅允许凭证 + 指定来源（生产请收紧 origin）
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  });

  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(), new HttpExceptionFilter());

  const host = process.env.HOST || '127.0.0.1';
  const port = parseInt(process.env.PORT || '8000', 10);
  // 仅监听内网/回环，Nginx 前置（设计 §2.1）
  await app.listen(port, host);
  console.log(`🚀 aigen-panel backend listening on http://${host}:${port}/${API_PREFIX}`);
}

bootstrap();
