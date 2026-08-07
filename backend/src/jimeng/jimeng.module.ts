import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { JimengCoreService } from './jimeng-core.service';
import { JimengImageService } from './jimeng-image.service';
import { JimengVideoService } from './jimeng-video.service';
import { JimengAccountService } from './jimeng-account.service';
import { JimengCheckinService } from './jimeng-checkin.service';
import { JimengController } from './jimeng.controller';
import { JimengAdminController } from './jimeng-admin.controller';
import { ExternalPoolClient } from './external-pool.client';

@Module({
  // PipelineModule 提供 TaskRecorderService（任务/日志）与 AssetResolverService（素材解析）
  imports: [PrismaModule, PipelineModule],
  controllers: [JimengController, JimengAdminController],
  providers: [JimengCoreService, JimengImageService, JimengVideoService, JimengAccountService, JimengCheckinService, ExternalPoolClient],
  exports: [JimengCoreService, JimengAccountService, JimengCheckinService, ExternalPoolClient],
})
export class JimengModule {}
