import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as path from 'path';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { UploadsService } from './uploads.service';

const MAX_IMAGE = 20 * 1024 * 1024; // 20MB
const MAX_AUDIO = 60 * 1024 * 1024; // 60MB

@Controller()
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private uploads: UploadsService) {}

  /** 上传参考图（P1 参考图 / P2 参考图 / P3 首帧图） */
  @Post('uploads/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE } }))
  async uploadImage(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = await this.uploads.save(user, 'image', file);
    return { code: 0, message: 'ok', data };
  }

  /** 上传参考音频（P2 参考音频 / P3 对口型音频） */
  @Post('uploads/audio')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AUDIO } }))
  async uploadAudio(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = await this.uploads.save(user, 'audio', file);
    return { code: 0, message: 'ok', data };
  }

  @Get('uploads')
  async list(@CurrentUser() user: AuthUser, @Query('kind') kind?: string) {
    const data = await this.uploads.list(user, kind);
    return { code: 0, message: 'ok', data };
  }

  @Delete('uploads/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.uploads.remove(user, id);
    return { code: 0, message: 'ok', data: null };
  }

  /** 静态下发（带隔离校验，不直接暴露磁盘目录） */
  @Get('files/:id')
  async serve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const up = await this.uploads.getForServe(user, id);
    res.setHeader('Content-Type', up.mimeType);
    res.sendFile(path.resolve(up.localPath));
  }
}
