import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/** 渠道可用阶段：P1 生成形象 / P2 获取灵感 / 歌曲库 AI 分类归档（P3 走 RunningHub，不在此列） */
export const CHANNEL_STAGES = ['character', 'inspiration', 'song'] as const;
export type ChannelStage = (typeof CHANNEL_STAGES)[number];

export class CreateChannelDto {
  @IsString() name: string;

  @IsOptional() @IsIn(['openai', 'anthropic']) protocol?: string;

  /** 形如 https://new.api.edu.gr/v1 */
  @IsString() baseUrl: string;

  @IsString() apiKey: string;

  @IsOptional() @IsString() model?: string;

  @IsOptional() @IsBoolean() enabled?: boolean;

  /** 可用阶段，数组形式；落库时转成逗号分隔字符串 */
  @IsOptional() @IsArray() @IsIn(CHANNEL_STAGES as unknown as string[], { each: true })
  usableFor?: ChannelStage[];

  @IsOptional() @IsBoolean() supportsImage?: boolean;
  @IsOptional() @IsBoolean() supportsVision?: boolean;
  @IsOptional() @IsBoolean() streaming?: boolean;

  @IsOptional() @IsString() proxyUrl?: string;
  @IsOptional() @IsString() remark?: string;
}

export class UpdateChannelDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(['openai', 'anthropic']) protocol?: string;
  @IsOptional() @IsString() baseUrl?: string;
  /** 留空表示不修改 Key */
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;

  @IsOptional() @IsArray() @IsIn(CHANNEL_STAGES as unknown as string[], { each: true })
  usableFor?: ChannelStage[];

  @IsOptional() @IsBoolean() supportsImage?: boolean;
  @IsOptional() @IsBoolean() supportsVision?: boolean;
  @IsOptional() @IsBoolean() streaming?: boolean;

  @IsOptional() @IsString() proxyUrl?: string;
  @IsOptional() @IsString() remark?: string;
}

/** 用未保存的表单直接测试连通性 */
export class TestChannelDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() model?: string;
}
