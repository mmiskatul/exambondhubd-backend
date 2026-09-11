import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('AI Generation Engine')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('questions/:id/variant')
  @ApiOperation({ summary: 'Generate AI Question Variant (creates Draft for review)' })
  async generateVariant(@Param('id') questionId: string) {
    return this.aiService.generateQuestionVariant(questionId);
  }
}
