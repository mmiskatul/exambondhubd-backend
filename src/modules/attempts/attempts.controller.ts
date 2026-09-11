import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AttemptsService } from './attempts.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Attempts & Live Exam Engine')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('attempts')
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Post('start')
  @ApiOperation({ summary: 'Start a new exam attempt or resume ongoing session' })
  async startExam(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() body: { examId: string },
  ) {
    return this.attemptsService.startExam(userId, body.examId, role);
  }

  @Post('custom')
  @ApiOperation({ summary: 'Build Your Own Test — generate a private practice exam from chosen subjects/chapters and start it' })
  async startCustomExam(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body()
    body: {
      portalKey: string;
      unitKey?: string;
      subjects: { subjectId: string; topicIds?: string[] }[];
      questionCount: number;
      marksPerQuestion?: number;
      negativeMark?: number;
    },
  ) {
    return this.attemptsService.startCustomExam(userId, role, body);
  }

  @Get()
  @ApiOperation({ summary: 'My exam attempt history' })
  async listMine(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.attemptsService.listMine(userId, { page, limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get current attempt state for live exam / resume' })
  async getAttempt(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.attemptsService.getAttempt(userId, id);
  }

  @Post(':id/answers')
  @ApiOperation({ summary: 'Auto-save question option selection and flag status' })
  async saveAnswer(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { questionId: string; optionId?: string | null; isFlagged?: boolean },
  ) {
    return this.attemptsService.saveAnswer(userId, id, body);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit exam and calculate results' })
  async submitExam(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.attemptsService.submitExam(userId, id);
  }

  @Get(':id/result')
  @ApiOperation({ summary: 'Get full exam results, subject breakdown, and answer solutions' })
  async getResult(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.attemptsService.getAttemptResult(userId, id);
  }

  @Get('practice/mistakes')
  @ApiOperation({ summary: 'Generate Practice My Mistakes session from previously incorrect questions' })
  async practiceMistakes(@CurrentUser('id') userId: string, @Query('count') count?: number) {
    return this.attemptsService.practiceMistakes(userId, count);
  }
}
