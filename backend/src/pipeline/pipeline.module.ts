import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaModule } from '../media/media.module';
import { SettingsModule } from '../settings/settings.module';
import { JimengModule } from '../jimeng/jimeng.module';
import { PipelineController } from './pipeline.controller';
import { CharacterGenService } from './character-gen.service';
import { InspirationService } from './inspiration.service';
import { VideoGenService } from './video-gen.service';
import { AssetResolverService } from './asset-resolver.service';
import { TaskRecorderService } from './task-recorder.service';
import { AiChannelClient } from './clients/ai-channel.client';
import { RunningHubClient } from './clients/runninghub.client';
import { HedraModule } from './clients/hedra.module';
import { WorkspaceService } from './workspace.service';

/**
 * 三阶段流水线模块。
 * EgressModule 为 @Global，EgressHttpService 直接注入即可。
 */
@Module({
  imports: [PrismaModule, MediaModule, SettingsModule, HedraModule, forwardRef(() => JimengModule)],
  controllers: [PipelineController],
  providers: [
    CharacterGenService,
    InspirationService,
    VideoGenService,
    AssetResolverService,
    TaskRecorderService,
    AiChannelClient,
    RunningHubClient,
    WorkspaceService,
  ],
  exports: [
    CharacterGenService,
    InspirationService,
    VideoGenService,
    AiChannelClient,
    // 再导出 HedraModule，保持 jimeng/song-import/libraries/character-import 等对 HedraClient 的向后兼容
    HedraModule,
    // 供即梦模块复用：任务记录器（写 tasks/task_logs）与素材解析器（上传/形象库 → 可用 URL）
    TaskRecorderService,
    AssetResolverService,
  ],
})
export class PipelineModule {}
