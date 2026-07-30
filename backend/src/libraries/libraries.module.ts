import { Module } from '@nestjs/common';
import { LibrariesService } from './libraries.service';
import { LibrariesController } from './libraries.controller';
import { KeyPoolModule } from '../key-pool/key-pool.module';
import { ImageProvider } from '../generation/providers/image.provider';

@Module({
  imports: [KeyPoolModule],
  controllers: [LibrariesController],
  providers: [LibrariesService, ImageProvider],
  exports: [LibrariesService],
})
export class LibrariesModule {}
