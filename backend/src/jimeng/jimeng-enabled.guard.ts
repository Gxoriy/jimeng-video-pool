import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class JimengEnabledGuard implements CanActivate {
  private readonly logger = new Logger(JimengEnabledGuard.name);

  constructor(private readonly settings: SettingsService) {}

  canActivate(
    _context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return this.settings
      .isJimengEnabled()
      .then((enabled) => {
        if (!enabled) {
          throw new ForbiddenException('即梦（Jimeng）功能已被管理员关闭');
        }
        return true;
      })
      .catch((err) => {
        // 配置读取异常（如 system_config 表缺失导致 Prisma P2021）若不加 catch，
        // 会让 guard 返回的 Promise 直接 reject，被兜底过滤器转成无信息的「服务器内部错误」，调用方无从排查。
        if (err instanceof ForbiddenException) throw err;
        this.logger.error('读取即梦功能开关失败', err);
        throw new InternalServerErrorException(
          '读取即梦功能开关失败，请确认 system_config 表已创建（执行 prisma migrate deploy 或 prisma db push）',
        );
      });
  }
}
