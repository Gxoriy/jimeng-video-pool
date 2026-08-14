import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * 形象库批量导入 · 本地图片上传（先经 /uploads/image 拿到 uploadId 再传入）。
 * 支持 png/jpg/jpeg/webp；AI 用视觉能力识别主体并分配名称/分类/标签。
 */
export class ImportCharactersFromUploadDto {
  @IsArray()
  @IsString({ each: true })
  uploadIds: string[];

  /** 同名(名称)已存在时覆盖，默认跳过 */
  @IsOptional() @IsBoolean() overwrite?: boolean;

  /** 是否启用 AI 视觉识别分类（默认 true）。false 时跳过 AI，直接以 active 入库。 */
  @IsOptional() @IsBoolean() enableAi?: boolean;
}
