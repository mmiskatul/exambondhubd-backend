import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookmarksService } from './bookmarks.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Bookmarks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('bookmarks')
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Get()
  @ApiOperation({ summary: 'Get all questions bookmarked by the user' })
  async getBookmarks(@CurrentUser('id') userId: string) {
    return this.bookmarksService.getUserBookmarks(userId);
  }

  @Post('toggle')
  @ApiOperation({ summary: 'Toggle bookmark status on a question' })
  async toggleBookmark(@CurrentUser('id') userId: string, @Body() body: { questionId: string }) {
    return this.bookmarksService.toggleBookmark(userId, body.questionId);
  }
}
