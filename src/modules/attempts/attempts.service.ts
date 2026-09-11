import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptStatus, QuestionStatus, UserRole, Prisma } from '@prisma/client';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ExamsService } from '../exams/exams.service';

const STAFF_ROLES: string[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.QUESTION_EDITOR,
  UserRole.QUESTION_REVIEWER,
];

const CUSTOM_EXAM_MIN_QUESTIONS = 5;
const CUSTOM_EXAM_MAX_QUESTIONS = 100;
const SECONDS_PER_QUESTION = 72; // 1.2 min/question — matches the pacing of staff-authored mock tests

// Options for a live, still-in-progress attempt — the correct answer stays
// hidden until submission. Shared by every read of an ungraded attempt so
// there's exactly one place that decides what "hidden" means.
const LIVE_OPTION_SELECT = {
  id: true,
  optionKey: true,
  textEn: true,
  textBn: true,
  image: true,
} as const;

@Injectable()
export class AttemptsService {
  constructor(
    private prisma: PrismaService,
    private subscriptions: SubscriptionsService,
    private exams: ExamsService,
  ) {}

  /**
   * "Build Your Own Test" — a student picks subjects (optionally narrowed to
   * specific chapters within each) and a question count; this assembles a
   * throwaway, private Exam + blueprint from that and immediately starts an
   * attempt against it, reusing the exact same random-selection, timing, and
   * scoring engine as a staff-authored mock test. No question is ever
   * hand-pickable — only the scope (subject/chapter) and count are.
   */
  async startCustomExam(
    userId: string,
    role: string | undefined,
    dto: {
      portalKey: string;
      unitKey?: string;
      subjects: { subjectId: string; topicIds?: string[] }[];
      questionCount: number;
      marksPerQuestion?: number;
      negativeMark?: number;
    },
  ) {
    if (!dto.subjects?.length) {
      throw new BadRequestException('Pick at least one subject.');
    }

    const questionCount = Math.round(Number(dto.questionCount));
    if (
      !Number.isFinite(questionCount) ||
      questionCount < CUSTOM_EXAM_MIN_QUESTIONS ||
      questionCount > CUSTOM_EXAM_MAX_QUESTIONS
    ) {
      throw new BadRequestException(
        `Choose between ${CUSTOM_EXAM_MIN_QUESTIONS} and ${CUSTOM_EXAM_MAX_QUESTIONS} questions.`,
      );
    }

    const marksPerQuestion = Number(dto.marksPerQuestion) > 0 ? Number(dto.marksPerQuestion) : 1;
    const negativeMark = Number(dto.negativeMark) >= 0 ? Number(dto.negativeMark) : 0.25;

    // Confirm every selected subject actually belongs to the stated
    // portal/unit — a student can't smuggle in a subject from elsewhere.
    const subjectIds = dto.subjects.map((s) => s.subjectId);
    const subjects = await this.prisma.subject.findMany({
      where: { id: { in: subjectIds } },
      include: { unit: { select: { key: true } }, topics: { select: { id: true } } },
    });
    if (subjects.length !== subjectIds.length) {
      throw new BadRequestException('One of the selected subjects no longer exists.');
    }

    const portal = await this.prisma.portal.findFirst({
      where: { key: { equals: dto.portalKey, mode: 'insensitive' } },
    });
    if (!portal) throw new NotFoundException('Exam portal not found.');

    const unitKeyNormalised = dto.unitKey?.trim() || null;
    for (const subject of subjects) {
      if (subject.portalId !== portal.id || (subject.unit?.key || null) !== unitKeyNormalised) {
        throw new BadRequestException(
          'All selected subjects must belong to the same portal and unit.',
        );
      }
    }

    // Distribute the requested question count evenly across subjects, and
    // within a subject across its chosen chapters (if any were picked).
    const blueprintItems: {
      subjectId: string;
      topicId?: string | null;
      questionCount: number;
      marks: number;
      negativeMarks: number;
    }[] = [];

    const perSubject = Math.floor(questionCount / dto.subjects.length);
    let remainder = questionCount - perSubject * dto.subjects.length;

    for (const sel of dto.subjects) {
      const subject = subjects.find((s) => s.id === sel.subjectId)!;
      const validTopicIds = new Set(subject.topics.map((t) => t.id));
      const topicIds = (sel.topicIds || []).filter((id) => validTopicIds.has(id));

      const subjectShare = perSubject + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;

      if (topicIds.length === 0) {
        blueprintItems.push({
          subjectId: sel.subjectId,
          topicId: null,
          questionCount: subjectShare,
          marks: marksPerQuestion,
          negativeMarks: negativeMark,
        });
      } else {
        const perTopic = Math.floor(subjectShare / topicIds.length);
        let topicRemainder = subjectShare - perTopic * topicIds.length;
        for (const topicId of topicIds) {
          const topicShare = perTopic + (topicRemainder > 0 ? 1 : 0);
          if (topicRemainder > 0) topicRemainder--;
          if (topicShare <= 0) continue;
          blueprintItems.push({
            subjectId: sel.subjectId,
            topicId,
            questionCount: topicShare,
            marks: marksPerQuestion,
            negativeMarks: negativeMark,
          });
        }
      }
    }

    const totalQuestions = blueprintItems.reduce((sum, i) => sum + i.questionCount, 0);
    const now = Date.now();

    const exam = await this.exams.create({
      portalKey: dto.portalKey,
      unitKey: dto.unitKey,
      titleEn: 'Custom Practice Test',
      titleBn: 'কাস্টম প্র্যাকটিস টেস্ট',
      slug: `custom-${userId.slice(0, 8)}-${now}`,
      durationMinutes: Math.max(5, Math.round((totalQuestions * SECONDS_PER_QUESTION) / 60)),
      totalQuestions,
      marksPerQuestion,
      negativeMark,
      isPublished: true,
      isCustom: true,
      createdByUserId: userId,
      blueprintItems,
    });

    // startExam re-checks subscription access against this exam's own
    // portal/unit, so a student can't use this to reach content they
    // haven't actually bought — same gate as every other exam.
    return this.startExam(userId, exam.id, role);
  }

  // 1. Start Exam / Create Attempt
  async startExam(userId: string, examId: string, role?: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        blueprint: {
          include: {
            items: true,
          },
        },
        portal: { select: { key: true } },
        unit: { select: { key: true } },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID ${examId} not found`);
    }

    if (!exam.isPublished) {
      throw new BadRequestException('This examination is currently unpublished');
    }

    // Timed mock exams are sold exactly like practice content — the same
    // per-portal/unit package unlocks both. Staff previewing/testing a
    // blueprint is exempt.
    if (!role || !STAFF_ROLES.includes(role)) {
      if (!exam.portal) {
        const access = await this.subscriptions.getMyAccess(userId);
        if (!access.platformWide) {
          throw new ForbiddenException({
            error: 'SUBSCRIPTION_REQUIRED',
            message: 'A package is needed to take this exam.',
          });
        }
      } else {
        const { allowed } = await this.subscriptions.canAccess(
          userId,
          exam.portal.key,
          exam.unit?.key,
        );
        if (!allowed) {
          throw new ForbiddenException({
            error: 'SUBSCRIPTION_REQUIRED',
            message: 'A package is needed to take this exam.',
            details: { portalKey: exam.portal.key, unitKey: exam.unit?.key },
          });
        }
      }
    }

    // Check for existing active attempt (Resume functionality)
    const existingAttempt = await this.prisma.attempt.findFirst({
      where: {
        userId,
        examId,
        status: AttemptStatus.IN_PROGRESS,
      },
      include: {
        attemptQuestions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            question: {
              include: {
                subject: true,
                topic: true,
                options: {
                  select: LIVE_OPTION_SELECT,
                  orderBy: { optionKey: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    const now = new Date();

    if (existingAttempt) {
      // Check if active attempt has expired
      if (now >= existingAttempt.expiresAt) {
        await this.autoSubmitAttempt(existingAttempt.id);
      } else {
        // Return existing attempt to resume
        return this.formatAttemptResponse(existingAttempt, exam);
      }
    }

    // Select questions based on dynamic blueprint
    const selectedQuestionIds: string[] = [];

    if (exam.blueprint && exam.blueprint.items.length > 0) {
      for (const item of exam.blueprint.items) {
        const whereClause: any = {
          subjectId: item.subjectId,
          status: QuestionStatus.PUBLISHED,
        };

        if (item.topicId) whereClause.topicId = item.topicId;
        if (item.difficulty && item.difficulty !== 'ANY') whereClause.difficulty = item.difficulty;

        const available = await this.prisma.question.findMany({
          where: whereClause,
          select: { id: true },
        });

        // Randomize questions
        const shuffled = available.sort(() => 0.5 - Math.random());
        const picked = shuffled.slice(0, item.questionCount).map((q) => q.id);
        selectedQuestionIds.push(...picked);
      }
    } else {
      // Fallback: Pick random questions for this exam
      const available = await this.prisma.question.findMany({
        where: { examId: exam.id, status: QuestionStatus.PUBLISHED },
        select: { id: true },
      });
      const shuffled = available.sort(() => 0.5 - Math.random());
      selectedQuestionIds.push(...shuffled.slice(0, exam.totalQuestions).map((q) => q.id));
    }

    if (selectedQuestionIds.length === 0) {
      // If no questions in blueprint yet, fetch any published questions
      const anyQuestions = await this.prisma.question.findMany({
        where: { status: QuestionStatus.PUBLISHED },
        take: exam.totalQuestions,
        select: { id: true },
      });
      selectedQuestionIds.push(...anyQuestions.map((q) => q.id));
    }

    // Server-side timing
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + exam.durationMinutes * 60 * 1000);

    const attempt = await this.prisma.attempt.create({
      data: {
        userId,
        examId,
        status: AttemptStatus.IN_PROGRESS,
        startedAt,
        expiresAt,
        totalQuestions: selectedQuestionIds.length,
        maxScore: selectedQuestionIds.length * exam.marksPerQuestion,
        attemptQuestions: {
          create: selectedQuestionIds.map((qId, index) => ({
            questionId: qId,
            orderIndex: index + 1,
          })),
        },
      },
      include: {
        attemptQuestions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            question: {
              include: {
                subject: true,
                topic: true,
                options: {
                  select: LIVE_OPTION_SELECT,
                  orderBy: { optionKey: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    return this.formatAttemptResponse(attempt, exam);
  }

  // 2. Get Active Attempt (for resume/sync)
  async getAttempt(userId: string, attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        attemptQuestions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            question: {
              include: {
                subject: true,
                topic: true,
                options: {
                  select: LIVE_OPTION_SELECT,
                  orderBy: { optionKey: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ID ${attemptId} not found`);
    }

    if (attempt.userId !== userId) {
      throw new ForbiddenException('You do not have access to this exam session');
    }

    // Check expiration
    if (attempt.status === AttemptStatus.IN_PROGRESS && new Date() >= attempt.expiresAt) {
      return this.autoSubmitAttempt(attemptId);
    }

    return this.formatAttemptResponse(attempt, attempt.exam);
  }

  // 3. Auto-save Answer
  async saveAnswer(userId: string, attemptId: string, data: { questionId: string; optionId?: string | null; isFlagged?: boolean }) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt || attempt.userId !== userId) {
      throw new ForbiddenException('Attempt not found or access denied');
    }

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('This exam session is no longer active');
    }

    if (new Date() >= attempt.expiresAt) {
      await this.autoSubmitAttempt(attemptId);
      throw new BadRequestException('Exam time has expired. Your exam has been automatically submitted.');
    }

    const updateData: any = {};
    if (data.optionId !== undefined) {
      updateData.userOptionId = data.optionId;
      updateData.answeredAt = data.optionId ? new Date() : null;
    }
    if (data.isFlagged !== undefined) {
      updateData.isFlagged = data.isFlagged;
    }

    await this.prisma.attemptQuestion.updateMany({
      where: {
        attemptId,
        questionId: data.questionId,
      },
      data: updateData,
    });

    return { success: true, message: 'Answer saved' };
  }

  // 4. Submit Attempt (Manual or Auto)
  async submitExam(userId: string, attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt || attempt.userId !== userId) {
      throw new ForbiddenException('Attempt not found');
    }

    if (attempt.status === AttemptStatus.SUBMITTED || attempt.status === AttemptStatus.AUTO_SUBMITTED) {
      return this.getAttemptResult(userId, attemptId);
    }

    return this.calculateAndFinalizeAttempt(attemptId, AttemptStatus.SUBMITTED);
  }

  async autoSubmitAttempt(attemptId: string) {
    return this.calculateAndFinalizeAttempt(attemptId, AttemptStatus.AUTO_SUBMITTED);
  }

  private async calculateAndFinalizeAttempt(attemptId: string, targetStatus: AttemptStatus) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        attemptQuestions: {
          include: {
            question: {
              include: {
                options: true,
                subject: true,
              },
            },
          },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');

    const completedAt = new Date();
    const timeTakenSeconds = Math.min(
      Math.floor((completedAt.getTime() - attempt.startedAt.getTime()) / 1000),
      attempt.exam.durationMinutes * 60,
    );

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    const subjectMap: Record<string, { total: number; correct: number; wrong: number; unanswered: number }> = {};
    const mistakesToRecord: string[] = [];

    // Everything below only depends on data already loaded above, so instead
    // of awaiting an update per question (a 100-question exam meant ~200
    // sequential round-trips to the database just to submit), every write is
    // queued here and sent together as one transaction at the end.
    const writes: Prisma.PrismaPromise<any>[] = [];

    for (const aq of attempt.attemptQuestions) {
      const correctOption = aq.question.options.find((o) => o.isCorrect);
      const isAnswered = !!aq.userOptionId;
      const isCorrect = isAnswered && correctOption && aq.userOptionId === correctOption.id;

      // Subject stats
      const subId = aq.question.subjectId;
      if (!subjectMap[subId]) {
        subjectMap[subId] = { total: 0, correct: 0, wrong: 0, unanswered: 0 };
      }
      subjectMap[subId].total++;

      if (isAnswered) {
        if (isCorrect) {
          correctCount++;
          subjectMap[subId].correct++;
        } else {
          wrongCount++;
          subjectMap[subId].wrong++;
          mistakesToRecord.push(aq.questionId);
        }
      } else {
        unansweredCount++;
        subjectMap[subId].unanswered++;
      }

      writes.push(
        this.prisma.attemptQuestion.update({
          where: { id: aq.id },
          data: {
            isCorrect: isAnswered ? isCorrect : null,
          },
        }),
      );

      writes.push(
        this.prisma.question.update({
          where: { id: aq.questionId },
          data: {
            timesAttempted: { increment: 1 },
            timesCorrect: isCorrect ? { increment: 1 } : undefined,
            timesWrong: isAnswered && !isCorrect ? { increment: 1 } : undefined,
          },
        }),
      );
    }

    const marksPerQ = attempt.exam.marksPerQuestion || 1.0;
    const negativeMark = attempt.exam.negativeMark || 0.25;

    const negativeMarksApplied = wrongCount * negativeMark;
    const rawScore = correctCount * marksPerQ - negativeMarksApplied;
    const score = Math.max(0, parseFloat(rawScore.toFixed(2)));
    const maxScore = attempt.totalQuestions * marksPerQ;
    const percentage = maxScore > 0 ? parseFloat(((score / maxScore) * 100).toFixed(2)) : 0;
    const accuracy =
      correctCount + wrongCount > 0
        ? parseFloat(((correctCount / (correctCount + wrongCount)) * 100).toFixed(2))
        : 0;

    // Save subject results
    for (const [subId, stats] of Object.entries(subjectMap)) {
      const subAccuracy =
        stats.correct + stats.wrong > 0 ? (stats.correct / (stats.correct + stats.wrong)) * 100 : 0;
      const subScore = stats.correct * marksPerQ - stats.wrong * negativeMark;

      writes.push(
        this.prisma.attemptResultSubject.upsert({
          where: {
            attemptId_subjectId: {
              attemptId,
              subjectId: subId,
            },
          },
          update: {
            totalQuestions: stats.total,
            correctCount: stats.correct,
            wrongCount: stats.wrong,
            unansweredCount: stats.unanswered,
            score: Math.max(0, subScore),
            accuracy: subAccuracy,
          },
          create: {
            attemptId,
            subjectId: subId,
            totalQuestions: stats.total,
            correctCount: stats.correct,
            wrongCount: stats.wrong,
            unansweredCount: stats.unanswered,
            score: Math.max(0, subScore),
            accuracy: subAccuracy,
          },
        }),
      );
    }

    // Save user mistakes for "Practice My Mistakes"
    for (const qId of mistakesToRecord) {
      writes.push(
        this.prisma.userMistake.upsert({
          where: {
            userId_questionId: {
              userId: attempt.userId,
              questionId: qId,
            },
          },
          update: {
            mistakeCount: { increment: 1 },
            lastMistakeAt: new Date(),
          },
          create: {
            userId: attempt.userId,
            questionId: qId,
            mistakeCount: 1,
          },
        }),
      );
    }

    // Finalize attempt
    writes.push(
      this.prisma.attempt.update({
        where: { id: attemptId },
        data: {
          status: targetStatus,
          completedAt,
          score,
          maxScore,
          percentage,
          correctCount,
          wrongCount,
          unansweredCount,
          negativeMarksApplied,
          accuracy,
          timeTakenSeconds,
        },
      }),
    );

    // Update User Profile Aggregated Stats. bestScore needs the current
    // value to take a max, so this one read has to stay outside the batch —
    // the write it produces still joins the same transaction as everything
    // else below.
    const userProfile = await this.prisma.userProfile.findUnique({ where: { userId: attempt.userId } });
    if (userProfile) {
      const newTotalQuestions = userProfile.questionsSolved + correctCount + wrongCount;
      const newCorrect = userProfile.correctAnswers + correctCount;
      const newWrong = userProfile.wrongAnswers + wrongCount;
      const newAccuracy = newTotalQuestions > 0 ? (newCorrect / newTotalQuestions) * 100 : 0;

      writes.push(
        this.prisma.userProfile.update({
          where: { userId: attempt.userId },
          data: {
            totalExams: { increment: 1 },
            completedExams: { increment: 1 },
            questionsSolved: newTotalQuestions,
            correctAnswers: newCorrect,
            wrongAnswers: newWrong,
            accuracy: parseFloat(newAccuracy.toFixed(2)),
            bestScore: Math.max(userProfile.bestScore, score),
            lastActiveDate: new Date(),
          },
        }),
      );
    }

    // Everything queued above lands in the database in one round-trip
    // instead of dozens — and atomically, so a crash mid-submit can no
    // longer leave an exam half-graded.
    await this.prisma.$transaction(writes);

    return this.getAttemptResult(attempt.userId, attemptId);
  }

  // 5. Get Detailed Result & Review
  async getAttemptResult(userId: string, attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        resultSubjects: {
          include: { subject: true },
        },
        attemptQuestions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            question: {
              include: {
                options: { orderBy: { optionKey: 'asc' } },
                bookmarks: { where: { userId } },
              },
            },
          },
        },
      },
    });

    if (!attempt || attempt.userId !== userId) {
      throw new ForbiddenException('Result not found or access denied');
    }

    const isPassed = attempt.exam.passMarks ? attempt.score >= attempt.exam.passMarks : true;

    return {
      attemptId: attempt.id,
      examId: attempt.examId,
      examTitleEn: attempt.exam.titleEn,
      examTitleBn: attempt.exam.titleBn,
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      passMarks: attempt.exam.passMarks,
      isPassed,
      totalQuestions: attempt.totalQuestions,
      correctCount: attempt.correctCount,
      wrongCount: attempt.wrongCount,
      unansweredCount: attempt.unansweredCount,
      negativeMarksApplied: attempt.negativeMarksApplied,
      accuracy: attempt.accuracy,
      timeTakenSeconds: attempt.timeTakenSeconds,
      completedAt: attempt.completedAt,
      subjectBreakdown: attempt.resultSubjects.map((rs) => ({
        subjectId: rs.subjectId,
        subjectNameEn: rs.subject.titleEn,
        subjectNameBn: rs.subject.titleBn,
        totalQuestions: rs.totalQuestions,
        correctCount: rs.correctCount,
        wrongCount: rs.wrongCount,
        unansweredCount: rs.unansweredCount,
        score: rs.score,
        accuracy: rs.accuracy,
      })),
      questionsReview: attempt.attemptQuestions.map((aq) => {
        const correctOpt = aq.question.options.find((o) => o.isCorrect);
        return {
          questionId: aq.questionId,
          orderIndex: aq.orderIndex,
          questionEn: aq.question.questionEn,
          questionBn: aq.question.questionBn,
          questionImage: aq.question.questionImage,
          explanationEn: aq.question.explanationEn,
          explanationBn: aq.question.explanationBn,
          reference: aq.question.reference,
          options: aq.question.options.map((opt) => ({
            id: opt.id,
            optionKey: opt.optionKey,
            textEn: opt.textEn,
            textBn: opt.textBn,
            isCorrect: opt.isCorrect,
          })),
          selectedOptionId: aq.userOptionId,
          correctOptionId: correctOpt?.id || '',
          isCorrect: aq.isCorrect ?? false,
          isBookmarked: aq.question.bookmarks.length > 0,
        };
      }),
    };
  }

  // 6. Practice My Mistakes (create targeted session from mistakes)
  /**
   * A student's own exam history. The app had no way to list past attempts —
   * only to fetch one by id — so the profile and home screens could not show
   * what someone had already sat.
   */
  async listMine(userId: string, query: { page?: number; limit?: number } = {}) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 50);
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.attempt.count({ where: { userId } }),
      this.prisma.attempt.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          exam: {
            select: {
              id: true,
              titleEn: true,
              titleBn: true,
              totalQuestions: true,
              durationMinutes: true,
              portal: { select: { key: true, titleEn: true, titleBn: true } },
              unit: { select: { key: true, titleBn: true } },
            },
          },
        },
      }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async practiceMistakes(userId: string, count = 20) {
    const mistakes = await this.prisma.userMistake.findMany({
      where: { userId },
      orderBy: { mistakeCount: 'desc' },
      take: Number(count),
      include: {
        question: {
          include: {
            subject: true,
            topic: true,
            // isCorrect was omitted here, so a practice session built from
            // mistakes could never mark the right answer.
            options: {
              select: {
                id: true,
                optionKey: true,
                textEn: true,
                textBn: true,
                image: true,
                isCorrect: true,
              },
              orderBy: { optionKey: 'asc' },
            },
          },
        },
      },
    });

    return {
      totalMistakes: mistakes.length,
      questions: mistakes.map((m) => m.question),
    };
  }

  private formatAttemptResponse(attempt: any, exam: any) {
    const now = new Date();
    const remainingSeconds = Math.max(0, Math.floor((attempt.expiresAt.getTime() - now.getTime()) / 1000));

    const answeredCount = attempt.attemptQuestions.filter((q: any) => !!q.userOptionId).length;
    const unansweredCount = attempt.attemptQuestions.length - answeredCount;

    return {
      id: attempt.id,
      userId: attempt.userId,
      examId: attempt.examId,
      exam: {
        id: exam.id,
        titleEn: exam.titleEn,
        titleBn: exam.titleBn,
        durationMinutes: exam.durationMinutes,
        marksPerQuestion: exam.marksPerQuestion,
        negativeMark: exam.negativeMark,
      },
      status: attempt.status,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      remainingSeconds,
      serverTime: now.toISOString(),
      totalQuestions: attempt.totalQuestions,
      answeredCount,
      unansweredCount,
      questions: attempt.attemptQuestions.map((aq: any) => ({
        id: aq.id,
        orderIndex: aq.orderIndex,
        selectedOptionId: aq.userOptionId,
        isFlagged: aq.isFlagged,
        question: {
          id: aq.question.id,
          subjectId: aq.question.subjectId,
          subject: aq.question.subject,
          topicId: aq.question.topicId,
          topic: aq.question.topic,
          questionEn: aq.question.questionEn,
          questionBn: aq.question.questionBn,
          questionImage: aq.question.questionImage,
          options: aq.question.options,
        },
      })),
    };
  }
}
