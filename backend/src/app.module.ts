import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { EgressModule } from './egress/egress.module';
import { MediaModule } from './media/media.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { KeyPoolModule } from './key-pool/key-pool.module';
import { GenerationModule } from './generation/generation.module';
import { LibrariesModule } from './libraries/libraries.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    PrismaModule,
    EgressModule,
    MediaModule,
    AuthModule,
    UsersModule,
    KeyPoolModule,
    GenerationModule,
    LibrariesModule,
    TasksModule,
  ],
})
export class AppModule {}
