import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BookmarksService {
  constructor(private prisma: PrismaService) {}

  async getUserBookmarks(userId: string) {
    return this.prisma.bookmark.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        question: {
          include: {
            subject: true,
            topic: true,
            options: { orderBy: { optionKey: 'asc' } },
          },
        },
      },
    });
  }

  async toggleBookmark(userId: string, questionId: string) {
    const existing = await this.prisma.bookmark.findUnique({
      where: {
        userId_questionId: { userId, questionId },
      },
    });

    if (existing) {
      // deleteMany: a double-tapped bookmark sends two toggles, and delete()
      // would raise P2025 on whichever one loses.
      await this.prisma.bookmark.deleteMany({ where: { id: existing.id } });
      return { isBookmarked: false, message: 'Question removed from bookmarks' };
    } else {
      await this.prisma.bookmark.create({
        data: { userId, questionId },
      });
      return { isBookmarked: true, message: 'Question bookmarked' };
    }
  }
}
