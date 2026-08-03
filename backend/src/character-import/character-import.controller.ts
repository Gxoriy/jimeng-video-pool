import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CharacterImportService } from './character-import.service';
import { ImportCharactersFromUploadDto } from './dto';

/**
 * 形象库批量导入接口（需登录）。
 *   POST /character-import/from-upload  本地上传图片 + 视觉 AI 识别
 * 导入的形象均为 pending_review，需人工审核归档（见 libraries 的 archive 接口）。
 */
@Controller('character-import')
@UseGuards(JwtAuthGuard)
export class CharacterImportController {
  constructor(private svc: CharacterImportService) {}

  @Post('from-upload')
  async fromUpload(@Body() dto: ImportCharactersFromUploadDto, @CurrentUser() user: AuthUser) {
    const data = await this.svc.importFromUpload(user, dto);
    return { code: 0, message: 'ok', data };
  }
}
