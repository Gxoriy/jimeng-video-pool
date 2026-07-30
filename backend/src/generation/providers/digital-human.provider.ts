import { Injectable } from '@nestjs/common';
import { RunningHubProvider } from './runninghub.provider';
import { IGenerationProvider, ProviderContext, ProviderResult } from './base.provider';
import { TaskType } from '../../common/roles.enum';
import { ConfigService } from '@nestjs/config';

/**
 * 数字人对口型（需求 #9-#10）：ChatGPT 产出口型提示词 -> RunningHub 工作流生成视频。
 * 工作流 ID 来自 RUNNINGHUB_WORKFLOW_ID（默认 2031016553440878594）。
 */
@Injectable()
export class DigitalHumanProvider implements IGenerationProvider {
  readonly type = TaskType.digital_human;
  private workflowId: string;

  constructor(
    private rh: RunningHubProvider,
    private config: ConfigService,
  ) {
    this.workflowId = this.config.get<string>('app.runninghubWorkflowId') || '2031016553440878594';
  }

  async generate(ctx: ProviderContext): Promise<ProviderResult> {
    return this.rh.runWithWorkflow(this.workflowId, ctx);
  }
}
