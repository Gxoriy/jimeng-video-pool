import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from '../auth/dto/create-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { PaginationDto } from '../common/dto/pagination.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN) // 仅超级管理员可管理用户（需求 #12）
export class UsersController {
  constructor(private users: UsersService) {}

  @Post()
  async create(@Body() dto: CreateUserDto, @CurrentUser() me: AuthUser) {
    const data = await this.users.create(dto, me.id);
    return { code: 0, message: 'ok', data };
  }

  @Get()
  async findAll(@Query() q: PaginationDto) {
    const data = await this.users.findAll(q.page, q.pageSize, q.q);
    return { code: 0, message: 'ok', data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.users.findOne(id);
    return { code: 0, message: 'ok', data };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const data = await this.users.update(id, dto);
    return { code: 0, message: 'ok', data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.users.remove(id);
    return { code: 0, message: 'ok', data: null };
  }
}
