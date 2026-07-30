import { NetworkScope } from '../../common/roles.enum';
import { TaskType } from '../../common/roles.enum';

export interface ProviderContext {
  prompt: string;
  model?: string;
  params?: Record<string, any>;
  /** 由 KeyPool 选出的本次调用 Key */
  key: string;
  /** 当前用户网络访问范围，用于 EgressGuard 校验 */
  scope: NetworkScope;
  /** 客户端自带 Bearer 池（透传） */
  requestBearer?: string;
}

export interface ProviderResult {
  urls: string[];
}

export interface IGenerationProvider {
  readonly type: TaskType;
  generate(ctx: ProviderContext): Promise<ProviderResult>;
}
