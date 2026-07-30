import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../roles.enum';

/**
 * 角色守卫：结合 @Roles(...)，要求当前用户角色在允许集合中。
 * super_admin 始终放行（见角色权限矩阵 §10）。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false;

    if (user.role === Role.SUPER_ADMIN) return true;

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('当前角色无权访问该资源');
    }
    return true;
  }
}
