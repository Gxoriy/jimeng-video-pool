import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, IsEnum, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/* ================= 账号导入 / 更新 DTO（供 admin 控制器使用） ================= */

export class ImportAccountsDto {
  @IsArray()
  @IsString({ each: true })
  cookies: string[];

  @IsOptional()
  @IsString()
  source?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

/* ================= 全能参考相关 DTO ================= */

/** 参考素材类型 */
export enum ReferenceType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  CHARACTER = 'character',
}

/** 单个参考素材 */
export class ReferenceItemDto {
  @IsEnum(ReferenceType)
  type: ReferenceType;

  @IsOptional()
  @IsString()
  uploadId?: string;

  @IsOptional()
  @IsString()
  characterId?: string;

  @IsOptional()
  @IsString()
  characterImageId?: string;

  @IsString()
  mentionLabel: string;

  @IsOptional()
  @IsString()
  url?: string;
}

/** 全能参考模式 */
export enum OmniReferenceMode {
  OFF = 'off',
  CHARACTER = 'character',   // 角色参考
  MOTION = 'motion',        // 动作参考
  STYLE = 'style',          // 风格参考
  OMNI = 'omni',            // 全能参考（组合）
}

/* ================= 视频生成 DTO ================= */

export class GenerateVideoDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsString()
  @MaxLength(2000)
  prompt: string;

  @IsOptional()
  @IsString()
  ratio?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @IsString()
  firstFrameUploadId?: string;

  @IsOptional()
  @IsString()
  endFrameUploadId?: string;

  @IsOptional()
  @IsEnum(OmniReferenceMode)
  referenceMode?: OmniReferenceMode;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceItemDto)
  references?: ReferenceItemDto[];
}

/* ================= 图片生成 DTO ================= */

export class GenerateImageDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsString()
  @MaxLength(2000)
  prompt: string;

  @IsOptional()
  @IsString()
  ratio?: string;

  @IsOptional()
  @IsString()
  imageUploadId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceItemDto)
  references?: ReferenceItemDto[];
}

