import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { QuestionsService } from './questions.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DifficultyLevel, QuestionSource, QuestionStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Questions')
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  // Signed in, but no @Roles restriction — any student may browse, subject to
  // the package check inside assertCanBrowse. This is where "what you bought
  // is what you can see" is actually enforced: the questions and their answers
  // live behind this route, not just behind a lock icon in the app.
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: "Get published questions with filters & pagination (requires the caller's own package)" })
  @ApiQuery({ name: 'subjectId', required: false })
  @ApiQuery({ name: 'topicId', required: false })
  @ApiQuery({ name: 'examId', required: false })
  @ApiQuery({ name: 'portalKey', required: false })
  @ApiQuery({ name: 'unitKey', required: false })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'difficulty', required: false, enum: DifficultyLevel })
  @ApiQuery({ name: 'sourceType', required: false, enum: QuestionSource })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Query('subjectId') subjectId?: string,
    @Query('topicId') topicId?: string,
    @Query('examId') examId?: string,
    @Query('portalKey') portalKey?: string,
    @Query('unitKey') unitKey?: string,
    @Query('year') year?: number,
    @Query('difficulty') difficulty?: DifficultyLevel,
    @Query('sourceType') sourceType?: QuestionSource,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    await this.questionsService.assertCanBrowse(userId, role, { portalKey, unitKey, subjectId, topicId });

    return this.questionsService.findAll({
      subjectId,
      topicId,
      examId,
      portalKey,
      unitKey,
      year: year ? Number(year) : undefined,
      difficulty,
      sourceType,
      status: QuestionStatus.PUBLISHED,
      search,
      page,
      limit,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR, UserRole.QUESTION_REVIEWER)
  @ApiBearerAuth()
  @Get('admin/all')
  @ApiOperation({ summary: 'Get all questions across all statuses (Admin/Editor/Reviewer)' })
  async findAllAdmin(@Query() query: any) {
    return this.questionsService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('practice/feed')
  @ApiOperation({ summary: "Shuffled published questions for a practice session (requires the caller's own package)" })
  @ApiQuery({ name: 'portalKey', required: false })
  @ApiQuery({ name: 'unitKey', required: false })
  @ApiQuery({ name: 'subjectId', required: false })
  @ApiQuery({ name: 'topicId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async practiceFeed(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Query('portalKey') portalKey?: string,
    @Query('unitKey') unitKey?: string,
    @Query('subjectId') subjectId?: string,
    @Query('topicId') topicId?: string,
    @Query('difficulty') difficulty?: DifficultyLevel,
    @Query('limit') limit?: number,
  ) {
    await this.questionsService.assertCanBrowse(userId, role, { portalKey, unitKey, subjectId, topicId });

    return this.questionsService.practiceFeed({
      portalKey, unitKey, subjectId, topicId, difficulty, limit,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a new question' })
  async create(@Body() body: any) {
    return this.questionsService.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update question' })
  async update(@Param('id') id: string, @Body() body: any) {
    return this.questionsService.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete('admin/clear-paper')
  @ApiOperation({ summary: 'Delete all questions for a specific exam portal and year' })
  @ApiQuery({ name: 'portalKey', required: true })
  @ApiQuery({ name: 'year', required: true })
  @ApiQuery({ name: 'unitKey', required: false })
  async clearPaper(
    @Query('portalKey') portalKey: string,
    @Query('year') year: string,
    @Query('unitKey') unitKey?: string,
  ) {
    return this.questionsService.clearPaper(portalKey, Number(year), unitKey);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete question' })
  async delete(@Param('id') id: string) {
    return this.questionsService.delete(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_REVIEWER)
  @ApiBearerAuth()
  @Post(':id/review')
  @ApiOperation({ summary: 'Approve, Reject or Publish question in review workflow' })
  async review(
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT' | 'PUBLISH'; notes?: string },
  ) {
    return this.questionsService.reviewQuestion(id, body.action, body.notes);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Post('import/bulk')
  @ApiOperation({ summary: 'Bulk import questions from parsed CSV/Excel rows' })
  async bulkImport(@Body() body: { rows: any[]; portalKey?: string; unitKey?: string }) {
    return this.questionsService.bulkImport(body.rows || [], body.portalKey, body.unitKey);
  }
}
