import { Module } from '@nestjs/common';
import { TaskLogsService } from './task-logs.service';
import { TaskLogsController } from './task-logs.controller';

@Module({
  controllers: [TaskLogsController],
  providers: [TaskLogsService],
  exports: [TaskLogsService],
})
export class TaskLogsModule {}
