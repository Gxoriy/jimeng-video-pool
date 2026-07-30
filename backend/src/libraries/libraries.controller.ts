import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LibrariesService } from './libraries.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateCharacterDto,
  UpdateCharacterDto,
  CreateSongDto,
  UpdateSongDto,
  CreatePromptDto,
  UpdatePromptDto,
  RegenCharacterDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

@Controller('libraries')
@UseGuards(JwtAuthGuard)
export class LibrariesController {
  constructor(private libs: LibrariesService) {}

  // 形象库
  @Get('characters')
  listCharacters(@Query() q: PaginationDto) {
    return this.libs.listCharacters(q);
  }
  @Get('characters/:id')
  getCharacter(@Param('id') id: string) {
    return this.libs.getCharacter(id);
  }
  @Post('characters')
  createCharacter(@Body() dto: CreateCharacterDto) {
    return this.libs.createCharacter(dto);
  }
  @Put('characters/:id')
  updateCharacter(@Param('id') id: string, @Body() dto: UpdateCharacterDto) {
    return this.libs.updateCharacter(id, dto);
  }
  @Delete('characters/:id')
  deleteCharacter(@Param('id') id: string) {
    return this.libs.deleteCharacter(id);
  }
  @Post('characters/:id/regen')
  regen(
    @Param('id') id: string,
    @Body() dto: RegenCharacterDto,
    @CurrentUser() user: AuthUser,
    @Req() req: any,
  ) {
    return this.libs.regenCharacter(id, dto, user, req.headers?.authorization);
  }

  // 歌曲库
  @Get('songs')
  listSongs(@Query() q: PaginationDto) {
    return this.libs.listSongs(q);
  }
  @Get('songs/:id')
  getSong(@Param('id') id: string) {
    return this.libs.getSong(id);
  }
  @Post('songs')
  createSong(@Body() dto: CreateSongDto) {
    return this.libs.createSong(dto);
  }
  @Put('songs/:id')
  updateSong(@Param('id') id: string, @Body() dto: UpdateSongDto) {
    return this.libs.updateSong(id, dto);
  }
  @Delete('songs/:id')
  deleteSong(@Param('id') id: string) {
    return this.libs.deleteSong(id);
  }

  // 提示词库
  @Get('prompts')
  listPrompts(@Query() q: PaginationDto) {
    return this.libs.listPrompts(q);
  }
  @Get('prompts/:id')
  getPrompt(@Param('id') id: string) {
    return this.libs.getPrompt(id);
  }
  @Post('prompts')
  createPrompt(@Body() dto: CreatePromptDto) {
    return this.libs.createPrompt(dto);
  }
  @Put('prompts/:id')
  updatePrompt(@Param('id') id: string, @Body() dto: UpdatePromptDto) {
    return this.libs.updatePrompt(id, dto);
  }
  @Delete('prompts/:id')
  deletePrompt(@Param('id') id: string) {
    return this.libs.deletePrompt(id);
  }

  // 标签
  @Get('tags/:type')
  listTags(@Param('type') type: string) {
    return this.libs.listTags(type);
  }
  @Post('tags/:type')
  ensureTag(@Param('type') type: string, @Body('name') name: string) {
    return this.libs.ensureTag(type, name);
  }
}
