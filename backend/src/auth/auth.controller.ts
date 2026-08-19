import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { AuthService, AuthUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  JWT_ACCESS_COOKIE,
  JWT_REFRESH_COOKIE,
} from '../common/constants';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private jwt: JwtService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: any,
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.validateUser(dto.username, dto.password);
    const tokens = await this.auth.login(user);
    this.setCookies(req, res, tokens);
    return { code: 0, message: 'ok', data: { user } };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) throw new UnauthorizedException('缺少 refresh token');

    let payload: any;
    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('refresh token 无效或已过期');
    }
    const tokens = await this.auth.refresh(payload.sub);
    this.setCookies(req, res, tokens);
    return { code: 0, message: 'ok', data: null };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(JWT_ACCESS_COOKIE);
    res.clearCookie(JWT_REFRESH_COOKIE);
    return { code: 0, message: 'ok', data: null };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return { code: 0, message: 'ok', data: user };
  }

  private setCookies(
    req: any,
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    // secure 不能简单跟 NODE_ENV 绑定：服务器用 HTTP（局域网 IP / 未强制 HTTPS 的 Nginx）
    // 访问时，secure cookie 会被浏览器拒绝保存，导致登录后 /auth/me 拿不到会话而循环回登录页。
    // 正确判据：请求实际跑在 HTTPS 上（含 Nginx 反向代理透传的 x-forwarded-proto），
    // 或仅本机回环（Electron / 127.0.0.1）访问时 —— 这些场景才需要/可设置 secure。
    const proto = (req?.headers?.['x-forwarded-proto'] || '').toLowerCase();
    const isHttps = req?.secure === true || proto === 'https';
    // 允许显式覆盖：COOKIE_SECURE=1 强制 secure（仅当你确定全链路 HTTPS 时）
    const forceSecure = process.env.COOKIE_SECURE === '1';
    const secure = isHttps || forceSecure;

    const opts = {
      httpOnly: true,
      secure,
      // sameSite 默认 'lax'：同源（前端与后端同域，或前端从 file:// 经 credentials 调本地 127.0.0.1:8000）
      // 已足够携带 Cookie；跨端口同域场景 cookies 仍随同源发送。'none' 仅当明确跨站时才需要，
      // 但 none 强制要求 secure=true，故 HTTP 场景不可选 none。
      sameSite: 'lax' as const,
      path: '/',
    };
    res.cookie(JWT_ACCESS_COOKIE, tokens.accessToken, {
      ...opts,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie(JWT_REFRESH_COOKIE, tokens.refreshToken, {
      ...opts,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
}
