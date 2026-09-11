import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DifficultyLevel, OptionKey, QuestionSource, QuestionStatus, QuestionType, UserRole } from '@prisma/client';
import { PortalsService } from '../portals/portals.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import * as crypto from 'crypto';

const STAFF_ROLES: string[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.QUESTION_EDITOR,
  UserRole.QUESTION_REVIEWER,
];

@Injectable()
export class QuestionsService {
  constructor(
    private prisma: PrismaService,
    private portals: PortalsService,
    private subscriptions: SubscriptionsService,
  ) {}

  /**
   * The gate behind /questions and /questions/practice/feed: those two routes
   * hand back full question text, options and the correct answer, so this is
   * where "only what you bought" is actually enforced — not just the app
   * dimming a locked card. Staff bypass it; students need an active package
   * covering whatever the query is scoped to.
   *
   * Only these two public browsing routes call this. findAll() itself stays
   * unguarded because /questions/admin/all reuses it for staff review, where
   * gating by purchase would be nonsensical.
   */
  async assertCanBrowse(
    userId: string | undefined,
    role: string | undefined,
    scope: { portalKey?: string; unitKey?: string; subjectId?: string; topicId?: string },
  ) {
    if (role && STAFF_ROLES.includes(role)) return;

    if (!userId) {
      throw new ForbiddenException({
        error: 'AUTH_REQUIRED',
        message: 'Please sign in to view questions.',
      });
    }

    let portalKey = scope.portalKey;
    let unitKey = scope.unitKey;

    // A subject/topic-scoped request (the app's "Subject-Wise Drill" and
    // practice-by-chapter) carries no portalKey of its own — trace it back to
    // the exam that owns it so the same package check applies.
    if (!portalKey && scope.subjectId) {
      const subject = await this.prisma.subject.findUnique({
        where: { id: scope.subjectId },
        select: { portal: { select: { key: true } }, unit: { select: { key: true } } },
      });
      portalKey = subject?.portal?.key;
      unitKey = subject?.unit?.key;
    } else if (!portalKey && scope.topicId) {
      const topic = await this.prisma.topic.findUnique({
        where: { id: scope.topicId },
        select: { subject: { select: { portal: { select: { key: true } }, unit: { select: { key: true } } } } },
      });
      portalKey = topic?.subject?.portal?.key;
      unitKey = topic?.subject?.unit?.key;
    }

    // No scope at all means "anything in the whole bank" — that requires
    // owning a platform-wide package, not any single exam's.
    if (!portalKey) {
      const access = await this.subscriptions.getMyAccess(userId);
      if (!access.platformWide) {
        throw new ForbiddenException({
          error: 'SUBSCRIPTION_REQUIRED',
          message: 'A package is needed to browse the full question bank.',
        });
      }
      return;
    }

    const { allowed } = await this.subscriptions.canAccess(userId, portalKey, unitKey);
    if (!allowed) {
      throw new ForbiddenException({
        error: 'SUBSCRIPTION_REQUIRED',
        message: 'A package is needed to unlock this exam before you can view its questions.',
        details: { portalKey, unitKey },
      });
    }
  }

  /**
   * Duplicate detection is scoped to one portal + unit + subject, so the same
   * MCQ can legitimately exist in the DU ক unit, the DU ঘ unit and the Medical
   * bank without colliding.
   */
  generateHash(
    text: string,
    subjectId: string,
    portalId?: string | null,
    unitId?: string | null,
  ): string {
    return crypto
      .createHash('sha256')
      .update(`${portalId || 'GLOBAL'}_${unitId || 'NOUNIT'}_${subjectId}_${text.trim().toLowerCase()}`)
      .digest('hex');
  }

  async findAll(query: {
    subjectId?: string;
    topicId?: string;
    examId?: string;
    portalKey?: string;
    unitKey?: string;
    status?: QuestionStatus;
    difficulty?: DifficultyLevel;
    sourceType?: QuestionSource;
    year?: number;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.subjectId) where.subjectId = query.subjectId;
    if (query.topicId) where.topicId = query.topicId;
    if (query.status) where.status = query.status;
    if (query.difficulty) where.difficulty = query.difficulty;
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.year) where.year = Number(query.year);

    // Scoped Portal / Unit / Exam filter — exact foreign keys, never text
    // matching. A unit narrows the portal further (DU ক vs DU ঘ).
    if (query.examId) {
      where.examId = query.examId;
    } else if (query.portalKey) {
      const portal = await this.portals.resolveByKey(query.portalKey);
      where.portalId = portal.id;

      const unit = await this.portals.resolveUnit(portal.id, query.unitKey);
      if (unit) where.unitId = unit.id;
    }

    if (query.search) {
      where.OR = [
        { questionEn: { contains: query.search, mode: 'insensitive' } },
        { questionBn: { contains: query.search } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          subject: true,
          topic: true,
          portal: { select: { id: true, key: true, titleEn: true, titleBn: true } },
          unit: { select: { id: true, key: true, titleEn: true, titleBn: true } },
          options: {
            orderBy: { optionKey: 'asc' },
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * A shuffled practice set. The app's Practice tab had no endpoint behind it —
   * tapping a subject only raised an alert — so this returns published
   * questions for a scope, in random order, ready to answer.
   */
  async practiceFeed(query: {
    portalKey?: string;
    unitKey?: string;
    subjectId?: string;
    topicId?: string;
    difficulty?: DifficultyLevel;
    limit?: number;
  }) {
    const take = Math.min(Number(query.limit) || 20, 100);

    const where: any = { status: QuestionStatus.PUBLISHED };
    if (query.subjectId) where.subjectId = query.subjectId;
    if (query.topicId) where.topicId = query.topicId;
    if (query.difficulty) where.difficulty = query.difficulty;

    if (query.portalKey) {
      const portal = await this.portals.resolveByKey(query.portalKey);
      where.portalId = portal.id;

      const unit = await this.portals.resolveUnit(portal.id, query.unitKey);
      if (unit) where.unitId = unit.id;
    }

    const total = await this.prisma.question.count({ where });
    if (total === 0) return { items: [], total: 0 };

    // Random window, then shuffle within it: gives variety without pulling the
    // whole bank into memory.
    const skip = total > take ? Math.floor(Math.random() * (total - take)) : 0;

    const rows = await this.prisma.question.findMany({
      where,
      skip,
      take,
      include: {
        subject: { select: { id: true, titleEn: true, titleBn: true, code: true } },
        topic: { select: { id: true, titleEn: true, titleBn: true } },
        options: { orderBy: { optionKey: 'asc' } },
      },
    });

    const items = rows
      .map((q) => ({ q, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ q }) => q);

    return { items, total };
  }

  async create(data: {
    subjectId: string;
    topicId?: string;
    examId?: string;
    portalKey?: string;
    unitKey?: string;
    year?: number;
    questionEn: string;
    questionBn?: string;
    questionImage?: string;
    explanationEn?: string;
    explanationBn?: string;
    reference?: string;
    difficulty?: DifficultyLevel;
    questionType?: QuestionType;
    sourceType?: QuestionSource;
    status?: QuestionStatus;
    options: {
      optionKey: OptionKey;
      textEn: string;
      textBn?: string;
      isCorrect: boolean;
      image?: string;
    }[];
  }) {
    // Every question must belong to exactly one portal, and optionally to one
    // admission unit inside it. That pair is what keeps a DU ক unit question
    // out of DU ঘ unit and out of Medical & Dental entirely.
    let portalId: string | null = null;
    let unitId: string | null = null;

    if (data.portalKey) {
      const portal = await this.portals.resolveByKey(data.portalKey);
      portalId = portal.id;

      const unit = await this.portals.resolveUnit(portal.id, data.unitKey);
      unitId = unit?.id ?? null;

      // Only enforced when no exam was given; an exam carries its own scope.
      if (!data.examId) {
        await this.portals.requireUnitWhenPresent(portal.id, unit, 'a question');
      }
    }

    let resolvedExamId = data.examId || null;

    if (resolvedExamId) {
      const exam = await this.prisma.exam.findUnique({
        where: { id: resolvedExamId },
        select: { id: true, portalId: true, unitId: true },
      });

      if (!exam) {
        throw new NotFoundException(`Model test ${resolvedExamId} not found.`);
      }

      // The exam decides the scope, and must not contradict an explicit key.
      if (portalId && exam.portalId && exam.portalId !== portalId) {
        throw new BadRequestException(
          'This model test belongs to a different exam portal.',
        );
      }

      if (unitId && exam.unitId && exam.unitId !== unitId) {
        throw new BadRequestException(
          'This model test belongs to a different admission unit.',
        );
      }

      portalId = exam.portalId || portalId;
      unitId = exam.unitId || unitId;
    }

    if (!portalId) {
      throw new BadRequestException(
        'A question must be filed under an exam portal. Pass portalKey (e.g. "DU") or an examId.',
      );
    }

    if (!data.subjectId) {
      throw new BadRequestException('A subject is required for every question.');
    }

    // The subject itself belongs to one exam + unit, so filing a question is
    // only valid when its subject lives in the same scope.
    const subject = await this.prisma.subject.findUnique({
      where: { id: data.subjectId },
      select: { id: true, titleEn: true, portalId: true, unitScope: true },
    });

    if (!subject) {
      throw new NotFoundException(`Subject ${data.subjectId} not found.`);
    }

    if (subject.portalId !== portalId || subject.unitScope !== (unitId || '')) {
      throw new BadRequestException(
        `'${subject.titleEn}' belongs to a different exam or unit. Pick a subject from this one.`,
      );
    }

    // A year is registered as soon as it is used, so the paper card shows up.
    if (data.year) {
      await this.portals.ensurePortalYear(portalId, unitId, Number(data.year));
    }

    const hash = this.generateHash(data.questionEn, data.subjectId, portalId, unitId);

    const existing = await this.prisma.question.findUnique({ where: { hash } });
    if (existing) {
      throw new BadRequestException(
        'An identical question already exists in this subject for this exam portal and unit.',
      );
    }

    return this.prisma.question.create({
      data: {
        subjectId: data.subjectId,
        topicId: data.topicId || null,
        examId: resolvedExamId,
        portalId,
        unitId,
        year: data.year ? Number(data.year) : null,
        questionEn: data.questionEn,
        questionBn: data.questionBn,
        questionImage: data.questionImage,
        explanationEn: data.explanationEn,
        explanationBn: data.explanationBn,
        reference: data.reference,
        difficulty: data.difficulty || DifficultyLevel.MEDIUM,
        questionType: data.questionType || QuestionType.SINGLE_MCQ,
        sourceType: data.sourceType || QuestionSource.ADMIN_CREATED,
        status: data.status || QuestionStatus.PUBLISHED,
        hash,
        options: {
          create: data.options.map((opt) => ({
            optionKey: opt.optionKey,
            textEn: opt.textEn,
            textBn: opt.textBn,
            isCorrect: opt.isCorrect,
            image: opt.image,
          })),
        },
      },
      include: {
        options: true,
        subject: true,
        portal: { select: { id: true, key: true, titleEn: true } },
        unit: { select: { id: true, key: true, titleEn: true } },
      },
    });
  }

  async update(id: string, data: any) {
    const {
      options,
      portalKey,
      unitKey,
      portal,
      unit,
      subject,
      topic,
      id: _ignored,
      ...questionData
    } = data;

    const current = await this.prisma.question.findUnique({
      where: { id },
      select: { id: true, portalId: true, unitId: true, subjectId: true, questionEn: true },
    });

    if (!current) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }

    // Moving a question between portals or units is allowed, but only explicitly.
    let portalId = current.portalId;
    let unitId = current.unitId;

    if (portalKey) {
      const target = await this.portals.resolveByKey(portalKey);
      portalId = target.id;
      questionData.portalId = target.id;

      // Changing portal invalidates the old unit unless a new one is given.
      if (target.id !== current.portalId) {
        unitId = null;
        questionData.unitId = null;
      }
    }

    if (unitKey !== undefined && portalId) {
      const targetUnit = await this.portals.resolveUnit(portalId, unitKey);
      unitId = targetUnit?.id ?? null;
      questionData.unitId = unitId;
    }

    const unitScope = unitId || '';

    if (questionData.year !== undefined && questionData.year !== null) {
      questionData.year = Number(questionData.year);

      if (portalId) {
        await this.portals.ensurePortalYear(portalId, unitId, questionData.year);
      }
    }

    if (questionData.subjectId && portalId) {
      const nextSubject = await this.prisma.subject.findUnique({
        where: { id: questionData.subjectId },
        select: { titleEn: true, portalId: true, unitScope: true },
      });

      if (!nextSubject) {
        throw new NotFoundException(`Subject ${questionData.subjectId} not found.`);
      }

      if (nextSubject.portalId !== portalId || nextSubject.unitScope !== unitScope) {
        throw new BadRequestException(
          `'${nextSubject.titleEn}' belongs to a different exam or unit.`,
        );
      }
    }

    // Keep the dedupe hash in step with whatever identifies the question.
    const nextSubjectId = questionData.subjectId || current.subjectId;
    const nextText = questionData.questionEn ?? current.questionEn;

    if (
      nextSubjectId !== current.subjectId ||
      nextText !== current.questionEn ||
      portalId !== current.portalId ||
      unitId !== current.unitId
    ) {
      const nextHash = this.generateHash(nextText, nextSubjectId, portalId, unitId);
      const clash = await this.prisma.question.findUnique({ where: { hash: nextHash } });

      if (clash && clash.id !== id) {
        throw new BadRequestException(
          'Another question with identical content already exists in this subject for this portal.',
        );
      }

      questionData.hash = nextHash;
    }

    if (options && options.length > 0) {
      // Re-create options
      await this.prisma.questionOption.deleteMany({ where: { questionId: id } });
      await this.prisma.questionOption.createMany({
        data: options.map((opt: any) => ({
          questionId: id,
          optionKey: opt.optionKey,
          textEn: opt.textEn,
          textBn: opt.textBn,
          isCorrect: Boolean(opt.isCorrect),
          image: opt.image,
        })),
      });
    }

    return this.prisma.question.update({
      where: { id },
      data: questionData,
      include: {
        options: true,
        subject: true,
        portal: { select: { id: true, key: true, titleEn: true } },
        unit: { select: { id: true, key: true, titleEn: true } },
      },
    });
  }

  async delete(id: string) {
    // Captured up front because deleteMany cannot return the row, and callers
    // expect the deleted question back.
    const existing = await this.prisma.question.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(
        'That question no longer exists. It may have already been deleted — refresh the list.',
      );
    }

    // deleteMany, not delete: a double-clicked delete sends two requests that
    // both pass the check above, and delete() raises P2025 on the loser — which
    // rolls back the batch and logs a database error for every statement in it.
    // deleteMany reports a count instead of raising, so the race stays quiet.
    const [, , , , , removed] = await this.prisma.$transaction([
      this.prisma.questionOption.deleteMany({ where: { questionId: id } }),
      this.prisma.attemptQuestion.deleteMany({ where: { questionId: id } }),
      this.prisma.bookmark.deleteMany({ where: { questionId: id } }),
      this.prisma.userMistake.deleteMany({ where: { questionId: id } }),
      this.prisma.questionReport.deleteMany({ where: { questionId: id } }),
      this.prisma.question.deleteMany({ where: { id } }),
    ]);

    if (removed.count === 0) {
      // Another request removed it between the lookup and the transaction.
      throw new NotFoundException(
        'That question no longer exists. It may have already been deleted — refresh the list.',
      );
    }

    return existing;
  }

  // Review Workflow
  async reviewQuestion(id: string, action: 'APPROVE' | 'REJECT' | 'PUBLISH', notes?: string) {
    let newStatus: QuestionStatus;
    if (action === 'APPROVE') newStatus = QuestionStatus.APPROVED;
    else if (action === 'PUBLISH') newStatus = QuestionStatus.PUBLISHED;
    else newStatus = QuestionStatus.REJECTED;

    return this.prisma.question.update({
      where: { id },
      data: {
        status: newStatus,
        rejectionNotes: action === 'REJECT' ? notes : null,
      },
    });
  }

  // Bulk Import Parser & Validator — every imported row is filed under the
  // portal the admin was working in, so a CSV can never land unscoped.
  async bulkImport(rows: any[], portalKey?: string, unitKey?: string) {
    const portal = await this.portals.resolveByKey(portalKey);
    const unit = await this.portals.resolveUnit(portal.id, unitKey);

    await this.portals.requireUnitWhenPresent(portal.id, unit, 'imported questions');

    const unitId = unit?.id ?? null;
    const unitScope = unitId || '';

    let imported = 0;
    let valid = 0;
    let errors: { row: number; reason: string }[] = [];
    let duplicates = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      try {
        if (!row.question || !row.option_a || !row.option_b || !row.option_c || !row.option_d || !row.answer) {
          errors.push({ row: rowNum, reason: 'Missing mandatory question text, options, or answer key' });
          continue;
        }

        // Subjects are per exam + unit, so the lookup is scoped to this import.
        const subject = await this.prisma.subject.findFirst({
          where: {
            portalId: portal.id,
            unitScope,
            OR: [
              { code: { equals: String(row.subject || '').toUpperCase() } },
              { titleEn: { contains: String(row.subject || ''), mode: 'insensitive' } },
            ],
          },
        });

        if (!subject) {
          errors.push({
            row: rowNum,
            reason: `Subject '${row.subject}' does not exist in this exam's syllabus`,
          });
          continue;
        }

        const hash = this.generateHash(row.question, subject.id, portal.id, unitId);
        const existing = await this.prisma.question.findUnique({ where: { hash } });

        if (existing) {
          duplicates++;
          continue;
        }

        const answerKey = String(row.answer).trim().toUpperCase();

        if (row.year) {
          await this.portals.ensurePortalYear(portal.id, unitId, Number(row.year));
        }

        await this.prisma.question.create({
          data: {
            subjectId: subject.id,
            portalId: portal.id,
            unitId,
            year: row.year ? Number(row.year) : null,
            questionEn: row.question,
            questionBn: row.question_bn || null,
            explanationEn: row.explanation || null,
            explanationBn: row.explanation_bn || null,
            difficulty: (row.difficulty?.toUpperCase() as DifficultyLevel) || DifficultyLevel.MEDIUM,
            sourceType: (row.source?.toUpperCase() as QuestionSource) || QuestionSource.ADMIN_CREATED,
            status: QuestionStatus.PENDING_REVIEW,
            hash,
            options: {
              create: [
                { optionKey: OptionKey.A, textEn: row.option_a, textBn: row.option_a_bn || null, isCorrect: answerKey === 'A' },
                { optionKey: OptionKey.B, textEn: row.option_b, textBn: row.option_b_bn || null, isCorrect: answerKey === 'B' },
                { optionKey: OptionKey.C, textEn: row.option_c, textBn: row.option_c_bn || null, isCorrect: answerKey === 'C' },
                { optionKey: OptionKey.D, textEn: row.option_d, textBn: row.option_d_bn || null, isCorrect: answerKey === 'D' },
              ],
            },
          },
        });

        imported++;
        valid++;
      } catch (err: any) {
        errors.push({ row: rowNum, reason: err.message || 'Error importing row' });
      }
    }

    return {
      portalKey: portal.key,
      unitKey: unit?.key ?? null,
      totalRows: rows.length,
      imported,
      valid,
      duplicates,
      errorCount: errors.length,
      errors,
    };
  }

  // Clear / Bulk Delete all questions for a specific Portal and Year
  async clearPaper(portalKey: string, year: number, unitKey?: string) {
    const portal = await this.portals.resolveByKey(portalKey);
    const unit = await this.portals.resolveUnit(portal.id, unitKey);
    const parsedYear = Number(year);
    const scopeName = unit ? `${portal.titleEn} ${unit.titleEn}` : portal.titleEn;

    if (!parsedYear) {
      throw new BadRequestException(`'${year}' is not a valid exam year.`);
    }

    // Exact scope: only this portal (and unit, when given) is touched.
    const matchingQuestions = await this.prisma.question.findMany({
      where: unit
        ? { portalId: portal.id, unitId: unit.id, year: parsedYear }
        : { portalId: portal.id, year: parsedYear },
      select: { id: true },
    });

    const questionIds = matchingQuestions.map((q) => q.id);

    if (questionIds.length === 0) {
      return {
        deletedCount: 0,
        message: `No questions found to delete for ${scopeName} (${parsedYear}).`,
      };
    }

    await this.prisma.$transaction([
      this.prisma.questionOption.deleteMany({ where: { questionId: { in: questionIds } } }),
      this.prisma.attemptQuestion.deleteMany({ where: { questionId: { in: questionIds } } }),
      this.prisma.bookmark.deleteMany({ where: { questionId: { in: questionIds } } }),
      this.prisma.userMistake.deleteMany({ where: { questionId: { in: questionIds } } }),
      this.prisma.questionReport.deleteMany({ where: { questionId: { in: questionIds } } }),
      this.prisma.question.deleteMany({ where: { id: { in: questionIds } } }),
    ]);

    return {
      deletedCount: questionIds.length,
      message: `Deleted all ${questionIds.length} questions for ${scopeName} (${parsedYear} Paper).`,
    };
  }
}
