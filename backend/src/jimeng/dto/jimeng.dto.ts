import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class ImportAccountsDto {
  /** 浏览器导出的 cookie JSON（单账号数组，或多个账号换行/数组分隔） */
  @IsString()
  cookies: string;

  /** 来源：local（本地导入）| external（来自 :18813 号池服务） */
  @IsOptional() @IsIn(['local', 'external'])
  source?: string;
}

export class UpdateAccountDto {
  @IsOptional() @IsString()
  label?: string;

  @IsOptional() @IsIn(['active', 'disabled', 'expired'])
  status?: string;
}

export class ImageGenDto {
  @IsOptional() @IsString()
  model?: string;

  @IsString()
  prompt: string;

  @IsOptional() @IsString()
  ratio?: string;

  @IsOptional() @IsIn(['1k', '2k'])
  resolution?: string;

  @IsOptional() @IsNumber()
  @Min(0) @Max(1)
  sampleStrength?: number;

  @IsOptional() @IsString()
  negativePrompt?: string;

  /** 可选参考图（远程 URL 或 base64 data URL） */
  @IsOptional() @IsString()
  filePath?: string;

  /** 参考图来源：本地上传 ID（与 filePath/characterId 三选一） */
  @IsOptional() @IsString()
  imageUploadId?: string;

  /** 参考图来源：形象库形象 ID（取最新一张图） */
  @IsOptional() @IsString()
  characterId?: string;

  /** 参考图来源：形象库精确到某一张图 */
  @IsOptional() @IsString()
  characterImageId?: string;

  /** 生成结果挂载到已有形象（形象库） */
  @IsOptional() @IsString()
  saveToCharacterId?: string;

  /** 或新建形象条目（与 saveToCharacterId 二选一） */
  @IsOptional() @IsString()
  newCharacterName?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  newCharacterTags?: string[];
}

export class VideoGenDto {
  @IsOptional() @IsString()
  model?: string;

  @IsString()
  prompt: string;

  @IsOptional() @IsString()
  ratio?: string;

  @IsOptional() @IsIn(['480p', '720p', '1080p', '4k'])
  resolution?: string;

  @IsOptional() @IsInt() @Min(5) @Max(10)
  duration?: number;

  /** 可选首/尾帧图（最多 2 张，远程 URL 或 base64） */
  @IsOptional() @IsArray()
  @IsString({ each: true })
  filePaths?: string[];

  /** 首帧来源：本地上传 ID */
  @IsOptional() @IsString()
  firstFrameUploadId?: string;

  /** 首帧来源：形象库形象 ID（取最新一张图） */
  @IsOptional() @IsString()
  firstFrameCharacterId?: string;

  /** 尾帧来源：本地上传 ID */
  @IsOptional() @IsString()
  endFrameUploadId?: string;

  /** 尾帧来源：形象库形象 ID */
  @IsOptional() @IsString()
  endFrameCharacterId?: string;
}
