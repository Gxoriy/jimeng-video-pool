import { Module, Global } from '@nestjs/common';
import { FileService } from './file.service';

@Global()
@Module({
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
