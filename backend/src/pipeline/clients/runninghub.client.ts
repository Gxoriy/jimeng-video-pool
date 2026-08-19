import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { EgressHttpService } from '../../egress/egress-http.service';
import { NetworkScope } from '../../common/roles.enum';

export interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string | number;
  /** 可选，仅用于调试图示，RunningHub 会回显到 promptTips */
  description?: string;
}

export interface RunningHubRunOptions {
  apiKey: string;
  scope: NetworkScope;
  workflowId: string;
  nodeInfoList: NodeInfo[];
  /** 运行实例类型：default(24G) / plus(48G)，默认 default */
  instanceType?: 'default' | 'plus';
  /** 是否使用个人独占队列，默认 false（走共享队列） */
  usePersonalQueue?: boolean;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => Promise<void> | void;
}

/**
 * RunningHub OpenAPI 客户端（P3 数字人视频）。
 *
 * 文档依据：RunningHub 官方 OpenAPI（/openapi/v2/...），统一用
 *   Authorization: Bearer <API_KEY>
 * 鉴权，不再使用旧版 task/openapi 的 apiKey 表单字段 / Host 头。
 *
 * 重要：视频生成消耗 R 币，新用户免费额度仅 100R，
 * 因此这里的 apiKey **必须**由调用方传入「当前用户自己配置的 Key」，
 * 不存在共享 Key 池，也不做随机选号。
 *
 * 流程：upload(图/音频) -> run(工作流+节点入参) -> query 轮询 -> 取 results[].url
 */
@Injectable()
export class RunningHubClient {
  private readonly logger = new Logger(RunningHubClient.name);
  private base: string;

  private maxPoll = 200; // 视频较慢，最多轮询 200 次
  private pollIntervalMs = 5000;

  constructor(
    private config: ConfigService,
    private http: EgressHttpService,
  ) {
    this.base = (
      this.config.get<string>('app.runninghubApiBase') || 'https://www.runninghub.cn'
    ).replace(/\/$/, '');
  }

  /** 统一 Bearer 鉴权头 */
  private auth(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}` };
  }

  /** 上传本地文件到 RunningHub，返回其内部 fileName（作为节点入参 fieldValue 使用） */
  async uploadLocalFile(
    apiKey: string,
    scope: NetworkScope,
    localPath: string,
    fileType: 'image' | 'audio',
  ): Promise<string> {
    const buf = await readFile(localPath);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)]), path.basename(localPath));

    const resp = await this.http.post(
      `${this.base}/openapi/v2/media/upload/binary`,
      scope,
      form,
      { headers: this.auth(apiKey), timeout: 300000, maxBodyLength: Infinity, maxContentLength: Infinity },
    );
    return this.extractUploadedName(resp.data, '本地文件');
  }

  /** 远程 URL 先拉到内存再上传（RunningHub 不接受任意外链） */
  async uploadRemoteUrl(
    apiKey: string,
    scope: NetworkScope,
    url: string,
    fileType: 'image' | 'audio',
  ): Promise<string> {
    const resp = await this.http.get(url, scope, {
      responseType: 'arraybuffer',
      timeout: 180000,
    });
    const buf = Buffer.from(resp.data);
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)]), name);

    const up = await this.http.post(
      `${this.base}/openapi/v2/media/upload/binary`,
      scope,
      form,
      { headers: this.auth(apiKey), timeout: 300000, maxBodyLength: Infinity, maxContentLength: Infinity },
    );
    return this.extractUploadedName(up.data, url);
  }

  private extractUploadedName(data: any, from: string): string {
    const d = data?.data ?? data;
    // 文档返回的 fileName 是存储键（如 openapi/xxxx.png）；
    // download_url 是 1 天有效链接。优先用 fileName 作为节点入参。
    const name: string | undefined = d?.fileName || d?.download_url;
    if (!name || typeof name !== 'string') {
      throw new BadRequestException(
        `RunningHub 上传失败（${from}）：` + JSON.stringify(data).slice(0, 300),
      );
    }
    return name;
  }

  /** 提交工作流并轮询到完成，返回输出文件 URL 列表（注意：链接仅 24h 有效，调用方需尽快落地） */
  async run(opts: RunningHubRunOptions): Promise<string[]> {
    const {
      apiKey,
      scope,
      workflowId,
      nodeInfoList,
      instanceType = 'default',
      usePersonalQueue = false,
      onLog,
    } = opts;

    await onLog?.('info', `提交 RunningHub 工作流 ${workflowId}，入参 ${nodeInfoList.length} 项`);

    const created = await this.http.post(
      `${this.base}/openapi/v2/run/ai-app/${workflowId}`,
      scope,
      { nodeInfoList, instanceType, usePersonalQueue },
      { headers: this.auth(apiKey), timeout: 120000 },
    );

    const cdata = created.data?.data ?? created.data;
    const taskId: string | undefined = cdata?.taskId ?? created.data?.taskId;
    if (!taskId) {
      throw new BadRequestException(
        'RunningHub 未返回 taskId：' + JSON.stringify(created.data).slice(0, 300),
      );
    }
    await onLog?.('info', `RunningHub taskId=${taskId}，开始轮询`);

    for (let i = 0; i < this.maxPoll; i++) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));

      const st = await this.http.post(
        `${this.base}/openapi/v2/query`,
        scope,
        { taskId },
        { headers: this.auth(apiKey), timeout: 60000 },
      );
      const sdata = st.data?.data ?? st.data;
      const status = String(sdata?.status ?? '').toUpperCase();

      if (i % 6 === 0) {
        await onLog?.('info', `轮询 ${i + 1}/${this.maxPoll}，状态: ${status || '未知'}`);
      }

      if (status === 'SUCCESS') {
        const results: any[] = sdata?.results ?? [];
        const urls = results.map((o) => o?.url).filter(Boolean);
        if (!urls.length) {
          throw new BadRequestException(
            'RunningHub 任务成功但未返回文件：' + JSON.stringify(sdata).slice(0, 300),
          );
        }
        await onLog?.('info', `RunningHub 返回 ${urls.length} 个输出文件`);
        return urls;
      }
      if (status === 'FAILED' || status === 'ERROR') {
        const failed = sdata?.failedReason ? ` | failedReason=${JSON.stringify(sdata.failedReason)}` : '';
        const err = sdata?.errorMessage || sdata?.errorCode || JSON.stringify(sdata).slice(0, 300);
        throw new BadRequestException(`RunningHub 任务失败：${err}${failed}`);
      }
      // QUEUED / RUNNING -> 继续轮询
    }
    throw new BadRequestException(
      `RunningHub 轮询超时（${(this.maxPoll * this.pollIntervalMs) / 1000}s 未完成）`,
    );
  }

  /**
   * 查询账户 R 币余额与当前任务数。
   *
   * 依据 RunningHub 官方 OpenAPI（与 runninghub-cli 一致）：
   *   POST {base}/uc/openapi/accountStatus
   *   Authorization: Bearer <API_KEY>，body: { "apikey": "<API_KEY>" }
   * 成功响应：{ code: 0, data: { remainCoins: "150.0", currentTaskCounts: "0", apiType: "coins" } }
   */
  async accountStatus(apiKey: string, scope: NetworkScope) {
    const resp = await this.http.post(
      `${this.base}/uc/openapi/accountStatus`,
      scope,
      { apikey: apiKey },
      { headers: this.auth(apiKey), timeout: 20000 },
    );
    const wrapper = resp.data ?? {};
    const code = wrapper?.code;
    const d = wrapper?.data ?? wrapper;
    if (code != null && code !== 0) {
      throw new BadRequestException(`RunningHub 账户查询失败：${wrapper?.msg || '未知错误'}`);
    }
    const rawCoins = d?.remainCoins ?? d?.coins;
    return {
      remainCoins: rawCoins == null ? null : Number(rawCoins),
      currentTaskCounts: d?.currentTaskCounts != null ? Number(d.currentTaskCounts) : null,
      apiType: d?.apiType ?? null,
    };
  }
}
