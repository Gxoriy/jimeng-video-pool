import { Injectable } from '@nestjs/common';
import { RunningHubProvider } from './runninghub.provider';
import { IGenerationProvider, ProviderContext, ProviderResult } from './base.provider';
import { TaskType } from '../../common/roles.enum';
import { ConfigService } from '@nestjs/config';

/**
 * 视频 Provider（需求列为生成类型，provider 待定，设计 §12）。
 * 设计为可插拔；默认复用 RunningHub 工作流（RUNNINGHUB_VIDEO_WORKFLOW_ID，缺省复用数字人工作流）。
 * 接入其它视频 provider 时，只需实现 IGenerationProvider 并注册到 ProviderFactory。
 */
@Injectable()
export class VideoProvider implements IGenerationProvider {
  readonly type = TaskType.video;
  private workflowId: string;

  constructor(
    private rh: RunningHubProvider,
    private config: ConfigService,
  ) {
    this.workflowId =
      this.config.get<string>('app.runninghubVideoWorkflowId') ||
      this.config.get<string>('app.runninghubWorkflowId') ||
      '2031016553440878594';
  }

  async generate(ctx: ProviderContext): Promise<ProviderResult> {
    return this.rh.runWithWorkflow(this.workflowId, ctx);
  }
}
