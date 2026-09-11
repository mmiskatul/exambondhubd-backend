import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { JwtStrategy } from '../auth/jwt.strategy';
import { UserStatus } from '@prisma/client';
import { MailService } from '../mail/mail.service';

// Mirrors auth.service.ts's self-service verification window.
const VERIFY_CODE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private jwtStrategy: JwtStrategy,
    private mailService: MailService,
  ) {}

  /**
   * Every hash on `User` — the login password and the OTP/reset-code hashes
   * added alongside email verification and forgot-password — has no reason
   * to ever leave the server. Nothing here reads them off the response; this
   * just stops them riding along in the JSON.
   */
  private sanitiseUser<T extends Record<string, any>>(user: T): Omit<T,
    | 'password'
    | 'emailVerifyCodeHash'
    | 'emailVerifyExpires'
    | 'emailVerifyAttempts'
    | 'emailVerifySentAt'
    | 'passwordResetCodeHash'
    | 'passwordResetExpires'
    | 'passwordResetAttempts'
    | 'passwordResetSentAt'
  > {
    const {
      password,
      emailVerifyCodeHash,
      emailVerifyExpires,
      emailVerifyAttempts,
      emailVerifySentAt,
      passwordResetCodeHash,
      passwordResetExpires,
      passwordResetAttempts,
      passwordResetSentAt,
      ...safe
    } = user;
    return safe;
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        subscriptions: {
          where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
          include: { plan: true },
          take: 1,
        },
        attempts: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { exam: true },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return this.sanitiseUser(user);
  }

  /** Name, phone, and push preference — email changes would need re-verification, so that stays out of scope here. */
  async updateOwnProfile(
    userId: string,
    dto: { name?: string; phone?: string; pushNotificationsEnabled?: boolean },
  ) {
    const data: { name?: string; phone?: string | null; pushNotificationsEnabled?: boolean } = {};

    if (dto.name !== undefined) {
      const name = String(dto.name || '').trim();
      if (!name) throw new BadRequestException('Name cannot be empty.');
      data.name = name;
    }
    if (dto.phone !== undefined) {
      data.phone = String(dto.phone || '').trim() || null;
    }
    if (dto.pushNotificationsEnabled !== undefined) {
      data.pushNotificationsEnabled = Boolean(dto.pushNotificationsEnabled);
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update.');
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data });
    return { success: true, message: 'Profile updated.', data: { user: this.sanitiseUser(updated) } };
  }

  /**
   * `totalSignups` counts everyone who entered this code at registration;
   * `referrals` only lists the ones who actually paid — that is what
   * `Referral` rows exist for, since the reward is only granted then.
   */
  async getMyReferrals(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [totalSignups, referrals] = await Promise.all([
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        include: { referred: { select: { name: true } } },
      }),
    ]);

    return {
      referralCode: user.referralCode,
      totalSignups,
      rewardedCount: referrals.length,
      totalRewardDays: referrals.reduce((sum, r) => sum + r.rewardDays, 0),
      referrals: referrals.map((r) => ({
        name: r.referred.name,
        joinedAt: r.createdAt,
        rewardDays: r.rewardDays,
      })),
    };
  }

  /**
   * A student deleting their own account, as opposed to `deleteUser` above
   * which is the admin-console action and explicitly forbids acting on
   * yourself — here that is the only case there is. A Google-only account
   * has no password to check, so the confirmation is the request itself.
   */
  async deleteOwnAccount(userId: string, password?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.password) {
      const ok = await bcrypt.compare(String(password || ''), user.password);
      if (!ok) throw new BadRequestException('Incorrect password.');
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      const supers = await this.prisma.user.count({ where: { role: UserRole.SUPER_ADMIN } });
      if (supers <= 1) {
        throw new BadRequestException(
          'This is the only super admin. Promote another account before deleting this one.',
        );
      }
    }

    this.jwtStrategy.invalidate(userId);
    await this.prisma.user.deleteMany({ where: { id: userId } });

    const message = 'Your account and everything on it have been deleted.';
    return { success: true, message, data: { message } };
  }

  async getAllUsers(query: {
    search?: string;
    role?: any;
    group?: 'students' | 'staff' | 'all';
    includeTemporary?: boolean;
    status?: UserStatus;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.role) where.role = query.role;

    // Examinees and staff are different audiences: exam stats mean nothing for
    // an admin account, and an admin in the student list is just noise.
    if (!query.role) {
      if (query.group === 'students') where.role = UserRole.USER;
      else if (query.group === 'staff') where.role = { not: UserRole.USER };
    }

    // Temporary passes have their own panel on the API & Access page, so they
    // are kept out of the permanent account lists.
    if (!query.includeTemporary) where.isTemporary = false;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          profile: true,
          subscriptions: {
            where: { status: 'ACTIVE' },
            include: { plan: true },
            take: 1,
          },
        },
      }),
    ]);

    return {
      items: items.map((u) => this.sanitiseUser(u)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateUserStatus(id: string, status: UserStatus, actingUserId?: string) {
    // Suspending yourself would lock you straight out of the console.
    if (actingUserId && actingUserId === id && status === UserStatus.SUSPENDED) {
      throw new BadRequestException('You cannot suspend your own account.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!target) throw new NotFoundException('That user no longer exists.');

    // Drop the cached status so the change takes effect on the very next
    // request instead of waiting out the cache window.
    this.jwtStrategy.invalidate(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status },
    });

    const who = target.name || target.email;
    const message =
      status === UserStatus.SUSPENDED
        ? `${who} has been suspended and signed out.`
        : `${who} has been reactivated.`;

    return { success: true, message, data: { message, user: this.sanitiseUser(updated) } };
  }

  /**
   * A student who never got (or lost) their verification email otherwise has
   * no way in — this lets staff unblock them by hand instead of forcing a
   * re-registration.
   */
  async adminVerifyEmail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, emailVerified: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const who = user.name || user.email;
    if (user.emailVerified) {
      const message = `${who} is already verified.`;
      return { success: true, message, data: { message } };
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        emailVerified: true,
        emailVerifyCodeHash: null,
        emailVerifyExpires: null,
        emailVerifyAttempts: 0,
      },
    });
    this.jwtStrategy.invalidate(id);

    const message = `${who} has been manually verified and can now sign in.`;
    return { success: true, message, data: { message } };
  }

  /**
   * Same email as self-service resend, but staff-triggered — so it bypasses
   * the 60s cooldown that exists only to stop a student from spamming
   * themselves.
   */
  async adminResendVerification(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerified) {
      throw new BadRequestException('This account is already verified.');
    }

    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    await this.prisma.user.update({
      where: { id },
      data: {
        emailVerifyCodeHash: await bcrypt.hash(code, 10),
        emailVerifyExpires: new Date(Date.now() + VERIFY_CODE_TTL_MS),
        emailVerifySentAt: new Date(),
        emailVerifyAttempts: 0,
      },
    });

    const { sent } = await this.mailService.sendVerificationEmail(user.email, user.name, code);
    const message = sent
      ? `A new verification code was sent to ${user.email}.`
      : 'Could not send the email right now — please try again shortly.';
    return { success: true, message, data: { message, email: user.email } };
  }

  /**
   * Everything the console shows on one student: who they are, what they have
   * paid for, every test they have sat and how they did, plus a per-exam
   * breakdown. The list view only carried aggregate counters.
   */
  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { plan: { select: { nameEn: true, code: true } } },
        },
        _count: {
          select: {
            attempts: true,
            bookmarks: true,
            mistakes: true,
            reports: true,
            payments: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('That user no longer exists.');

    const attempts = await this.prisma.attempt.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        exam: {
          select: {
            id: true,
            titleEn: true,
            titleBn: true,
            totalQuestions: true,
            portal: { select: { key: true, titleEn: true } },
            unit: { select: { key: true, titleBn: true } },
          },
        },
      },
    });

    // How many times they sat each exam, and how they trended on it.
    const byExam = new Map<string, any>();
    for (const a of attempts) {
      const key = a.examId;
      if (!byExam.has(key)) {
        byExam.set(key, {
          examId: key,
          titleEn: a.exam?.titleEn || 'Deleted exam',
          titleBn: a.exam?.titleBn || '',
          portal: a.exam?.portal?.titleEn || null,
          unit: a.exam?.unit?.titleBn || null,
          attempts: 0,
          bestPercentage: 0,
          lastPercentage: null as number | null,
          lastAttemptAt: null as Date | null,
        });
      }

      const row = byExam.get(key);
      row.attempts += 1;
      row.bestPercentage = Math.max(row.bestPercentage, a.percentage || 0);

      // attempts are newest first, so the first one seen is the latest.
      if (row.lastAttemptAt === null) {
        row.lastPercentage = a.percentage || 0;
        row.lastAttemptAt = a.completedAt || a.createdAt;
      }
    }

    const completed = attempts.filter((a) => a.completedAt);
    const averagePercentage = completed.length
      ? completed.reduce((sum, a) => sum + (a.percentage || 0), 0) / completed.length
      : 0;

    // Where they are weakest, straight from the recorded mistakes.
    const mistakeRows = await this.prisma.userMistake.findMany({
      where: { userId: id },
      include: { question: { select: { subject: { select: { titleEn: true } } } } },
    });

    const weakBySubject = new Map<string, number>();
    for (const m of mistakeRows) {
      const name = m.question?.subject?.titleEn;
      if (!name) continue;
      weakBySubject.set(name, (weakBySubject.get(name) || 0) + (m.mistakeCount || 1));
    }

    const safeUser = this.sanitiseUser(user as any);

    return {
      user: safeUser,
      activity: {
        totalAttempts: user._count.attempts,
        completedAttempts: completed.length,
        inProgressAttempts: attempts.length - completed.length,
        averagePercentage: Number(averagePercentage.toFixed(1)),
        bookmarks: user._count.bookmarks,
        mistakes: user._count.mistakes,
        reportsFiled: user._count.reports,
      },
      examBreakdown: Array.from(byExam.values()),
      attempts,
      weakSubjects: Array.from(weakBySubject.entries())
        .map(([subject, wrong]) => ({ subject, wrong }))
        .sort((a, b) => b.wrong - a.wrong)
        .slice(0, 8),
    };
  }

  /**
   * Removes an account and everything hanging off it. Attempts, bookmarks,
   * mistakes, subscriptions and payments cascade; audit entries keep their row
   * with a null author so the trail survives the account.
   */
  async deleteUser(id: string, actingUserId?: string) {
    if (actingUserId && actingUserId === id) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!target) throw new NotFoundException('That user has already been deleted.');

    // Never leave the console without an owner.
    if (target.role === UserRole.SUPER_ADMIN) {
      const supers = await this.prisma.user.count({ where: { role: UserRole.SUPER_ADMIN } });
      if (supers <= 1) {
        throw new BadRequestException(
          'This is the only super admin. Promote another account before deleting this one.',
        );
      }
    }

    // Signs them out immediately rather than leaving a cached token valid.
    this.jwtStrategy.invalidate(id);

    // deleteMany reports a count instead of raising when the row is already
    // gone, so two concurrent deletes cannot fail as a database error.
    const removed = await this.prisma.user.deleteMany({ where: { id } });
    if (removed.count === 0) {
      throw new NotFoundException('That user has already been deleted.');
    }

    const who = target.name || target.email;
    const message = `${who} and all of their activity have been deleted.`;
    return { success: true, message, data: { message, id } };
  }
}
