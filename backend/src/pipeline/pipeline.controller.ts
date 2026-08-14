import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CharacterGenService } from './character-gen.service';
import { InspirationService } from './inspiration.service';
import { VideoGenService } from './video-gen.service';
import { HedraClient } from './clients/hedra.client';
import { CharacterGenDto, InspirationDto, VideoGenDto } from './dto/pipeline.dto';
import { WorkspaceDto, WorkspaceRetryDto } from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveUserHedraCookie } from './hedra-cookie.util';

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
    private workspace: WorkspaceService,
    private hedra: HedraClient,
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
   * 视频工作区：创建统一任务（提示词扩写 -> 视频生成）。
   * 先落任务记录，再异步执行；成功/失败都会写入 tasks 表。
   */
  @Post('workspace')
  async workspaceCreate(@CurrentUser() user: AuthUser, @Body() dto: WorkspaceDto) {
    const data = await this.workspace.createTask(user, dto);
    return { code: 0, message: 'ok', data };
  }

  /**
   * 断点续跑：重试失败的工作区任务。
   * 根据任务记录的 stage 决定从提示词扩写还是视频生成阶段恢复。
   */
  @Post('workspace/:id/retry')
  async workspaceRetry(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: WorkspaceRetryDto,
  ) {
    const data = await this.workspace.retryTask(user, id, dto);
    return { code: 0, message: 'ok', data };
  }

  /**
   * Hedra 提示词扩写接口实测（仅文本，不消耗附件）。
   * 用于验证 cookie 配置与网络连通性；若 cookie 无效会返回上游真实错误。
   */
  @Post('hedra/test')
  async hedraTest(@CurrentUser() user: AuthUser, @Body('text') text?: string) {
    const data = await this.hedraTestCall(user, text || 'a woman talking to camera');
    return { code: 0, message: 'ok', data };
  }

  private async hedraTestCall(user: AuthUser, text: string) {
    // 优先用用户个人 Hedra cookie，缺省回退全局 .env HEDRA_COOKIE_PATH
    const raw = await resolveUserHedraCookie(this.prisma, user.id);
    return this.hedra.generatePrompt({ text }, raw);
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
