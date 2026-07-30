import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { Role, NetworkScope } from '../common/roles.enum';
import { LoginDto } from './dto/login.dto';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  networkScope: NetworkScope;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  /**
   * 创建用户：仅超级管理员调用（由控制器 @Roles 约束）。
   * 密码用 argon2id 加盐哈希（修复 jimen2api 无盐 SHA-256 风险）。
   */
  async createUser(
    dto: { username: string; password: string; role?: Role; networkScope?: NetworkScope },
    createdBy: string,
  ) {
    const exists = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (exists) throw new ConflictException('用户名已存在');

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

  async validateUser(username: string, password: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.status) throw new UnauthorizedException('用户名或密码错误');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('用户名或密码错误');

    return {
      id: user.id,
      username: user.username,
      role: user.role as Role,
      networkScope: user.networkScope as NetworkScope,
    };
  }

  async login(user: AuthUser): Promise<TokenPair> {
    return this.signTokens(user);
  }

  async refresh(userId: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.status) throw new UnauthorizedException('用户不可用');
    return this.signTokens({
      id: user.id,
      username: user.username,
      role: user.role as Role,
      networkScope: user.networkScope as NetworkScope,
    });
  }

  private signTokens(user: AuthUser): TokenPair {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      networkScope: user.networkScope,
    };
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: '15m' }),
      refreshToken: this.jwt.sign(payload, { expiresIn: '7d' }),
    };
  }
}
