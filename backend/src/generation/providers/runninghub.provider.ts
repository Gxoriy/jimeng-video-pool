import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EgressHttpService } from '../http/egress-http.service';
import { IGenerationProvider, ProviderContext, ProviderResult } from './base.provider';
import { TaskType } from '../../common/roles.enum';

interface NodeInput {
  nodeId: string;
  inputName: string;
  value: any;
}

/**
 * RunningHub Provider（需求 #9-#10 数字人对口型 / 视频）。
 *
 * 采用 RunningHub OpenAPI 的「提交工作流 -> 轮询状态」模式，
 * 与 jimen2api 对即梦的 ≤120 次轮询同构（设计 §13）。
 *
 * 说明（设计 §12 待确认项）：RunningHub 的节点/字段名取决于具体工作流，
 * 这里把节点映射做成可配置（env：RUNNINGHUB_*_NODE），由调用方在 params 里
 * 通过 runninghubInputs 直接给出 [{nodeId, inputName, value}]，最灵活。
 */
@Injectable()
export class RunningHubProvider implements IGenerationProvider {
  readonly type: TaskType = TaskType.digital_human; // 仅作为占位，实际由调用方指定 workflowId
  private base: string;

  // 轮询上限（参考 jimen2api videos ≤60 次）
  private maxPoll = 60;
  private pollIntervalMs = 3000;

  constructor(
    private http: EgressHttpService,
    private config: ConfigService,
  ) {
    this.base = this.config.get<string>('app.runninghubApiBase') || 'https://www.runninghub.cn';
  }

  private buildNodeInputs(ctx: ProviderContext): NodeInput[] {
    // 优先使用调用方显式给出的节点映射
    if (Array.isArray(ctx.params?.runninghubInputs)) {
      return ctx.params.runninghubInputs as NodeInput[];
    }
    // 否则按常见字段套用可配置的节点名（跑不通时改 env 即可）
    const audioNode = this.config.get<string>('app.rhAudioNode') || '1';
    const promptNode = this.config.get<string>('app.rhPromptNode') || '2';
    const imageNode = this.config.get<string>('app.rhImageNode') || '3';
    const inputs: NodeInput[] = [];
    if (ctx.params?.audioUrl) inputs.push({ nodeId: audioNode, inputName: 'audio', value: ctx.params.audioUrl });
    if (ctx.prompt) inputs.push({ nodeId: promptNode, inputName: 'prompt', value: ctx.prompt });
    if (ctx.params?.imageUrl) inputs.push({ nodeId: imageNode, inputName: 'image', value: ctx.params.imageUrl });
    return inputs;
  }

  private async submit(workflowId: string, key: string, scope: any, inputs: NodeInput[]): Promise<string> {
    const url = `${this.base}/api/openapi/v1/workflow/${workflowId}/run?apiKey=${encodeURIComponent(key)}`;
    const resp = await this.http.post(
      url,
      scope,
      { params: inputs },
      { headers: { 'Content-Type': 'application/json' }, timeout: 60000 },
    );
    const taskId = resp.data?.data?.taskId || resp.data?.taskId;
    if (!taskId) throw new BadRequestException('RunningHub 未返回 taskId：' + JSON.stringify(resp.data).slice(0, 300));
    return taskId as string;
  }

  private async poll(workflowId: string, taskId: string, key: string, scope: any): Promise<string[]> {
    const url = `${this.base}/api/openapi/v1/workflow/status?apiKey=${encodeURIComponent(key)}&taskId=${encodeURIComponent(taskId)}`;
    for (let i = 0; i < this.maxPoll; i++) {
      const resp = await this.http.get(url, scope, { timeout: 30000 });
      const d = resp.data?.data || resp.data;
      const status = (d?.status || '').toUpperCase();
      if (status === 'SUCCESS') {
        const outputs: any[] = d.outputs || d.output || [];
        const urls: string[] = [];
        for (const o of outputs) {
          if (o?.fileUrl) urls.push(o.fileUrl);
          else if (o?.url) urls.push(o.url);
          else if (typeof o === 'string') urls.push(o);
        }
        // 兼容 outputs 为对象的场景
        if (urls.length === 0 && Array.isArray(d?.outputFileUrls)) urls.push(...d.outputFileUrls);
        if (urls.length === 0) throw new BadRequestException('RunningHub 任务成功但未返回文件 URL');
        return urls;
      }
      if (status === 'FAILED') throw new BadRequestException('RunningHub 任务失败：' + JSON.stringify(d).slice(0, 300));
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    throw new BadRequestException('RunningHub 轮询超时');
  }

  /** 供数字人/视频复用：按指定工作流运行 */
  async runWithWorkflow(workflowId: string, ctx: ProviderContext): Promise<ProviderResult> {
    const inputs = this.buildNodeInputs(ctx);
    if (inputs.length === 0) throw new BadRequestException('RunningHub 缺少节点输入（audioUrl/prompt/imageUrl 或 runninghubInputs）');
    const taskId = await this.submit(workflowId, ctx.key, ctx.scope, inputs);
    const urls = await this.poll(workflowId, taskId, ctx.key, ctx.scope);
    return { urls };
  }

  // IGenerationProvider 默认实现（数字人用默认工作流）
  async generate(ctx: ProviderContext): Promise<ProviderResult> {
    const workflowId = this.config.get<string>('app.runninghubWorkflowId');
    return this.runWithWorkflow(workflowId, ctx);
  }
}
