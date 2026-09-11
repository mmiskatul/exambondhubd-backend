import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PortalsService } from '../portals/portals.service';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private portals: PortalsService,
  ) {}

  // Exam portals live in their own table; kept on this route for the
  // existing mobile app and dashboard clients.
  async getPortals() {
    return this.portals.getPortals();
  }

  async updatePortals(data: any) {
    return this.portals.updatePortals(data);
  }

  async findAll(includeExams = false) {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { exams: { where: { isPublished: true } } },
        },
        exams: includeExams
          ? {
              where: { isPublished: true },
              select: {
                id: true,
                titleEn: true,
                titleBn: true,
                slug: true,
                year: true,
                durationMinutes: true,
                totalQuestions: true,
                isPremium: true,
              },
            }
          : false,
      },
    });
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: {
        exams: {
          where: { isPublished: true },
          include: {
            blueprint: {
              include: {
                items: {
                  include: { subject: true },
                },
              },
            },
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category '${slug}' not found`);
    }

    return category;
  }

  async create(data: any) {
    return this.prisma.category.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.category.update({ where: { id }, data });
  }

  async delete(id: string) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('That category has already been deleted.');

    // deleteMany reports a count rather than raising P2025 when the row is
    // already gone, so two concurrent deletes cannot fail as a database error.
    const removed = await this.prisma.category.deleteMany({ where: { id } });
    if (removed.count === 0) {
      throw new NotFoundException('That category has already been deleted.');
    }

    return existing;
  }
}
