import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * 视频工作区统一任务入参：图片 + 音频 + 参数。
 * 图片/音频可来自形象库/歌曲库（ID）或本地上传（uploadId）。
 */
export class WorkspaceDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsUUID()
  characterImageId?: string;

  @IsOptional()
  @IsUUID()
  characterId?: string;

  @IsOptional()
  @IsUUID()
  imageUploadId?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsUUID()
  songId?: string;

  @IsOptional()
  @IsUUID()
  audioUploadId?: string;

  @IsOptional()
  @IsString()
  audioUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  audioStartSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  audioEndSeconds?: number;

  @IsOptional()
  @IsInt()
  maxResolution?: number;

  @IsOptional()
  @IsInt()
  fps?: number;
}

/**
 * 断点续跑时可覆盖部分参数（如调整生成秒数、分辨率、帧率）。
 */
export class WorkspaceRetryDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  audioStartSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  audioEndSeconds?: number;

  @IsOptional()
  @IsInt()
  maxResolution?: number;

  @IsOptional()
  @IsInt()
  fps?: number;
}
