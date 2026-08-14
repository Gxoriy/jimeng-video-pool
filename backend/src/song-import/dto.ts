import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

/**
 * 批量导入 · 方式一：「歌名-作者」文本自动下载。
 * 每行形如「歌名-作者」，支持 - / — / – 分隔；无分隔符整行当歌名、作者置空。
 */
export class ImportFromTextDto {
  @IsString()
  text: string;

  /** 同名(歌名+作者)已存在时覆盖，默认跳过 */
  @IsOptional() @IsBoolean() overwrite?: boolean;

  /** 是否启用 AI 识别分类（默认 true）。false 时跳过 AI，直接以 active 入库。 */
  @IsOptional() @IsBoolean() enableAi?: boolean;
}

/**
 * 批量导入 · 方式二：本地上传音频文件（先经 /uploads/audio 拿到 uploadId 再传入）。
 */
export class ImportFromUploadDto {
  @IsArray()
  @IsString({ each: true })
  uploadIds: string[];

  @IsOptional() @IsBoolean() overwrite?: boolean;

  /** 是否启用 AI 识别分类（默认 true）。false 时跳过 AI，直接以 active 入库。 */
  @IsOptional() @IsBoolean() enableAi?: boolean;
}

/** 单首歌的 AI 识别结果 */
export class SongClassification {
  @IsString() title: string;
  @IsOptional() @IsString() artist?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() description?: string;
}
