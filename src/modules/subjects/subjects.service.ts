import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SubjectsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Every subject belongs to one exam portal (and one unit inside it), so this
   * returns them grouped with their owner rather than as a global catalogue.
   */
  async findAll(portalKey?: string) {
    return this.prisma.subject.findMany({
      where: portalKey ? { portal: { key: { equals: portalKey, mode: 'insensitive' } } } : {},
      orderBy: [{ portalId: 'asc' }, { sortOrder: 'asc' }, { titleEn: 'asc' }],
      include: {
        portal: { select: { id: true, key: true, titleEn: true, titleBn: true, icon: true } },
        unit: { select: { id: true, key: true, titleEn: true, titleBn: true } },
        topics: {
          orderBy: { titleEn: 'asc' },
          include: { _count: { select: { questions: true } } },
        },
        _count: { select: { questions: true, blueprintItems: true } },
      },
    });
  }

  async findOne(id: string) {
    const subject = await this.prisma.subject.findUnique({
      where: { id },
      include: {
        topics: {
          orderBy: { titleEn: 'asc' },
          include: { _count: { select: { questions: true } } },
        },
        portal: { select: { id: true, key: true, titleEn: true } },
        unit: { select: { id: true, key: true, titleEn: true, titleBn: true } },
        _count: { select: { questions: true } },
      },
    });

    if (!subject) {
      throw new NotFoundException(`Subject ID ${id} not found`);
    }

    return subject;
  }

  /**
   * Subjects are always created against an exam portal, so this route is gone.
   * Use POST /portals/:key/subjects instead.
   */
  async createSubject(): Promise<never> {
    throw new BadRequestException(
      'Subjects belong to an exam portal. Create one from the App Portals Hub, ' +
        'or POST /portals/:key/subjects with the exam and unit it belongs to.',
    );
  }

  async updateSubject(id: string, data: any) {
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException(`Subject ID ${id} not found`);

    const {
      code,
      id: _ignored,
      topics,
      portal,
      unit,
      portalId,
      unitId,
      unitScope,
      _count,
      stats,
      ...rest
    } = data;

    // Codes only have to be unique inside this subject's own exam + unit.
    if (code && String(code).toUpperCase() !== subject.code) {
      const nextCode = String(code).toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
      const clash = await this.prisma.subject.findFirst({
        where: {
          portalId: subject.portalId,
          unitScope: subject.unitScope,
          code: nextCode,
          id: { not: id },
        },
      });
      if (clash) {
        throw new BadRequestException(
          `This exam already has a subject with the code '${nextCode}'.`,
        );
      }
      rest.code = nextCode;
    }

    return this.prisma.subject.update({
      where: { id },
      data: rest,
      include: {
        topics: { orderBy: { titleEn: 'asc' } },
        _count: { select: { questions: true } },
      },
    });
  }

  /**
   * Deleting a subject cascades to every question filed under it, so it is
   * refused while any exist unless the caller explicitly opts in.
   */
  async deleteSubject(id: string, force = false) {
    const subject = await this.prisma.subject.findUnique({
      where: { id },
      include: {
        _count: { select: { questions: true, blueprintItems: true } },
        portal: { select: { titleEn: true } },
        unit: { select: { titleBn: true } },
      },
    });

    if (!subject) throw new NotFoundException(`Subject ID ${id} not found`);

    const questionCount = subject._count.questions;
    const owner = subject.portal
      ? `${subject.portal.titleEn}${subject.unit ? ` ${subject.unit.titleBn}` : ''}`
      : 'this exam';

    if (questionCount > 0 && !force) {
      throw new BadRequestException(
        `'${subject.titleEn}' still holds ${questionCount} question(s) in ${owner}. ` +
          'Delete those questions first, or confirm a forced delete.',
      );
    }

    if (subject._count.blueprintItems > 0 && !force) {
      throw new BadRequestException(
        `'${subject.titleEn}' is used by ${subject._count.blueprintItems} model test blueprint item(s). Remove it from those blueprints first.`,
      );
    }

    // deleteMany reports a count rather than raising P2025 when the row is
    // already gone, so two concurrent deletes cannot fail as a database error.
    const removed = await this.prisma.subject.deleteMany({ where: { id } });
    if (removed.count === 0) {
      throw new NotFoundException('That subject has already been deleted.');
    }

    const message =
      `Deleted subject '${subject.titleEn}'` +
      (questionCount > 0 ? ` along with ${questionCount} question(s).` : '.');

    return {
      success: true,
      message,
      data: { message, deletedQuestions: questionCount },
    };
  }

  // ---------------- Topic (chapter) operations ----------------

  async createTopic(subjectId: string, data: { titleEn: string; titleBn: string }) {
    const subject = await this.prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new NotFoundException(`Subject ID ${subjectId} not found`);

    if (!data.titleEn?.trim()) {
      throw new BadRequestException('A chapter title is required.');
    }

    const existing = await this.prisma.topic.findFirst({
      where: { subjectId, titleEn: data.titleEn.trim() },
    });

    if (existing) {
      throw new BadRequestException(
        `'${subject.titleEn}' already has a chapter called '${data.titleEn.trim()}'.`,
      );
    }

    return this.prisma.topic.create({
      data: {
        subjectId,
        titleEn: data.titleEn.trim(),
        titleBn: (data.titleBn || data.titleEn).trim(),
      },
      include: { _count: { select: { questions: true } } },
    });
  }

  async updateTopic(topicId: string, data: any) {
    const topic = await this.prisma.topic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException(`Chapter ${topicId} not found`);

    const { id: _ignored, subjectId, _count, ...rest } = data;

    if (rest.titleEn) {
      const clash = await this.prisma.topic.findFirst({
        where: { subjectId: topic.subjectId, titleEn: rest.titleEn.trim(), id: { not: topicId } },
      });
      if (clash) {
        throw new BadRequestException(`That subject already has a chapter called '${rest.titleEn.trim()}'.`);
      }
      rest.titleEn = rest.titleEn.trim();
    }

    return this.prisma.topic.update({
      where: { id: topicId },
      data: rest,
      include: { _count: { select: { questions: true } } },
    });
  }

  /**
   * Questions keep existing when their chapter goes away (the relation is
   * SetNull), so the caller is told exactly how many become unassigned.
   */
  async deleteTopic(topicId: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: { _count: { select: { questions: true, blueprintItems: true } } },
    });

    if (!topic) throw new NotFoundException(`Chapter ${topicId} not found`);

    const affected = topic._count.questions;

    // deleteMany reports a count rather than raising P2025 when the row is
    // already gone, so two concurrent deletes cannot fail as a database error.
    const removed = await this.prisma.topic.deleteMany({ where: { id: topicId } });
    if (removed.count === 0) {
      throw new NotFoundException('That chapter has already been deleted.');
    }

    const message =
      `Deleted chapter '${topic.titleEn}'.` +
      (affected > 0 ? ` ${affected} question(s) are now unassigned but were kept.` : '');

    return {
      success: true,
      message,
      data: { message, unassignedQuestions: affected },
    };
  }
}
