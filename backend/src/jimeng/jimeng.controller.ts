import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JimengAccountService } from './jimeng-account.service';
import { JimengImageService } from './jimeng-image.service';
import { JimengVideoService } from './jimeng-video.service';
import { JimengCoreService } from './jimeng-core.service';
import { ImageGenDto, VideoGenDto } from './dto/jimeng.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { NetworkScope } from '../common/roles.enum';
import { BadRequestException } from '@nestjs/common';
import { Logger } from '@nestjs/common';

/**
 * 即梦生成接口（登录可见）。
 * 走本地号池（概念 A）/ 外部号池（概念 B）共用选号；调用即梦时只用 sessionid 重建 Cookie。
 */
@Controller('jimeng')
@UseGuards(JwtAuthGuard)
export class JimengController {
  private readonly logger = new Logger(JimengController.name);

  constructor(
    private readonly accounts: JimengAccountService,
    private readonly image: JimengImageService,
    private readonly video: JimengVideoService,
    private readonly core: JimengCoreService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('models')
  async models() {
    return {
      code: 0,
      message: 'ok',
      data: {
        image: this.image.getModels(),
        video: this.video.getModels(),
      },
    };
  }

  @Post('image/generations')
  async imageGen(@Body() dto: ImageGenDto, @CurrentUser() user: AuthUser) {
    const scope = user.networkScope as NetworkScope;
    const urls = await this.runWithAccount(scope, (sessionid, id) =>
      this.image.generateWithRetry(dto.model, dto.prompt, dto, sessionid, scope),
    );
    await this.persist(user.id, 'image', urls);
    return { code: 0, message: 'ok', data: { created: Math.floor(Date.now() / 1000), data: urls.map((u) => ({ url: u })) } };
  }

  @Post('video/generations')
  async videoGen(@Body() dto: VideoGenDto, @CurrentUser() user: AuthUser) {
    const scope = user.networkScope as NetworkScope;
    const url = await this.runWithAccount(scope, (sessionid, id) =>
      this.video.generateWithRetry(dto.model, dto.prompt, dto, sessionid, scope),
    );
    await this.persist(user.id, 'video', [url]);
    return { code: 0, message: 'ok', data: { url } };
  }

  /** 选号 → 执行生成 → 登录失败自愈重试一次 → 释放锁 */
  private async runWithAccount(
    scope: NetworkScope,
    fn: (sessionid: string, id: string) => Promise<any>,
  ): Promise<any> {
    const { id, sessionid } = await this.accounts.selectOne();
    try {
      return await fn(sessionid, id);
    } catch (err: any) {
      const msg = err?.message || '';
      const loginFailed = /登录|未登录|session|token|鉴权|unauthorized|401/i.test(msg);
      if (loginFailed) {
        this.logger.warn(`账号 ${id} 登录失败，尝试长效 cookie 兑换短效 cookie 自愈: ${msg}`);
        const real = await this.accounts.selfHeal(id, scope);
        if (real) {
          try {
            const result = await fn(real, id);
            return result;
          } catch (e2: any) {
            await this.markExpired(id);
            throw new BadRequestException(`即梦账号已失效，请重新导出导入 cookie：${e2?.message || ''}`);
          }
        }
        await this.markExpired(id);
        throw new BadRequestException(`即梦账号登录失败，请重新导出导入 cookie：${msg}`);
      }
      throw err;
    } finally {
      this.accounts.release(id);
    }
  }

  private async markExpired(id: string) {
    await this.prisma.jimengAccount.update({ where: { id }, data: { status: 'expired' } }).catch(() => {});
  }

  private async persist(userId: string, type: string, urls: string[]) {
    for (const url of urls) {
      if (!url) continue;
      await this.prisma.media.create({ data: { type, url, taskId: null } }).catch(() => {});
    }
  }
}
