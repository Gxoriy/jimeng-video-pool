import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Provider } from '../../common/roles.enum';

export class CreateApiKeyDto {
  @IsEnum(Provider)
  provider: Provider;

  @IsString()
  key: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  label?: string;
}
