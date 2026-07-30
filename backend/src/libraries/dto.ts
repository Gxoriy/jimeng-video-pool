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
  @IsOptional() duration?: number;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
}

export class UpdateSongDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() artist?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() localPath?: string;
  @IsOptional() duration?: number;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() description?: string;
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

export class RegenCharacterDto {
  @IsString() songId: string;
  @IsOptional() @IsString() promptId?: string;
  @IsOptional() @IsString() promptText?: string;
  @IsOptional() @IsString() model?: string;
}
