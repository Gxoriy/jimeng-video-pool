import { Module } from '@nestjs/common';
import { HedraClient } from './hedra.client';

/**
 * Hedra 提示词扩写客户端独立模块。
 * 从 PipelineModule 拆出，避免 PipelineModule <-> SettingsModule 循环依赖
 * （SettingsService 需要注入 HedraClient 做 cookie 测试/登录校验）。
 * HedraClient 依赖 ConfigService（ConfigModule 全局）与 EgressService（EgressModule 全局），均可用。
 */
@Module({
  providers: [HedraClient],
  exports: [HedraClient],
})
export class HedraModule {}
