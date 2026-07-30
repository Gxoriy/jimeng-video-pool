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
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateUser(dto.username, dto.password);
    const tokens = await this.auth.login(user);
    this.setCookies(res, tokens);
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
    this.setCookies(res, tokens);
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
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    const isProd = process.env.NODE_ENV === 'production';
    const opts = {
      httpOnly: true,
      secure: isProd,
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
