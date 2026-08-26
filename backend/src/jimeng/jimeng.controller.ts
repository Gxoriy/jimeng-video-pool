import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JimengVideoService } from './jimeng-video.service';
import { JimengImageService } from './jimeng-image.service';
import { JimengAccountService } from './jimeng-account.service';
import { GenerateVideoDto, GenerateImageDto } from './dto/jimeng.dto';
import { JimengEnabledGuard } from './jimeng-enabled.guard';

@UseGuards(JwtAuthGuard, JimengEnabledGuard)
@Controller('jimeng')
export class JimengController {
  constructor(
    private readonly videoService: JimengVideoService,
    private readonly imageService: JimengImageService,
    private readonly accountService: JimengAccountService,
  ) {}

  // ==================== 账号管理 ====================

  @Get('accounts')
  async listAccounts() {
    return this.accountService.list();
  }

  @Get('accounts/summary')
  async getAccountSummary() {
    return this.accountService.getSummary();
  }

  // ==================== 文件上传 ====================

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: string,
  ) {
    if (!file) {
      throw new Error('请选择要上传的文件');
    }

    const validCategories = ['image', 'video', 'audio'];
    const cat = validCategories.includes(category) ? category : 'image';
    return this.accountService.uploadReferenceFile(file, cat);
  }

  // ==================== 视频生成 ====================

  @Post('video/generate')
  async generateVideo(@Body() dto: GenerateVideoDto) {
    const task = await this.videoService.generate(dto);
    return { taskId: task.taskId };
  }

  @Get('video/task/:taskId')
  async getVideoTask(@Param('taskId') taskId: string) {
    const task = await this.videoService.pollAndUpdate(taskId);
    return {
      done: task.done,
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      videoUrl: task.videoUrl,
      coverUrl: task.coverUrl,
      error: task.error,
    };
  }

  // ==================== 图片生成 ====================

  @Post('image/generate')
  async generateImage(@Body() dto: GenerateImageDto) {
    const task = await this.imageService.generate(dto);
    return { taskId: task.taskId };
  }

  @Get('image/task/:taskId')
  async getImageTask(@Param('taskId') taskId: string) {
    const task = await this.imageService.pollAndUpdate(taskId);
    return {
      done: task.done,
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      images: task.images,
      error: task.error,
    };
  }
}
