import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InternalSyncGuard } from '../common/guards/internal-sync.guard';
import { AssetsService, SyncAssetItem } from './assets.service';

/**
 * 素材索引接口。
 *  - POST /api/assets/sync  仅后端/内部调用（InternalSyncGuard），全量同步 URL + 文本工作信息。
 *  - GET  /api/assets        仅 super_admin 运维查看（可选）。
 * 普通用户与前端页面无任何读写在菜单中暴露。
 */
@Controller('assets')
export class AssetsController {
  constructor(private readonly svc: AssetsService) {}

  @Post('sync')
  @UseGuards(InternalSyncGuard)
  async sync(@Body() body: { items: SyncAssetItem[] }) {
    const data = await this.svc.sync(body?.items || []);
    return { code: 0, message: 'ok', data };
  }

  @Get()
  async list(@Query('kind') kind?: string) {
    const data = await this.svc.list(kind);
    return { code: 0, message: 'ok', data };
  }
}
