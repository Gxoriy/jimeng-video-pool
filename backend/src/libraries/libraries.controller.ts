import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
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
  BatchImportCharactersDto,
  BatchImportSongsDto,
  BatchImportPromptsDto,
  AppendCharacterImagesDto,
  PatchCharacterImageDto,
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
  async listCharacters(@Query() q: PaginationDto, @Query('status') status?: string) {
    const data = await this.libs.listCharacters(q, status);
    return { code: 0, message: 'ok', data };
  }
  @Get('characters/:id')
  async getCharacter(@Param('id') id: string) {
    const data = await this.libs.getCharacter(id);
    return { code: 0, message: 'ok', data };
  }
  @Post('characters')
  async createCharacter(@Body() dto: CreateCharacterDto) {
    const data = await this.libs.createCharacter(dto);
    return { code: 0, message: 'ok', data };
  }
  @Put('characters/:id')
  async updateCharacter(@Param('id') id: string, @Body() dto: UpdateCharacterDto) {
    const data = await this.libs.updateCharacter(id, dto);
    return { code: 0, message: 'ok', data };
  }
  @Delete('characters/:id')
  async deleteCharacter(@Param('id') id: string) {
    await this.libs.deleteCharacter(id);
    return { code: 0, message: 'ok', data: null };
  }
  /** 人工审核通过后归档入库 */
  @Post('characters/:id/archive')
  async archiveCharacter(@Param('id') id: string) {
    const data = await this.libs.archiveCharacter(id);
    return { code: 0, message: 'ok', data };
  }
  /** 向已有形象追加多张不同风格/背景的图（内部版多图需求） */
  @Post('characters/:id/images')
  async appendCharacterImages(
    @Param('id') id: string,
    @Body() dto: AppendCharacterImagesDto,
    @CurrentUser() user: AuthUser,
  ) {
    const data = await this.libs.appendCharacterImages(id, dto, user);
    return { code: 0, message: 'ok', data };
  }
  @Delete('characters/:id/images/:imageId')
  async deleteCharacterImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    const data = await this.libs.deleteCharacterImage(id, imageId);
    return { code: 0, message: 'ok', data };
  }
  @Patch('characters/:id/images/:imageId')
  async patchCharacterImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() dto: PatchCharacterImageDto,
  ) {
    const data = await this.libs.patchCharacterImage(id, imageId, dto);
    return { code: 0, message: 'ok', data };
  }
  /** 批量导入形象 */
  @Post('characters/batch-import')
  async batchImportCharacters(
    @Body() dto: BatchImportCharactersDto,
    @CurrentUser() user: AuthUser,
  ) {
    const data = await this.libs.batchImportCharacters(dto, user);
    return { code: 0, message: 'ok', data };
  }

  // 歌曲库
  @Get('songs')
  async listSongs(@Query() q: PaginationDto, @Query('status') status?: string) {
    const data = await this.libs.listSongs(q, status);
    return { code: 0, message: 'ok', data };
  }
  @Get('songs/:id')
  async getSong(@Param('id') id: string) {
    const data = await this.libs.getSong(id);
    return { code: 0, message: 'ok', data };
  }
  @Post('songs')
  async createSong(@Body() dto: CreateSongDto) {
    const data = await this.libs.createSong(dto);
    return { code: 0, message: 'ok', data };
  }
  @Put('songs/:id')
  async updateSong(@Param('id') id: string, @Body() dto: UpdateSongDto) {
    const data = await this.libs.updateSong(id, dto);
    return { code: 0, message: 'ok', data };
  }
  /** 人工审核通过后归档入库 */
  @Post('songs/:id/archive')
  async archiveSong(@Param('id') id: string) {
    const data = await this.libs.archiveSong(id);
    return { code: 0, message: 'ok', data };
  }
  @Delete('songs/:id')
  async deleteSong(@Param('id') id: string) {
    await this.libs.deleteSong(id);
    return { code: 0, message: 'ok', data: null };
  }
  /** 批量导入歌曲 */
  @Post('songs/batch-import')
  async batchImportSongs(@Body() dto: BatchImportSongsDto) {
    const data = await this.libs.batchImportSongs(dto);
    return { code: 0, message: 'ok', data };
  }

  // 提示词库
  @Get('prompts')
  async listPrompts(@Query() q: PaginationDto) {
    const data = await this.libs.listPrompts(q);
    return { code: 0, message: 'ok', data };
  }
  @Get('prompts/:id')
  async getPrompt(@Param('id') id: string) {
    const data = await this.libs.getPrompt(id);
    return { code: 0, message: 'ok', data };
  }
  @Post('prompts')
  async createPrompt(@Body() dto: CreatePromptDto) {
    const data = await this.libs.createPrompt(dto);
    return { code: 0, message: 'ok', data };
  }
  @Put('prompts/:id')
  async updatePrompt(@Param('id') id: string, @Body() dto: UpdatePromptDto) {
    const data = await this.libs.updatePrompt(id, dto);
    return { code: 0, message: 'ok', data };
  }
  @Delete('prompts/:id')
  async deletePrompt(@Param('id') id: string) {
    await this.libs.deletePrompt(id);
    return { code: 0, message: 'ok', data: null };
  }
  /** 批量导入提示词 */
  @Post('prompts/batch-import')
  async batchImportPrompts(
    @Body() dto: BatchImportPromptsDto,
    @CurrentUser() user: AuthUser,
  ) {
    const data = await this.libs.batchImportPrompts(dto, user);
    return { code: 0, message: 'ok', data };
  }
  /** 调用 AI 对指定提示词智能分类（生成分类 + 标签） */
  @Post('prompts/:id/classify')
  async classifyPrompt(@Param('id') id: string) {
    const data = await this.libs.classifyPrompt(id);
    return { code: 0, message: 'ok', data };
  }

  // 标签
  @Get('tags/:type')
  async listTags(@Param('type') type: string) {
    const data = await this.libs.listTags(type);
    return { code: 0, message: 'ok', data };
  }
  @Post('tags/:type')
  async ensureTag(@Param('type') type: string, @Body('name') name: string) {
    const data = await this.libs.ensureTag(type, name);
    return { code: 0, message: 'ok', data };
  }
}
