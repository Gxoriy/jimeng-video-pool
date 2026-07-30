import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { KeyPoolService } from './key-pool.service';
import { CreateApiKeyDto } from './dto/api-key.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

@Controller('key-pool')
@UseGuards(JwtAuthGuard)
export class KeyPoolController {
  constructor(private keyPool: KeyPoolService) {}

  /** 添加个人 Key（需求 #6：每个用户配置自己的 RunningHub/OpenAI Key） */
  @Post('keys')
  addKey(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.keyPool.addUserKey(user, dto.provider, dto.key, dto.label);
  }

  /** 列出个人 Key（掩码） */
  @Get('keys')
  listKeys(@CurrentUser() user: AuthUser) {
    return this.keyPool.listUserKeys(user);
  }

  @Delete('keys/:id')
  deleteKey(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.keyPool.deleteUserKey(user, id);
  }
}
