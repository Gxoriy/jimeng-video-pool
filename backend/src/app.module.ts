import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { EgressModule } from './egress/egress.module';
import { MediaModule } from './media/media.module';
import { AssetsModule } from './assets/assets.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { UploadsModule } from './uploads/uploads.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { LibrariesModule } from './libraries/libraries.module';
import { SongImportModule } from './song-import/song-import.module';
import { CharacterImportModule } from './character-import/character-import.module';
import { TasksModule } from './tasks/tasks.module';
import { AiChannelsModule } from './ai-channels/ai-channels.module';
import { TaskLogsModule } from './task-logs/task-logs.module';
import { JimengModule } from './jimeng/jimeng.module';
import { HealthModule } from './health/health.module';

/**
 * 应用根模块。
 *
 * 业务主线（三阶段流水线）：
 *   P1 生成形象   -> PipelineModule + AiChannelsModule（管理员配置的 AI 渠道）
 *   P2 获取灵感   -> PipelineModule + AiChannelsModule
 *   P3 视频生成   -> PipelineModule + SettingsModule（用户自备 RunningHub Key）
 *
 * 已移除：KeyPoolModule（Bearer 拆分 + 随机选号）、GenerationModule（旧的并列生成器）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    PrismaModule,
    EgressModule,
    MediaModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    UploadsModule,
    AiChannelsModule,
    PipelineModule,
    LibrariesModule,
    SongImportModule,
    CharacterImportModule,
    TasksModule,
    TaskLogsModule,
    JimengModule,
    HealthModule,
  ],
})
export class AppModule {}
