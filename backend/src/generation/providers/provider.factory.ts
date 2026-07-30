import { Injectable, NotFoundException } from '@nestjs/common';
import { IGenerationProvider } from './base.provider';
import { ImageProvider } from './image.provider';
import { DigitalHumanProvider } from './digital-human.provider';
import { VideoProvider } from './video.provider';
import { RunningHubProvider } from './runninghub.provider';
import { TaskType, Provider as KeyProvider } from '../../common/roles.enum';

/**
 * Provider 工厂：按生成类型路由到对应实现（设计 §4.2）。
 */
@Injectable()
export class ProviderFactory {
  constructor(
    private image: ImageProvider,
    private digitalHuman: DigitalHumanProvider,
    private video: VideoProvider,
    private rh: RunningHubProvider,
  ) {}

  get(type: TaskType): IGenerationProvider {
    switch (type) {
      case TaskType.image:
        return this.image;
      case TaskType.digital_human:
        return this.digitalHuman;
      case TaskType.video:
        return this.video;
      default:
        throw new NotFoundException(`未知生成类型: ${type}`);
    }
  }

  /** 该类型对应的 Key provider（决定从哪个 Key 池选号） */
  keyProviderOf(type: TaskType): KeyProvider {
    return type === TaskType.image ? KeyProvider.OPENAI : KeyProvider.RUNNINGHUB;
  }
}
