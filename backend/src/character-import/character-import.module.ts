import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { CharacterImportService } from './character-import.service';
import { CharacterImportController } from './character-import.controller';

/**
 * 形象库批量导入模块。
 * 复用 PipelineModule 导出的 AiChannelClient 走视觉 AI 识别。
 */
@Module({
  imports: [PrismaModule, PipelineModule],
  controllers: [CharacterImportController],
  providers: [CharacterImportService],
  exports: [CharacterImportService],
})
export class CharacterImportModule {}
