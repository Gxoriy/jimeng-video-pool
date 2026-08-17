import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 仅允许后端/内部调用 /api/assets/sync：
 *  - 请求头 X-Internal-Token 等于配置的 INTERNAL_SYNC_TOKEN（若已配置）；或
 *  - 来源 IP 在 internalSyncAllowedIps 白名单内（默认含 127.0.0.1 / ::1）。
 * 普通用户/前端永远无法触发全量同步。
 */
@Injectable()
export class InternalSyncGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = this.config.get<string>('app.internalSyncToken');
    const allowedIps: string[] = this.config.get<string[]>('app.internalSyncAllowedIps') || [
      '127.0.0.1',
      '::1',
    ];

    const headerToken = req.headers['x-internal-token'];
    if (token && headerToken === token) return true;

    const ip =
      req.ip ||
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.connection?.remoteAddress;
    if (ip && allowedIps.includes(ip)) return true;

    throw new ForbiddenException('仅允许后端/内部调用');
  }
}
