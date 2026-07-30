import { Module } from '@nestjs/common';
import { GenerationService } from './generation.service';
import { GenerationController } from './generation.controller';
import { ImageProvider } from './providers/image.provider';
import { DigitalHumanProvider } from './providers/digital-human.provider';
import { VideoProvider } from './providers/video.provider';
import { RunningHubProvider } from './providers/runninghub.provider';
import { ProviderFactory } from './providers/provider.factory';
import { KeyPoolModule } from '../key-pool/key-pool.module';

@Module({
  imports: [KeyPoolModule],
  controllers: [GenerationController],
  providers: [
    GenerationService,
    ImageProvider,
    DigitalHumanProvider,
    VideoProvider,
    RunningHubProvider,
    ProviderFactory,
  ],
  exports: [GenerationService],
})
export class GenerationModule {}
