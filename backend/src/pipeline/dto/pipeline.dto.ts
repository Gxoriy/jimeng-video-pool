import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/* ------------------------------------------------------------------ *
 * P1 生成形象
 *   提示词必填（手填 或 从提示词库挑）
 *   参考图可选（上传 或 从形象库挑）
 *   可带歌曲库的音乐信息，让形象契合歌曲气质
 * ------------------------------------------------------------------ */
export class CharacterGenDto {
  /** AI 渠道（超级管理员配置），留空用默认可用渠道 */
  @IsOptional() @IsString() channelId?: string;
  @IsOptional() @IsString() model?: string;

  /** 提示词：promptId 与 promptText 至少给一个 */
  @IsOptional() @IsString() promptId?: string;
  @IsOptional() @IsString() promptText?: string;

  /** 参考图（可选）：上传得到的 URL */
  @IsOptional() @IsArray() @IsString({ each: true }) referenceImageUrls?: string[];
  /** 参考图（可选）：本地上传后的文件 ID */
  @IsOptional() @IsString() imageUploadId?: string;
  /** 参考图（可选）：从形象库选一个形象，取其封面/最新图 */
  @IsOptional() @IsString() referenceCharacterId?: string;
  /** 参考图（可选）：精确到形象库中的某一张图 */
  @IsOptional() @IsString() referenceCharacterImageId?: string;

  /** 音乐信息（可选）：从歌曲库选，用于让形象契合歌曲 */
  @IsOptional() @IsString() songId?: string;

  @IsOptional() @IsString() size?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) n?: number;

  /** 结果落库：挂到已有形象，或用该名称新建形象条目 */
  @IsOptional() @IsString() saveToCharacterId?: string;
  @IsOptional() @IsString() newCharacterName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) newCharacterTags?: string[];
}

/* ------------------------------------------------------------------ *
 * P2 获取灵感
 *   参考图（上传 或 形象库） + 参考音频（上传 或 歌曲库）
 *   -> 产出用于构建数字人视频的「动作提示词」
 * ------------------------------------------------------------------ */
export class InspirationDto {
  @IsOptional() @IsString() channelId?: string;
  @IsOptional() @IsString() model?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) referenceImageUrls?: string[];
  @IsOptional() @IsString() imageUploadId?: string;
  @IsOptional() @IsString() referenceCharacterId?: string;
  @IsOptional() @IsString() referenceCharacterImageId?: string;

  /** 参考音频：上传得到的 URL */
  @IsOptional() @IsString() audioUrl?: string;
  /** 参考音频：本地上传后的文件 ID */
  @IsOptional() @IsString() audioUploadId?: string;
  /** 参考音频：从歌曲库选 */
  @IsOptional() @IsString() songId?: string;

  /** 额外要求（如「镜头固定」「情绪激昂」） */
  @IsOptional() @IsString() extraRequirement?: string;

  /** 生成后是否存进提示词库（type=action） */
  @IsOptional() @IsBoolean() saveToPromptLibrary?: boolean;
  @IsOptional() @IsString() savePromptTitle?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) savePromptTags?: string[];
}

/* ------------------------------------------------------------------ *
 * P3 视频生成（RunningHub 工作流 2031016553440878594）
 *   图片 + 音频 + 生成秒数 + 对口型起止秒 + 动作提示词 + 最大分辨率 + 帧率
 *   使用**用户自己的** RunningHub API Key
 * ------------------------------------------------------------------ */
export class VideoGenDto {
  /** 图片来源三选一 */
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() imageUploadId?: string;
  @IsOptional() @IsString() characterId?: string;
  @IsOptional() @IsString() characterImageId?: string;

  /** 音频来源三选一 */
  @IsOptional() @IsString() audioUrl?: string;
  @IsOptional() @IsString() audioUploadId?: string;
  @IsOptional() @IsString() songId?: string;

  /** 生成秒数：35 秒内效果更佳；0 = 整段音频 */
  @Type(() => Number) @IsNumber() @Min(0) @Max(600)
  durationSeconds: number;

  /** 音频从第几秒开始对口型（例：0-10 秒 → start=0, end=10） */
  @Type(() => Number) @IsNumber() @Min(0)
  audioStartSeconds: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  audioEndSeconds?: number;

  /** 动作提示词（可来自 P2 获取灵感） */
  @IsString()
  actionPrompt: string;

  /** 最大分辨率：小于 1600，越大越慢 */
  @Type(() => Number) @IsInt() @Min(256) @Max(1599)
  maxResolution: number;

  /** 帧率，默认 25 */
  @Type(() => Number) @IsInt() @Min(8) @Max(60)
  fps: number;

  /** 高级：直接覆盖 RunningHub 节点映射 */
  @IsOptional() @IsArray()
  nodeOverrides?: Array<{ nodeId: string; fieldName: string; fieldValue: string | number }>;
}
