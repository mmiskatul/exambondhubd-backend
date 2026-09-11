import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PortalsService } from '../portals/portals.service';

@Injectable()
export class ExamsService {
  constructor(
    private prisma: PrismaService,
    private portals: PortalsService,
  ) {}

  async findAll(query: {
    categoryId?: string;
    portalKey?: string;
    unitKey?: string;
    isPremium?: boolean;
    search?: string;
    isPublished?: boolean;
  }) {
    // Student-generated custom tests live here too, but they're private to
    // whoever created them — never surfaced through browsing or admin lists.
    const where: any = { isCustom: false };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.portalKey) {
      const portal = await this.portals.resolveByKey(query.portalKey);
      where.portalId = portal.id;

      const unit = await this.portals.resolveUnit(portal.id, query.unitKey);
      if (unit) where.unitId = unit.id;
    }
    if (typeof query.isPremium === 'boolean') where.isPremium = query.isPremium;
    if (typeof query.isPublished === 'boolean') where.isPublished = query.isPublished;
    if (query.search) {
      where.OR = [
        { titleEn: { contains: query.search, mode: 'insensitive' } },
        { titleBn: { contains: query.search } },
      ];
    }

    return this.prisma.exam.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        portal: { select: { id: true, key: true, titleEn: true } },
        unit: { select: { id: true, key: true, titleEn: true, titleBn: true } },
        blueprint: {
          include: {
            items: {
              include: { subject: true, topic: true },
            },
          },
        },
        _count: {
          select: { questions: true, attempts: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: {
        category: true,
        blueprint: {
          include: {
            items: {
              include: { subject: true, topic: true },
            },
          },
        },
        _count: {
          select: { questions: true, attempts: true },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID ${id} not found`);
    }

    return exam;
  }

  /**
   * Everything the App Portals Hub and the mobile portal screen need for one
   * portal. Scoping is a plain `portalId` foreign key match, so a question
   * added under DU is only ever counted, listed or deleted under DU.
   */
  async getPortalDetails(key: string, unitKey?: string) {
    const portal = await this.portals.resolveByKey(key);

    // A unit narrows every figure below to that unit alone. Without one the
    // response covers the whole portal, units included.
    const unit = await this.portals.resolveUnit(portal.id, unitKey);
    const questionScope = unit
      ? { portalId: portal.id, unitId: unit.id }
      : { portalId: portal.id };

    const [units, exams, years, subjects] = await Promise.all([
      this.portals.buildUnits(portal.id),
      this.prisma.exam.findMany({
        where: unit ? { portalId: portal.id, unitId: unit.id } : { portalId: portal.id },
        include: {
          category: true,
          unit: { select: { id: true, key: true, titleEn: true, titleBn: true } },
          blueprint: { include: { items: { include: { subject: true } } } },
          _count: { select: { questions: true, attempts: true } },
        },
        orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
      }),
      this.portals.buildYears(portal.id, unit?.id ?? null),
      this.portals.buildSubjects(portal.id, unit?.id ?? null),
    ]);

    const examIds = exams.map((e) => e.id);

    const [totalQuestions, totalAttempts, recentSubmissions, uniqueUsers, scoreAgg, passedCount] =
      await Promise.all([
        this.prisma.question.count({ where: questionScope }),
        examIds.length ? this.prisma.attempt.count({ where: { examId: { in: examIds } } }) : 0,
        examIds.length
          ? this.prisma.attempt.findMany({
              where: { examId: { in: examIds } },
              orderBy: { createdAt: 'desc' },
              take: 5,
              include: {
                user: { select: { id: true, name: true, email: true } },
                exam: { select: { titleEn: true } },
              },
            })
          : [],
        examIds.length
          ? this.prisma.attempt.groupBy({ by: ['userId'], where: { examId: { in: examIds } } })
          : [],
        examIds.length
          ? this.prisma.attempt.aggregate({ where: { examId: { in: examIds } }, _avg: { score: true } })
          : { _avg: { score: null } },
        examIds.length
          ? this.prisma.attempt.count({ where: { examId: { in: examIds }, percentage: { gte: 40 } } })
          : 0,
      ]);

    return {
      portal: {
        id: portal.id,
        key: portal.key,
        title: portal.titleEn,
        titleEn: portal.titleEn,
        bn: portal.titleBn,
        titleBn: portal.titleBn,
        icon: portal.icon,
        badge: portal.badge,
        color: portal.color,
        group: portal.group,
        isEnabled: portal.isEnabled,
      },
      units,
      unit: unit
        ? {
            id: unit.id,
            key: unit.key,
            titleEn: unit.titleEn,
            titleBn: unit.titleBn,
            badge: unit.badge,
          }
        : null,
      examKey: portal.key,
      exams,
      stats: {
        enrolledUsers: uniqueUsers.length,
        totalAttempts,
        totalQuestions,
        averageScore: scoreAgg._avg.score ? Number(scoreAgg._avg.score.toFixed(1)) : 0,
        passingRate: totalAttempts > 0 ? Number(((passedCount / totalAttempts) * 100).toFixed(1)) : 0,
      },
      recentSubmissions,
      years,
      subjects,
    };
  }

  async findBySlug(slug: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { slug },
      include: {
        category: true,
        blueprint: {
          include: {
            items: {
              include: { subject: true, topic: true },
            },
          },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${slug}' not found`);
    }

    return exam;
  }

  async create(data: any) {
    const { blueprintItems, portalKey, unitKey, ...examData } = data;

    // A model test always belongs to exactly one portal, and optionally to one
    // admission unit inside it.
    if (portalKey) {
      const portal = await this.portals.resolveByKey(portalKey);
      examData.portalId = portal.id;

      const unit = await this.portals.resolveUnit(portal.id, unitKey);
      await this.portals.requireUnitWhenPresent(portal.id, unit, 'a model test');
      examData.unitId = unit?.id ?? null;
    }

    if (!examData.portalId) {
      throw new BadRequestException(
        'A model test must belong to an exam portal. Pass portalKey or portalId.',
      );
    }

    // Inherit the category from the portal's existing exams when not supplied.
    if (!examData.categoryId) {
      const sibling = await this.prisma.exam.findFirst({
        where: { portalId: examData.portalId },
        select: { categoryId: true },
      });

      if (sibling) {
        examData.categoryId = sibling.categoryId;
      } else {
        const fallback = await this.prisma.category.findFirst({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        });
        if (!fallback) {
          throw new BadRequestException('No exam category exists yet. Create a category first.');
        }
        examData.categoryId = fallback.id;
      }
    }

    // Validate blueprint if provided
    let totalBlueprintQuestions = 0;
    if (blueprintItems && blueprintItems.length > 0) {
      totalBlueprintQuestions = blueprintItems.reduce(
        (sum: number, item: any) => sum + Number(item.questionCount),
        0,
      );
      if (totalBlueprintQuestions !== Number(examData.totalQuestions)) {
        throw new BadRequestException(
          `Blueprint question count sum (${totalBlueprintQuestions}) must match total exam questions (${examData.totalQuestions})`,
        );
      }
    }

    return this.prisma.exam.create({
      data: {
        ...examData,
        blueprint: blueprintItems && blueprintItems.length > 0
          ? {
              create: {
                name: `${examData.titleEn} Blueprint`,
                totalQuestions: totalBlueprintQuestions,
                totalMarks: Number(examData.totalQuestions) * Number(examData.marksPerQuestion || 1),
                items: {
                  create: blueprintItems.map((item: any) => ({
                    subjectId: item.subjectId,
                    topicId: item.topicId || null,
                    questionCount: Number(item.questionCount),
                    marks: Number(item.marks || examData.marksPerQuestion || 1),
                    negativeMarks: Number(item.negativeMarks || examData.negativeMark || 0.25),
                    difficulty: item.difficulty || 'ANY',
                  })),
                },
              },
            }
          : undefined,
      },
      include: {
        category: true,
        blueprint: {
          include: {
            items: {
              include: { subject: true },
            },
          },
        },
      },
    });
  }

  async update(id: string, data: any) {
    const { blueprintItems, portalKey, unitKey, ...examData } = data;

    if (portalKey) {
      const portal = await this.portals.resolveByKey(portalKey);
      examData.portalId = portal.id;

      if (unitKey !== undefined) {
        const unit = await this.portals.resolveUnit(portal.id, unitKey);
        examData.unitId = unit?.id ?? null;
      }
    }

    if (blueprintItems) {
      // Recreate blueprint items
      await this.prisma.examBlueprintItem.deleteMany({
        where: { blueprint: { examId: id } },
      });

      const blueprint = await this.prisma.examBlueprint.upsert({
        where: { examId: id },
        update: {
          totalQuestions: examData.totalQuestions || 100,
          totalMarks: (examData.totalQuestions || 100) * (examData.marksPerQuestion || 1),
        },
        create: {
          examId: id,
          name: `${examData.titleEn || 'Exam'} Blueprint`,
          totalQuestions: examData.totalQuestions || 100,
          totalMarks: (examData.totalQuestions || 100) * (examData.marksPerQuestion || 1),
        },
      });

      for (const item of blueprintItems) {
        await this.prisma.examBlueprintItem.create({
          data: {
            blueprintId: blueprint.id,
            subjectId: item.subjectId,
            topicId: item.topicId || null,
            questionCount: Number(item.questionCount),
            marks: Number(item.marks || 1),
            negativeMarks: Number(item.negativeMarks || 0.25),
            difficulty: item.difficulty || 'ANY',
          },
        });
      }
    }

    return this.prisma.exam.update({
      where: { id },
      data: examData,
      include: {
        category: true,
        blueprint: {
          include: {
            items: {
              include: { subject: true, topic: true },
            },
          },
        },
      },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.exam.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('That model test has already been deleted.');

    // deleteMany reports a count rather than raising P2025 when the row is
    // already gone, so two concurrent deletes cannot fail as a database error.
    const removed = await this.prisma.exam.deleteMany({ where: { id } });
    if (removed.count === 0) {
      throw new NotFoundException('That model test has already been deleted.');
    }

    return existing;
  }
}
