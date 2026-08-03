import { Controller, Get, Delete, Query, UseGuards } from '@nestjs/common';
import { TaskLogsService } from './task-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

@Controller('task-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class TaskLogsController {
  constructor(private svc: TaskLogsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('taskId') taskId?: string) {
    const data = await this.svc.list(user, taskId);
    return { code: 0, message: 'ok', data };
  }

  @Delete()
  async clear(@CurrentUser() user: AuthUser, @Query('taskId') taskId?: string) {
    const result = await this.svc.clear(user, taskId);
    return { code: 0, message: 'ok', data: { deleted: result.count } };
  }
}
