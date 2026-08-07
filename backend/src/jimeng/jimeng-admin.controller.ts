import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JimengAccountService } from './jimeng-account.service';
import { ExternalPoolClient } from './external-pool.client';
import { ImportAccountsDto, UpdateAccountDto } from './dto/jimeng.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { Role } from '../common/roles.enum';
import { NetworkScope } from '../common/roles.enum';

/**
 * 即梦账号池管理 —— 仅超级管理员。
 * 概念 A（本地导入）/ 概念 B（外部 :18813 拉取）共用此 CRUD，靠 source 字段区分。
 */
@Controller('admin/jimeng-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class JimengAdminController {
  constructor(
    private readonly svc: JimengAccountService,
    private readonly pool: ExternalPoolClient,
  ) {}

  @Post('import')
  async import(@Body() dto: ImportAccountsDto, @CurrentUser() user: AuthUser) {
    const list = await this.svc.import(dto.cookies, dto.source || 'local');
    return { code: 0, message: 'ok', data: { imported: list.length, items: list } };
  }

  @Get()
  async list() {
    return { code: 0, message: 'ok', data: await this.svc.list() };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return { code: 0, message: 'ok', data: await this.svc.update(id, dto) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return { code: 0, message: 'ok', data: await this.svc.remove(id) };
  }

  @Post(':id/check')
  async check(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const scope = user.networkScope as NetworkScope;
    return { code: 0, message: 'ok', data: await this.svc.check(id, scope) };
  }

  /** 概念 B：从外部 :18813 号池服务同步账号到本地（source=external）。默认关闭，仅配置后生效。 */
  @Post('sync-external')
  async syncExternal() {
    return { code: 0, message: 'ok', data: await this.pool.syncToLocal() };
  }
}
