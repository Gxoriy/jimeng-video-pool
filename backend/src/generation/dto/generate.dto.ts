import { IsEnum, IsOptional, IsString, IsObject } from 'class-validator';
import { TaskType } from '../../common/roles.enum';

export class GenerateDto {
  @IsEnum(TaskType)
  type: TaskType;

  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  model?: string;

  /** 额外 provider 参数（size/n/audioUrl/imageUrl/runninghubInputs...） */
  @IsOptional()
  @IsObject()
  params?: Record<string, any>;

  /** 引用库（用于把结果挂到形象/关联歌曲/提示词） */
  @IsOptional()
  @IsObject()
  libraryRef?: {
    characterId?: string;
    songId?: string;
    promptId?: string;
  };
}
