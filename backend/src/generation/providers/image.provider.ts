import { Injectable } from '@nestjs/common';
import { EgressHttpService } from '../http/egress-http.service';
import { IGenerationProvider, ProviderContext, ProviderResult } from './base.provider';
import { TaskType } from '../../common/roles.enum';

/**
 * 图片生成 Provider —— 完全兼容 OpenAI 生图接口（需求 #4，明确为 ChatGPT）。
 * 参考：https://platform.openai.com/docs/api-reference/images
 */
@Injectable()
export class ImageProvider implements IGenerationProvider {
  readonly type = TaskType.image;
  private endpoint = 'https://api.openai.com/v1/images/generations';

  constructor(private http: EgressHttpService) {}

  async generate(ctx: ProviderContext): Promise<ProviderResult> {
    const model = ctx.model || 'gpt-image-1';
    const size = (ctx.params?.size as string) || '1024x1024';
    const n = Math.min(Number(ctx.params?.n) || 1, 4);

    const resp = await this.http.post(
      this.endpoint,
      ctx.scope,
      {
        model,
        prompt: ctx.prompt,
        n,
        size,
        response_format: 'url', // 便于后续自动下载落地
      },
      {
        headers: {
          Authorization: `Bearer ${ctx.key}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      },
    );

    const data = resp.data?.data || [];
    const urls: string[] = data
      .map((it: any) => it?.url)
      .filter(Boolean);
    if (urls.length === 0) {
      throw new Error('ChatGPT 生图未返回可用 URL');
    }
    return { urls };
  }
}
