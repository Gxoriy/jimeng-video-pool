import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { SongImportService } from './song-import.service';
import { ImportFromTextDto, ImportFromUploadDto } from './dto';

/**
 * 歌曲库批量导入接口（需登录）。
 *   POST /song-import/from-text   歌名-作者 文本自动下载 + AI 识别
 *   POST /song-import/from-upload 本地上传音频 + AI 识别
 *   POST /song-import/reclassify/:id 对已入库歌曲重新执行 AI 识别
 * 导入的歌曲均为 pending_review，需人工审核归档（见 libraries 的 archive 接口）。
 */
@Controller('song-import')
@UseGuards(JwtAuthGuard)
export class SongImportController {
  constructor(private svc: SongImportService) {}

  @Post('from-text')
  async fromText(@Body() dto: ImportFromTextDto, @CurrentUser() user: AuthUser) {
    const data = await this.svc.importFromText(user, dto);
    return { code: 0, message: 'ok', data };
  }

  @Post('from-upload')
  async fromUpload(@Body() dto: ImportFromUploadDto, @CurrentUser() user: AuthUser) {
    const data = await this.svc.importFromUpload(user, dto);
    return { code: 0, message: 'ok', data };
  }

  @Post('reclassify/:id')
  async reclassify(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const data = await this.svc.reclassifySong(user, id);
    return { code: 0, message: 'ok', data };
  }
}
