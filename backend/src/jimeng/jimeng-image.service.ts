import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { JimengCoreService, JIMENG_CONSTANTS, JimengInsufficientCreditError } from './jimeng-core.service';
import { NetworkScope } from '../common/roles.enum';

const { DEFAULT_ASSISTANT_ID, DRAFT_VERSION, WEB_VERSION, MIN_VERSION } = JIMENG_CONSTANTS;

const IMAGE_MODEL_MAP: Record<string, string> = {
  'jimeng-image-5.0-lite': 'high_aes_general_v50',
  'jimeng-image-4.7': 'high_aes_general_v43',
  'jimeng-image-4.6': 'high_aes_general_v42',
  'jimeng-image-4.5': 'high_aes_general_v40l',
  'jimeng-image-4.1': 'high_aes_general_v41',
  'jimeng-image-4.0': 'high_aes_general_v40',
  'jimeng-image-3.1': 'high_aes_general_v30l_art_fangzhou:general_v3.0_18b',
  'jimeng-image-3.0': 'high_aes_general_v30l:general_v3.0_18b',
  'jimeng-image-2.0-pro': 'high_aes_general_v20_L:general_v2.0_L',
};
export const DEFAULT_IMAGE_MODEL = 'jimeng-image-5.0-lite';

// ratio -> image_ratio 值
const RATIO_VALUES: Record<string, number> = {
  '21:9': 0,
  '16:9': 1,
  '3:2': 2,
  '4:3': 3,
  '1:1': 8,
  '3:4': 4,
  '2:3': 5,
  '9:16': 6,
};
const DIMENSIONS_1K: Record<string, { width: number; height: number }> = {
  '21:9': { width: 2016, height: 846 },
  '16:9': { width: 1664, height: 936 },
  '3:2': { width: 1584, height: 1056 },
  '4:3': { width: 1472, height: 1104 },
  '1:1': { width: 1328, height: 1328 },
  '3:4': { width: 1104, height: 1472 },
  '2:3': { width: 1056, height: 1584 },
  '9:16': { width: 936, height: 1664 },
};
const DIMENSIONS_2K: Record<string, { width: number; height: number }> = {
  '21:9': { width: 3024, height: 1296 },
  '16:9': { width: 2560, height: 1440 },
  '3:2': { width: 2496, height: 1664 },
  '4:3': { width: 2304, height: 1728 },
  '1:1': { width: 2048, height: 2048 },
  '3:4': { width: 1728, height: 2304 },
  '2:3': { width: 1664, height: 2496 },
  '9:16': { width: 1440, height: 2560 },
};

// 高分辨率模型（支持 2k）
const HIGH_RES_MODELS = [
  'jimeng-image-5.0-lite',
  'jimeng-image-4.7',
  'jimeng-image-4.6',
  'jimeng-image-4.5',
  'jimeng-image-4.1',
  'jimeng-image-4.0',
];

function detectAspectRatioKey(prompt: string): string | null {
  const matches = [...prompt.matchAll(/(\d+)\s*[:：]\s*(\d+)/g)];
  for (const m of matches) {
    const key = `${m[1]}:${m[2]}`;
    if (Object.keys(RATIO_VALUES).includes(key)) return key;
  }
  if (/横屏|横版|宽屏/.test(prompt)) return '16:9';
  if (/竖屏|竖版|手机/.test(prompt)) return '9:16';
  if (/方形|正方/.test(prompt)) return '1:1';
  return null;
}

@Injectable()
export class JimengImageService {
  private readonly logger = new Logger(JimengImageService.name);
  constructor(private readonly core: JimengCoreService) {}

  getModels(): { id: string; name: string }[] {
    return Object.keys(IMAGE_MODEL_MAP).map((id) => ({ id, name: id }));
  }

  private modelReqKey(model: string): string {
    return IMAGE_MODEL_MAP[model] || IMAGE_MODEL_MAP[DEFAULT_IMAGE_MODEL];
  }

  async generate(
    model: string,
    prompt: string,
    opts: { ratio?: string; resolution?: string; sampleStrength?: number; negativePrompt?: string; filePath?: string },
    sessionid: string,
    scope: NetworkScope,
  ): Promise<string[]> {
    const modelName = model || DEFAULT_IMAGE_MODEL;
    const ratio = RATIO_VALUES.hasOwnProperty(opts.ratio || '') ? opts.ratio! : '1:1';
    const validRatio = detectAspectRatioKey(prompt) && ratio === '1:1' ? detectAspectRatioKey(prompt)! : ratio;
    const imageRatio = RATIO_VALUES[validRatio] ?? 8;
    const isHighRes = HIGH_RES_MODELS.includes(modelName);
    const resolutionType = isHighRes ? opts.resolution || '2k' : '1k';
    const dimMap = resolutionType === '2k' ? DIMENSIONS_2K : DIMENSIONS_1K;
    const dims = dimMap[validRatio] || dimMap['1:1'];

    // 可选参考图上传
    let uploadID: string | null = null;
    if (opts.filePath) {
      uploadID = await this.core.uploadFile(sessionid, opts.filePath, scope);
    }

    const total = (await this.core.getCredit(sessionid, scope)).totalCredit;
    if (total <= 0) await this.core.receiveCredit(sessionid, scope);

    const componentId = crypto.randomUUID().replace(/-/g, '');
    const seed = Math.floor(Math.random() * 100000000) + 2500000000;

    const abilities = uploadID
      ? {
          type: '',
          id: componentId,
          blend: {
            type: '',
            id: crypto.randomUUID().replace(/-/g, ''),
            min_features: [],
            core_param: {
              type: '',
              id: crypto.randomUUID().replace(/-/g, ''),
              model: this.modelReqKey(modelName),
              prompt: prompt + '##',
              sample_strength: opts.sampleStrength ?? 0.5,
              image_ratio: imageRatio,
              large_image_info: { type: '', id: crypto.randomUUID().replace(/-/g, ''), height: dims.height, width: dims.width, resolution_type: resolutionType },
            },
            ability_list: [
              {
                type: '',
                id: crypto.randomUUID().replace(/-/g, ''),
                name: 'byte_edit',
                image_uri_list: [uploadID],
                image_list: [{ type: 'image', id: crypto.randomUUID().replace(/-/g, ''), source_from: 'upload', platform_type: 1, name: '', image_uri: uploadID, width: 0, height: 0, format: '', uri: uploadID }],
                strength: 0.5,
              },
            ],
            history_option: { type: '', id: crypto.randomUUID().replace(/-/g, '') },
            prompt_placeholder_info_list: [{ type: '', id: crypto.randomUUID().replace(/-/g, ''), ability_index: 0 }],
            postedit_param: { type: '', id: crypto.randomUUID().replace(/-/g, ''), generate_type: 0 },
          },
        }
      : {
          type: '',
          id: componentId,
          generate: {
            type: '',
            id: crypto.randomUUID().replace(/-/g, ''),
            core_param: {
              type: '',
              id: crypto.randomUUID().replace(/-/g, ''),
              model: this.modelReqKey(modelName),
              prompt,
              negative_prompt: opts.negativePrompt || '',
              seed,
              sample_strength: opts.sampleStrength ?? 0.5,
              image_ratio: imageRatio,
              large_image_info: { type: '', id: crypto.randomUUID().replace(/-/g, ''), height: dims.height, width: dims.width, resolution_type: resolutionType },
            },
            history_option: { type: '', id: crypto.randomUUID().replace(/-/g, '') },
          },
        };

    const submitId = crypto.randomUUID().replace(/-/g, '');
    const requestData = {
      extend: { root_model: this.modelReqKey(modelName) },
      submit_id: submitId,
      draft_content: JSON.stringify({
        type: 'draft',
        id: crypto.randomUUID().replace(/-/g, ''),
        min_version: MIN_VERSION,
        min_features: [],
        is_from_tsn: true,
        version: DRAFT_VERSION,
        main_component_id: componentId,
        component_list: [
          {
            type: 'image_base_component',
            id: componentId,
            min_version: MIN_VERSION,
            metadata: { type: '', id: crypto.randomUUID().replace(/-/g, ''), created_platform: 3, created_platform_version: '', created_time_in_ms: String(Date.now()), created_did: '' },
            generate_type: uploadID ? 'blend' : 'generate',
            aigc_mode: 'workbench',
            abilities,
          },
        ],
      }),
      http_common_info: { aid: Number(DEFAULT_ASSISTANT_ID) },
    };

    const { aigc_data } = await this.core
      .jimengRequest('post', '/mweb/v1/aigc_draft/generate', sessionid, {
        params: { da_version: DRAFT_VERSION, web_component_open_flag: 1, web_version: WEB_VERSION },
        data: requestData,
      }, scope)
      .then((r) => this.core.checkResult(r));
    const historyId = aigc_data?.history_record_id;
    if (!historyId) throw new BadRequestException('即梦未返回记录ID');

    const PROCESSING = [20, 42, 45];
    let status = 20, item_list: any[] = [];
    const MAX = 120;
    for (let i = 0; i < MAX; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const result = await this.core
        .jimengRequest('post', '/mweb/v1/get_history_by_ids', sessionid, {
          data: { history_ids: [historyId], http_common_info: { aid: Number(DEFAULT_ASSISTANT_ID) } },
        }, scope)
        .then((r) => this.core.checkResult(r));
      const rec = result?.[historyId];
      if (!rec) throw new BadRequestException('即梦记录不存在');
      status = rec.status;
      item_list = rec.item_list || [];
      if (!PROCESSING.includes(status) || (item_list && item_list.length)) break;
    }
    if (status === 30) throw new BadRequestException('即梦图像生成失败');
    if (!item_list || !item_list.length) throw new BadRequestException('即梦图像生成超时');
    return item_list.map((item: any) => item?.image?.large_images?.[0]?.image_url || item?.common_attr?.cover_url || null).filter(Boolean);
  }

  /** 积分不足自动降级分辨率重试 */
  async generateWithRetry(
    model: string,
    prompt: string,
    opts: { ratio?: string; resolution?: string; sampleStrength?: number; negativePrompt?: string; filePath?: string },
    sessionid: string,
    scope: NetworkScope,
  ): Promise<string[]> {
    const modelName = model || DEFAULT_IMAGE_MODEL;
    const supports2k = HIGH_RES_MODELS.includes(modelName);
    const levels = supports2k ? ['2k', '1k'] : ['1k'];
    const startRes = levels.includes(opts.resolution || '') ? opts.resolution! : levels[0];
    const startIndex = Math.max(0, levels.indexOf(startRes));
    for (let i = startIndex; i < levels.length; i++) {
      try {
        return await this.generate(modelName, prompt, { ...opts, resolution: levels[i] }, sessionid, scope);
      } catch (e: any) {
        const isCredit = e instanceof JimengInsufficientCreditError || e?.message?.includes('积分不足');
        if (isCredit && i < levels.length - 1) {
          this.logger.warn(`积分不足，降级到 ${levels[i + 1]} 重试`);
          continue;
        }
        throw e;
      }
    }
    throw new BadRequestException('即梦图像生成失败');
  }
}
