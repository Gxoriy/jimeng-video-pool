import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { PromptType } from '@prisma/client';

export class CreateCharacterDto {
  @IsString() name: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
}

export class UpdateCharacterDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
}

export class CreateSongDto {
  @IsString() title: string;
  @IsOptional() @IsString() artist?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() localPath?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() duration?: number;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
  /** 歌词：P2 获取灵感时作为音乐信息喂给 AI */
  @IsOptional() @IsString() lyrics?: string;
  /** 入库状态：pending_review | active（批量导入默认 pending_review，需人工归档） */
  @IsOptional() @IsString() status?: string;
}

export class UpdateSongDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() artist?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() localPath?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() duration?: number;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() lyrics?: string;
  @IsOptional() @IsString() status?: string;
}

export class CreatePromptDto {
  @IsString() title: string;
  @IsString() content: string;
  @IsEnum(PromptType) type: PromptType;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
}

export class UpdatePromptDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsEnum(PromptType) type?: PromptType;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
}

/* ---------------- 批量导入 ---------------- */

export class BatchCharacterItemDto {
  @IsString() name: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
  /** 一次性附带多张形象图 URL */
  @IsOptional() @IsArray() imageUrls?: string[];
}

export class BatchImportCharactersDto {
  @IsArray() items: BatchCharacterItemDto[];
  /** 同名时覆盖（默认跳过） */
  @IsOptional() overwrite?: boolean;
}

export class BatchImportSongsDto {
  @IsArray() items: CreateSongDto[];
  @IsOptional() overwrite?: boolean;
}

export class BatchImportPromptsDto {
  @IsArray() items: CreatePromptDto[];
  @IsOptional() overwrite?: boolean;
}
