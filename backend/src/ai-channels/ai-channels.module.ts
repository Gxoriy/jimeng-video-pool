import { Module } from '@nestjs/common';
import { AiChannelsController } from './ai-channels.controller';
import { AiChannelsService } from './ai-channels.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AiChannelsController],
  providers: [AiChannelsService],
  exports: [AiChannelsService],
})
export class AiChannelsModule {}
