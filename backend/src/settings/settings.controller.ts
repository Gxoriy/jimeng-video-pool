import { Body, Controller, Delete, Get, Post, Put, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { SettingsService } from './settings.service';

class SetRunninghubKeyDto {
  @IsString()
  apiKey: string;
}

class SetHedraCookieDto {
  @IsString()
  cookie: string;
}

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private settings: SettingsService) {}

  // 注意：data 必须是 **已 await 的值**。
  // 若直接把 Service 返回的 Promise 塞进 data，JSON 序列化后会变成 {}，
  // 前端 unwrap 后拿到空对象 —— 这正是「保存 Key 后状态不刷新」的根因。
  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const data = await this.settings.get(user);
    return { code: 0, message: 'ok', data };
  }

  @Put('runninghub-key')
  async set(@CurrentUser() user: AuthUser, @Body() dto: SetRunninghubKeyDto) {
    const data = await this.settings.setRunninghubKey(user, dto.apiKey);
    return { code: 0, message: 'ok', data };
  }

  @Delete('runninghub-key')
  async clear(@CurrentUser() user: AuthUser) {
    const data = await this.settings.clearRunninghubKey(user);
    return { code: 0, message: 'ok', data };
  }

  @Post('runninghub-key/test')
  async test(@CurrentUser() user: AuthUser) {
    const data = await this.settings.testRunninghubKey(user);
    return { code: 0, message: 'ok', data };
  }

  @Put('hedra-cookie')
  async setHedraCookie(@CurrentUser() user: AuthUser, @Body() dto: SetHedraCookieDto) {
    const data = await this.settings.setHedraCookie(user, dto.cookie);
    return { code: 0, message: 'ok', data };
  }

  @Delete('hedra-cookie')
  async clearHedraCookie(@CurrentUser() user: AuthUser) {
    const data = await this.settings.clearHedraCookie(user);
    return { code: 0, message: 'ok', data };
  }

  @Post('hedra-cookie/test')
  async testHedraCookie(@CurrentUser() user: AuthUser) {
    const data = await this.settings.testHedraCookie(user);
    return { code: 0, message: 'ok', data };
  }
}
