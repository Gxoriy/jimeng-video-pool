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
import { AiChannelsService } from './ai-channels.service';
import {
  CreateChannelDto,
  TestChannelDto,
  UpdateChannelDto,
} from './dto/channel.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { Role } from '../common/roles.enum';

/**
 * AI 渠道配置 —— 整个控制器仅超级管理员可访问。
 * 普通用户在生成页通过 GET /pipeline/channels 获取可选渠道（不含任何密钥信息）。
 */
@Controller('ai-channels')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AiChannelsController {
  constructor(private svc: AiChannelsService) {}

  @Get()
  async list() {
    return { code: 0, message: 'ok', data: await this.svc.list() };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return { code: 0, message: 'ok', data: await this.svc.get(id) };
  }

  @Post()
  async create(@Body() dto: CreateChannelDto) {
    return { code: 0, message: 'ok', data: await this.svc.create(dto) };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return { code: 0, message: 'ok', data: await this.svc.update(id, dto) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.svc.remove(id);
    return { code: 0, message: 'ok', data: null };
  }

  /** 获取模型列表（可用未保存的表单值） */
  @Post('models')
  async models(@CurrentUser() user: AuthUser, @Body() dto: TestChannelDto) {
    return { code: 0, message: 'ok', data: await this.svc.fetchModels(user, dto) };
  }

  /** 连通性测试 */
  @Post('test')
  async test(@CurrentUser() user: AuthUser, @Body() dto: TestChannelDto) {
    return { code: 0, message: 'ok', data: await this.svc.test(user, dto) };
  }
}
