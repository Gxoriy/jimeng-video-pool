import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { GenerationService } from './generation.service';
import { GenerateDto } from './dto/generate.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

@Controller('generation')
@UseGuards(JwtAuthGuard)
export class GenerationController {
  constructor(private generation: GenerationService) {}

  @Post()
  generate(
    @Body() dto: GenerateDto,
    @CurrentUser() user: AuthUser,
    @Req() req: any,
  ) {
    const bearer = req.headers?.authorization;
    return this.generation.generate(dto, user, bearer);
  }

  @Get('providers')
  providers() {
    return { code: 0, data: this.generation.listProviders() };
  }
}
