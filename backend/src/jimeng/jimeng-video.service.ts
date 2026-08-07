import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { JimengCoreService, JIMENG_CONSTANTS, JimengInsufficientCreditError } from './jimeng-core.service';
import { NetworkScope } from '../common/roles.enum';

const { DEFAULT_ASSISTANT_ID, DRAFT_VERSION, WEB_VERSION } = JIMENG_CONSTANTS;

const VIDEO_MODEL_MAP: Record<string, string> = {
  'jimeng-video-seedance-2.0-mini': 'dreamina_seedance_40_mini',
  'jimeng-video-seedance-2.0-fast': 'dreamina_seedance_40_vision',
  'jimeng-video-seedance-2.0-pro': 'dreamina_seedance_40_pro_vision',
  'jimeng-video-seedance-1.5-pro': 'dreamina_ic_generate_video_model_vgfm_3.5_pro',
  'jimeng-video-3.0-pro': 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
  'jimeng-video-3.0': 'dreamina_ic_generate_video_model_vgfm_3.0',
  'jimeng-video-3.0-fast': 'dreamina_ic_generate_video_model_vgfm_3.0_fast',
  'jimeng-video-s2.0': 'dreamina_ic_generate_video_model_vgfm_lite',
  'jimeng-video-2.0-pro': 'dreamina_ic_generate_video_model_vgfm1.0',
};
export const DEFAULT_VIDEO_MODEL = 'jimeng-video-seedance-2.0-mini';

const VIDEO_RESOLUTIONS: Record<string, string[]> = {
  'jimeng-video-seedance-2.0-mini': ['720p'],
  'jimeng-video-seedance-2.0-fast': ['720p'],
  'jimeng-video-seedance-2.0-pro': ['720p', '1080p', '4k'],
  'jimeng-video-seedance-1.5-pro': ['720p'],
  'jimeng-video-3.0-pro': ['1080p'],
  'jimeng-video-3.0': ['720p', '1080p'],
  'jimeng-video-3.0-fast': ['720p', '1080p'],
  'jimeng-video-s2.0': ['720p'],
  'jimeng-video-2.0-pro': ['720p'],
};

const VIDEO_BENEFITS: Record<string, Record<string, string>> = {
  'jimeng-video-seedance-2.0-mini': { '720p': 'seedance_20_mini_720p_output' },
  'jimeng-video-seedance-2.0-fast': { '720p': 'seedance_20_fast_720p_output' },
  'jimeng-video-seedance-2.0-pro': { '720p': 'seedance_20_pro_720p_output', '1080p': 'seedance_20_pro_1080p_output', '4k': 'seedance_20_pro_4k_output' },
  'jimeng-video-seedance-1.5-pro': { '720p': 'dreamina_video_seedance_15_pro' },
  'jimeng-video-3.0-pro': { '1080p': 'basic_video_operation_vgfm_v_three_pro' },
  'jimeng-video-3.0': { '720p': 'basic_video_operation_vgfm_v_three', '1080p': 'basic_video_operation_vgfm_v_three_1080' },
  'jimeng-video-3.0-fast': { '720p': 'basic_video_operation_vgfm_v_three', '1080p': 'basic_video_operation_vgfm_v_three_1080' },
  'jimeng-video-s2.0': { '720p': 'basic_video_operation_vgfm_v_three' },
  'jimeng-video-2.0-pro': { '720p': 'basic_video_operation_vgfm_v_three' },
};

const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const VIDEO_PROCESSING = [20, 42, 45];

function detectVideoAspectRatio(prompt: string): string {
  const matches = [...prompt.matchAll(/(\d+)\s*[:：]\s*(\d+)/g)];
  for (const m of matches) {
    const key = `${m[1]}:${m[2]}`;
    if (VIDEO_ASPECT_RATIOS.includes(key)) return key;
  }
  if (/横屏|横版|宽屏/.test(prompt)) return '16:9';
  if (/竖屏|竖版|手机/.test(prompt)) return '9:16';
  if (/方形|正方/.test(prompt)) return '1:1';
  return '16:9';
}
function extractVideoUrl(itemList: any[] = []): string | null {
  for (const item of itemList) {
    const v = item?.video;
    const url = v?.transcoded_video?.origin?.video_url || v?.play_url || v?.download_url || v?.url;
    if (url) return url;
  }
  return null;
}

@Injectable()
export class JimengVideoService {
  private readonly logger = new Logger(JimengVideoService.name);
  constructor(private readonly core: JimengCoreService) {}

  getModels(): { id: string; name: string }[] {
    return Object.keys(VIDEO_MODEL_MAP).map((id) => ({ id, name: id }));
  }

  private reqKey(model: string): string {
    return VIDEO_MODEL_MAP[model] || VIDEO_MODEL_MAP[DEFAULT_VIDEO_MODEL];
  }

  async generate(
    model: string,
    prompt: string,
    opts: { ratio?: string; resolution?: string; duration?: number; filePaths?: string[] },
    sessionid: string,
    scope: NetworkScope,
  ): Promise<string> {
    const modelName = model || DEFAULT_VIDEO_MODEL;
    const supported = VIDEO_RESOLUTIONS[modelName] || ['720p'];
    let resolution = supported.includes(opts.resolution || '') ? opts.resolution! : supported[0];
    let ratio = VIDEO_ASPECT_RATIOS.includes(opts.ratio || '') ? opts.ratio! : detectVideoAspectRatio(prompt);
    if (!VIDEO_ASPECT_RATIOS.includes(ratio)) ratio = '16:9';
    const supportsLong = modelName.includes('3.0') || modelName.includes('seedance-2.0');
    let duration = opts.duration ?? 10;
    if (!supportsLong) duration = 5;
    else if (![5, 10].includes(duration)) duration = duration > 5 ? 10 : 5;
    const durationMs = duration === 5 ? 5000 : 10000;
    const benefit = (VIDEO_BENEFITS[modelName]?.[resolution]) || 'basic_video_operation_vgfm_v_three';

    // 首/尾帧上传
    let firstFrame: any, endFrame: any;
    if (opts.filePaths && opts.filePaths.length) {
      const ids: string[] = [];
      for (const fp of opts.filePaths) {
        if (!fp) continue;
        try {
          const uri = await this.core.uploadFile(sessionid, fp, scope);
          ids.push(uri);
        } catch (e: any) {
          if (ids.length === 0) throw new BadRequestException(`首帧上传失败: ${e.message}`);
        }
      }
      if (ids[0]) firstFrame = this.frameObj(ids[0]);
      if (ids[1]) endFrame = this.frameObj(ids[1]);
    }

    const total = (await this.core.getCredit(sessionid, scope)).totalCredit;
    if (total <= 0) await this.core.receiveCredit(sessionid, scope);

    const componentId = crypto.randomUUID().replace(/-/g, '');
    const commerce = { benefit_type: benefit, resource_id: 'generate_video', resource_id_type: 'str', resource_sub_type: 'aigc' };

    const requestData = {
      extend: { root_model: this.reqKey(modelName), m_video_commerce_info: commerce, m_video_commerce_info_list: [commerce] },
      submit_id: crypto.randomUUID().replace(/-/g, ''),
      metrics_extra: JSON.stringify({ enterFrom: 'click', isDefaultSeed: 1, promptSource: 'custom', isRegenerate: false, originSubmitId: crypto.randomUUID().replace(/-/g, '') }),
      draft_content: JSON.stringify({
        type: 'draft',
        id: crypto.randomUUID().replace(/-/g, ''),
        min_version: '3.0.5',
        is_from_tsn: true,
        version: DRAFT_VERSION,
        main_component_id: componentId,
        component_list: [
          {
            type: 'video_base_component',
            id: componentId,
            min_version: '1.0.0',
            metadata: { type: '', id: crypto.randomUUID().replace(/-/g, ''), created_platform: 3, created_platform_version: '', created_time_in_ms: Date.now(), created_did: '' },
            generate_type: 'gen_video',
            aigc_mode: 'workbench',
            abilities: {
              type: '',
              id: crypto.randomUUID().replace(/-/g, ''),
              gen_video: {
                id: crypto.randomUUID().replace(/-/g, ''),
                type: '',
                text_to_video_params: {
                  type: '', id: crypto.randomUUID().replace(/-/g, ''),
                  model_req_key: this.reqKey(modelName),
                  priority: 0,
                  seed: Math.floor(Math.random() * 100000000) + 2500000000,
                  video_aspect_ratio: ratio,
                  video_gen_inputs: [{ duration_ms: durationMs, first_frame_image: firstFrame, end_frame_image: endFrame, fps: 24, id: crypto.randomUUID().replace(/-/g, ''), min_version: '3.0.5', prompt, resolution, type: '', video_mode: 2 }],
                },
                video_task_extra: '',
              },
            },
          },
        ],
      }),
      http_common_info: { aid: Number(DEFAULT_ASSISTANT_ID) },
    };

    const { aigc_data } = await this.core
      .jimengRequest('post', '/mweb/v1/aigc_draft/generate', sessionid, {
        params: { aigc_features: 'app_lip_sync', web_version: WEB_VERSION, da_version: DRAFT_VERSION, web_component_open_flag: 1 },
        data: requestData,
      }, scope)
      .then((r) => this.core.checkResult(r));
    const historyId = aigc_data?.history_record_id;
    if (!historyId) throw new BadRequestException('即梦未返回记录ID');

    let status = 20, item_list: any[] = [];
    const MAX = 60;
    await new Promise((r) => setTimeout(r, 5000));
    for (let i = 0; i < MAX; i++) {
      const result = await this.core
        .jimengRequest('post', '/mweb/v1/get_history_by_ids', sessionid, { data: { history_ids: [historyId] } }, scope)
        .then((r) => this.core.checkResult(r));
      const rec = result?.[historyId] || (result?.history_list?.[0]) || (result?.history_records?.[0]);
      const url = extractVideoUrl((rec?.item_list) || []);
      if (url) return url;
      if (!rec) { await new Promise((r) => setTimeout(r, 2000 * Math.min(i + 1, 5))); continue; }
      status = rec.status;
      if (status === 30) throw new BadRequestException(`视频生成失败: ${rec.fail_code}`);
      item_list = rec.item_list || [];
      if (extractVideoUrl(item_list)) return extractVideoUrl(item_list)!;
      if (VIDEO_PROCESSING.includes(status)) await new Promise((r) => setTimeout(r, 2000 * Math.min(i + 2, 5)));
    }
    const finalUrl = extractVideoUrl(item_list);
    if (finalUrl) return finalUrl;
    throw new BadRequestException('即梦视频生成超时');
  }

  private frameObj(uri: string) {
    return { format: '', height: 1024, id: crypto.randomUUID().replace(/-/g, ''), image_uri: uri, name: '', platform_type: 1, source_from: 'upload', type: 'image', uri, width: 1024 };
  }

  /** 积分不足自动降级：先降时长，再降分辨率 */
  async generateWithRetry(
    model: string,
    prompt: string,
    opts: { ratio?: string; resolution?: string; duration?: number; filePaths?: string[] },
    sessionid: string,
    scope: NetworkScope,
  ): Promise<string> {
    const modelName = model || DEFAULT_VIDEO_MODEL;
    const supported = VIDEO_RESOLUTIONS[modelName] || ['720p'];
    const resLevels = supported.includes(opts.resolution || '') ? supported.slice(supported.indexOf(opts.resolution!)) : supported;
    const durLevels = [10, 5];
    let di = durLevels.indexOf(opts.duration ?? 10); if (di < 0) di = 0;
    for (let ri = 0; ri < resLevels.length; ri++) {
      for (; di < durLevels.length; di++) {
        try {
          return await this.generate(modelName, prompt, { ...opts, resolution: resLevels[ri], duration: durLevels[di] }, sessionid, scope);
        } catch (e: any) {
          const isCredit = e instanceof JimengInsufficientCreditError || e?.message?.includes('积分不足');
          if (!isCredit) throw e;
          if (di < durLevels.length - 1) { this.logger.warn('积分不足，降时长重试'); continue; }
          if (ri < resLevels.length - 1) { this.logger.warn(`积分不足，降分辨率到 ${resLevels[ri + 1]} 重试`); break; }
          throw new BadRequestException('积分不足，已降至最低配置仍失败，请前往即梦官网充值或重新导入 cookie');
        }
      }
      di = 0;
    }
    throw new BadRequestException('即梦视频生成失败');
  }
}
