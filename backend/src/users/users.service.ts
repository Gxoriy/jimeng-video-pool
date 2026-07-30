import { Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { Role, NetworkScope } from '../common/roles.enum';
import { CreateUserDto, UpdateUserDto } from '../auth/dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto, createdBy: string) {
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });
    return this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        role: (dto.role ?? Role.NORMAL_USER) as any,
        networkScope: (dto.networkScope ?? NetworkScope.RESTRICTED) as any,
        createdBy,
      },
      select: {
        id: true,
        username: true,
        role: true,
        networkScope: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async findAll(page = 1, pageSize = 200, q?: string) {
    const where = q ? { username: { contains: q } } : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          role: true,
          networkScope: true,
          status: true,
          createdBy: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    const { passwordHash, ...rest } = user;
    return rest;
  }

  async update(id: string, dto: UpdateUserDto) {
    const data: any = {};
    if (dto.password) data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    if (dto.role) data.role = dto.role as any;
    if (dto.networkScope) data.networkScope = dto.networkScope as any;
    if (typeof dto.status === 'boolean') data.status = dto.status;
    return this.prisma.user.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.user.delete({ where: { id } });
    return { id };
  }
}
