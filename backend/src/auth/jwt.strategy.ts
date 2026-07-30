import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, NetworkScope } from '../common/roles.enum';
import { AuthUser } from './auth.service';

/**
 * JWT 策略：从 HttpOnly Cookie（或 Authorization 头）取出 access token 并校验。
 * 校验通过后把用户信息挂到 req.user。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: any) => {
          // 优先取 Cookie，其次 Authorization 头
          if (req && req.cookies && req.cookies['access_token']) {
            return req.cookies['access_token'];
          }
          const header = req?.headers?.authorization;
          if (header && header.startsWith('Bearer ')) return header.slice(7);
          return null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('app.jwtSecret'),
    });
  }

  async validate(payload: any): Promise<AuthUser> {
    if (!payload?.sub) throw new UnauthorizedException();
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role as Role,
      networkScope: payload.networkScope as NetworkScope,
    };
  }
}
