import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getAdminDashboardMetrics() {
    const [
      totalUsers,
      totalExams,
      totalQuestions,
      totalAttempts,
      completedAttempts,
      totalRevenueData,
      popularExams,
      recentAttempts,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.exam.count({ where: { isPublished: true } }),
      this.prisma.question.count(),
      this.prisma.attempt.count(),
      this.prisma.attempt.count({
        where: {
          status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.AUTO_SUBMITTED] },
        },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum: { amount: true },
      }),
      this.prisma.exam.findMany({
        take: 5,
        orderBy: { attempts: { _count: 'desc' } },
        select: {
          id: true,
          titleEn: true,
          titleBn: true,
          _count: { select: { attempts: true } },
        },
      }),
      this.prisma.attempt.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          exam: { select: { id: true, titleEn: true, titleBn: true } },
        },
      }),
    ]);

    const totalRevenue = totalRevenueData._sum.amount || 0;
    const completionRate = totalAttempts > 0 ? ((completedAttempts / totalAttempts) * 100).toFixed(1) : 0;

    // Real Question Difficulty Distribution
    const difficultyGroups = await this.prisma.question.groupBy({
      by: ['difficulty'],
      _count: { _all: true },
    });

    const difficultyColors: Record<string, string> = {
      EASY: '#10b981',
      MEDIUM: '#3b82f6',
      HARD: '#f59e0b',
    };

    const difficultyDistribution = difficultyGroups.map((g) => ({
      name: `${g.difficulty.charAt(0) + g.difficulty.slice(1).toLowerCase()} Questions`,
      value: g._count._all,
      color: difficultyColors[g.difficulty] || '#64748b',
    }));

    // Real Subject-Wise Distribution
    const subjects = await this.prisma.subject.findMany({
      take: 8,
      orderBy: { titleEn: 'asc' },
      select: {
        titleEn: true,
        _count: { select: { questions: true } },
      },
    });

    const subjectPerformance = subjects.map((s) => ({
      subject: s.titleEn.split(' ')[0],
      questions: s._count.questions,
    }));

    // Real Monthly Trends (Last 6 Months from real data)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const monthlyTrends = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthLabel = monthNames[d.getMonth()];

      const [monthAttempts, monthUsers, monthRevenueData] = await Promise.all([
        this.prisma.attempt.count({
          where: { createdAt: { gte: d, lt: nextD } },
        }),
        this.prisma.user.count({
          where: { createdAt: { gte: d, lt: nextD } },
        }),
        this.prisma.payment.aggregate({
          where: { status: PaymentStatus.SUCCESS, createdAt: { gte: d, lt: nextD } },
          _sum: { amount: true },
        }),
      ]);

      monthlyTrends.push({
        month: monthLabel,
        attempts: monthAttempts,
        activeUsers: monthUsers,
        revenue: monthRevenueData._sum.amount || 0,
      });
    }

    return {
      kpis: {
        totalUsers,
        totalExams,
        totalQuestions,
        totalAttempts,
        completedAttempts,
        completionRate: `${completionRate}%`,
        totalRevenue: `৳${totalRevenue.toLocaleString()}`,
      },
      popularExams: popularExams.map((e) => ({
        id: e.id,
        name: e.titleEn,
        attempts: e._count.attempts,
      })),
      recentAttempts,
      difficultyDistribution,
      subjectPerformance,
      monthlyTrends,
    };
  }

  /**
   * Registrations per day plus the running total, for the console's growth
   * chart. Days with no signups are filled in so the line has no gaps.
   */
  async getUserGrowth(days = 30) {
    const span = Math.min(Math.max(Number(days) || 30, 7), 365);

    // Anchor and bucket in UTC. Anchoring at local midnight while keying the
    // buckets by toISOString (UTC) put every bucket a day behind in any
    // positive offset, so today's signups fell outside the series entirely and
    // the chart read flat.
    const DAY = 24 * 60 * 60 * 1000;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const since = new Date(todayUtc - (span - 1) * DAY);

    const [recent, priorTotal] = await Promise.all([
      this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Everyone who already existed, so the cumulative line starts truthfully
      // rather than from zero.
      this.prisma.user.count({ where: { createdAt: { lt: since } } }),
    ]);

    const perDay = new Map<string, number>();
    for (const u of recent) {
      const key = u.createdAt.toISOString().slice(0, 10);
      perDay.set(key, (perDay.get(key) || 0) + 1);
    }

    const series: { date: string; newUsers: number; totalUsers: number }[] = [];
    let running = priorTotal;

    for (let i = 0; i < span; i++) {
      const key = new Date(since.getTime() + i * DAY).toISOString().slice(0, 10);

      const newUsers = perDay.get(key) || 0;
      running += newUsers;

      series.push({ date: key, newUsers, totalUsers: running });
    }

    return {
      days: span,
      startedFrom: priorTotal,
      newInPeriod: recent.length,
      totalUsers: running,
      series,
    };
  }
}
