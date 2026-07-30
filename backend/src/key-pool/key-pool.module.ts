import { Module } from '@nestjs/common';
import { KeyPoolService } from './key-pool.service';
import { KeyPoolController } from './key-pool.controller';

@Module({
  controllers: [KeyPoolController],
  providers: [KeyPoolService],
  exports: [KeyPoolService],
})
export class KeyPoolModule {}
