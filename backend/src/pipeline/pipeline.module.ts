import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaModule } from '../media/media.module';
import { SettingsModule } from '../settings/settings.module';
import { PipelineController } from './pipeline.controller';
import { CharacterGenService } from './character-gen.service';
import { InspirationService } from './inspiration.service';
import { VideoGenService } from './video-gen.service';
import { AssetResolverService } from './asset-resolver.service';
import { TaskRecorderService } from './task-recorder.service';
import { AiChannelClient } from './clients/ai-channel.client';
import { RunningHubClient } from './clients/runninghub.client';

/**
 * 三阶段流水线模块。
 * EgressModule 为 @Global，EgressHttpService 直接注入即可。
 */
@Module({
  imports: [PrismaModule, MediaModule, SettingsModule],
  controllers: [PipelineController],
  providers: [
    CharacterGenService,
    InspirationService,
    VideoGenService,
    AssetResolverService,
    TaskRecorderService,
    AiChannelClient,
    RunningHubClient,
  ],
  exports: [
    CharacterGenService,
    InspirationService,
    VideoGenService,
    AiChannelClient,
    // 供即梦模块复用：任务记录器（写 tasks/task_logs）与素材解析器（上传/形象库 → 可用 URL）
    TaskRecorderService,
    AssetResolverService,
  ],
})
export class PipelineModule {}
