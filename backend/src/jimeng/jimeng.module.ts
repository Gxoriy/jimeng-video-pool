import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JimengCoreService } from './jimeng-core.service';
import { JimengImageService } from './jimeng-image.service';
import { JimengVideoService } from './jimeng-video.service';
import { JimengAccountService } from './jimeng-account.service';
import { JimengController } from './jimeng.controller';
import { JimengAdminController } from './jimeng-admin.controller';
import { ExternalPoolClient } from './external-pool.client';

@Module({
  imports: [PrismaModule],
  controllers: [JimengController, JimengAdminController],
  providers: [JimengCoreService, JimengImageService, JimengVideoService, JimengAccountService, ExternalPoolClient],
  exports: [JimengCoreService, JimengAccountService, ExternalPoolClient],
})
export class JimengModule {}
