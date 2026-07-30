import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../../auth/auth.service';

/**
 * 取出当前登录用户（由 JwtStrategy 注入到 req.user）。
 * 用法： @CurrentUser() user: AuthUser
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
