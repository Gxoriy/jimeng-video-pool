import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CharacterGenService } from './character-gen.service';
import { InspirationService } from './inspiration.service';
import { VideoGenService } from './video-gen.service';
import { CharacterGenDto, InspirationDto, VideoGenDto } from './dto/pipeline.dto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 三阶段流水线统一入口：
 *   P1 /pipeline/character    生成形象   -> AI 渠道
 *   P2 /pipeline/inspiration  获取灵感   -> AI 渠道
 *   P3 /pipeline/video        视频生成   -> RunningHub（用户自己的 Key）
 *
 * 所有接口都要求登录，任务与素材按 userId 隔离。
 */
@Controller('pipeline')
@UseGuards(JwtAuthGuard)
export class PipelineController {
  constructor(
    private prisma: PrismaService,
    private p1: CharacterGenService,
    private p2: InspirationService,
    private p3: VideoGenService,
  ) {}

  /** P1 生成形象 */
  @Post('character')
  async character(@CurrentUser() user: AuthUser, @Body() dto: CharacterGenDto) {
    const data = await this.p1.generate(user, dto);
    return { code: 0, message: 'ok', data };
  }

  /** P2 获取灵感（产出动作提示词） */
  @Post('inspiration')
  async inspiration(@CurrentUser() user: AuthUser, @Body() dto: InspirationDto) {
    const data = await this.p2.generate(user, dto);
    return { code: 0, message: 'ok', data };
  }

  /** P3 视频生成 */
  @Post('video')
  async video(@CurrentUser() user: AuthUser, @Body() dto: VideoGenDto) {
    const data = await this.p3.generate(user, dto);
    return { code: 0, message: 'ok', data };
  }

  /**
   * 普通用户可选的 AI 渠道（只回名称/模型等必要字段，绝不回 Key）。
   * 渠道由超级管理员配置，普通用户只能挑选。
   */
  @Get('channels')
  async channels(@Query('stage') stage?: string) {
    const rows = await this.prisma.aiChannel.findMany({
      where: {
        enabled: true,
        ...(stage ? { usableFor: { contains: stage } } : {}),
      },
      select: {
        id: true,
        name: true,
        model: true,
        protocol: true,
        usableFor: true,
        supportsImage: true,
        supportsVision: true,
        remark: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return { code: 0, message: 'ok', data: rows };
  }

  /** P3 工作流节点映射配置情况（前端提示管理员补全 .env） */
  @Get('video/node-map')
  nodeMap() {
    return { code: 0, message: 'ok', data: this.p3.nodeMapStatus() };
  }

  /** 当前用户 RunningHub 账户余额 */
  @Get('video/account')
  async account(@CurrentUser() user: AuthUser) {
    const data = await this.p3.accountStatus(user);
    return { code: 0, message: 'ok', data };
  }
}
