import { SetMetadata } from '@nestjs/common';
import { Role } from '../roles.enum';

export const ROLES_KEY = 'roles';

/**
 * 标记某个路由允许的角色集合，配合 RolesGuard 使用。
 * 用法： @Roles(Role.SUPER_ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
