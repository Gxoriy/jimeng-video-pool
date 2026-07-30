import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Role, NetworkScope } from '../../common/roles.enum';

export class CreateUserDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(NetworkScope)
  networkScope?: NetworkScope;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(NetworkScope)
  networkScope?: NetworkScope;

  @IsOptional()
  status?: boolean;
}
