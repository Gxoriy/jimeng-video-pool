import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EgressModule } from '../egress/egress.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { SongImportService } from './song-import.service';
import { MusicSourceService } from './music-source.service';
import { SongImportController } from './song-import.controller';

/**
 * 歌曲库批量导入模块。
 * 复用 PipelineModule 导出的 AiChannelClient 走 AI 识别；EgressModule 提供受信出站。
 */
@Module({
  imports: [PrismaModule, EgressModule, PipelineModule],
  controllers: [SongImportController],
  providers: [SongImportService, MusicSourceService],
  exports: [SongImportService],
})
export class SongImportModule {}
