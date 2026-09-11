import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Help content for the app's profile screen. The app used to ship these as a
 * hardcoded array, so adding an answer meant a new release; they are rows now
 * and the dashboard owns them.
 */
@Injectable()
export class FaqsService {
  constructor(private prisma: PrismaService) {}

  /** What the mobile app reads — published entries only. */
  async findPublished() {
    return this.prisma.faq.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** What the dashboard reads — drafts included. */
  async findAll() {
    return this.prisma.faq.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(data: any) {
    const questionBn = (data.questionBn || '').trim();
    const answerBn = (data.answerBn || '').trim();

    if (!questionBn) throw new BadRequestException('A Bangla question is required.');
    if (!answerBn) throw new BadRequestException('A Bangla answer is required.');

    // New entries land at the end unless a position is given.
    const sortOrder =
      typeof data.sortOrder === 'number'
        ? data.sortOrder
        : await this.prisma.faq.count();

    return this.prisma.faq.create({
      data: {
        questionBn,
        questionEn: data.questionEn?.trim() || null,
        answerBn,
        answerEn: data.answerEn?.trim() || null,
        category: data.category?.trim() || null,
        sortOrder,
        isPublished: data.isPublished !== false,
      },
    });
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.faq.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('That FAQ no longer exists.');

    const patch: any = {};
    if (data.questionBn !== undefined) {
      const v = (data.questionBn || '').trim();
      if (!v) throw new BadRequestException('A Bangla question is required.');
      patch.questionBn = v;
    }
    if (data.answerBn !== undefined) {
      const v = (data.answerBn || '').trim();
      if (!v) throw new BadRequestException('A Bangla answer is required.');
      patch.answerBn = v;
    }
    if (data.questionEn !== undefined) patch.questionEn = data.questionEn?.trim() || null;
    if (data.answerEn !== undefined) patch.answerEn = data.answerEn?.trim() || null;
    if (data.category !== undefined) patch.category = data.category?.trim() || null;
    if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder) || 0;
    if (data.isPublished !== undefined) patch.isPublished = Boolean(data.isPublished);

    return this.prisma.faq.update({ where: { id }, data: patch });
  }

  async remove(id: string) {
    const existing = await this.prisma.faq.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('That FAQ has already been deleted.');

    // deleteMany reports a count rather than raising when the row is already
    // gone, so a double-clicked delete cannot fail as a database error.
    const removed = await this.prisma.faq.deleteMany({ where: { id } });
    if (removed.count === 0) {
      throw new NotFoundException('That FAQ has already been deleted.');
    }

    const message = `Deleted the FAQ '${existing.questionBn.slice(0, 40)}'.`;
    return { success: true, message, data: { message } };
  }

  /** Persists a whole reordering in one go. */
  async reorder(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('Nothing to reorder.');
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.faq.updateMany({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    return this.findAll();
  }
}
