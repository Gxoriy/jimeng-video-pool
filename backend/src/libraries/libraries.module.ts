import { Module } from '@nestjs/common';
import { LibrariesService } from './libraries.service';
import { LibrariesController } from './libraries.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [PrismaModule, PipelineModule],
  controllers: [LibrariesController],
  providers: [LibrariesService],
  exports: [LibrariesService],
})
export class LibrariesModule {}
