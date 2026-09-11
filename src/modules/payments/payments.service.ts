import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentStatus, PaymentProvider } from '@prisma/client';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private subscriptionsService: SubscriptionsService,
  ) {}

  // 1. Get Payment Instructions & Numbers from Database SystemSetting
  async getPaymentInstructions() {
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: { in: ['bkash_number', 'nagad_number', 'rocket_number', 'bkash_type', 'nagad_type', 'rocket_type'] },
      },
    });

    const map = new Map(settings.map((s) => [s.key, s.value]));

    // No placeholder numbers: an unconfigured wallet reports itself as such
    // rather than sending a student's money to a made-up number.
    return {
      bkash: {
        number: map.get('bkash_number') || '',
        isConfigured: Boolean(map.get('bkash_number')),
        type: map.get('bkash_type') || 'Personal (Send Money)',
        instructionsBn: 'বিকাশ অ্যাপ থেকে Send Money বা Payment করুন এবং Transaction ID দিন।',
      },
      nagad: {
        number: map.get('nagad_number') || '',
        isConfigured: Boolean(map.get('nagad_number')),
        type: map.get('nagad_type') || 'Personal (Send Money)',
        instructionsBn: 'নগদ অ্যাপ থেকে Send Money করুন এবং Transaction ID দিন।',
      },
      rocket: {
        number: map.get('rocket_number') || '',
        isConfigured: Boolean(map.get('rocket_number')),
        type: map.get('rocket_type') || 'Personal (Send Money)',
        instructionsBn: 'রকেট অ্যাপ থেকে Send Money করুন এবং Transaction ID দিন।',
      },
    };
  }

  // 2. Admin Updates bKash / Nagad / Rocket Numbers from Dashboard
  async updatePaymentNumbers(data: {
    bkashNumber?: string;
    nagadNumber?: string;
    rocketNumber?: string;
    bkashType?: string;
    nagadType?: string;
    rocketType?: string;
  }) {
    const updates: { key: string; value: string }[] = [];

    if (data.bkashNumber !== undefined) updates.push({ key: 'bkash_number', value: data.bkashNumber });
    if (data.nagadNumber !== undefined) updates.push({ key: 'nagad_number', value: data.nagadNumber });
    if (data.rocketNumber !== undefined) updates.push({ key: 'rocket_number', value: data.rocketNumber });
    if (data.bkashType !== undefined) updates.push({ key: 'bkash_type', value: data.bkashType });
    if (data.nagadType !== undefined) updates.push({ key: 'nagad_type', value: data.nagadType });
    if (data.rocketType !== undefined) updates.push({ key: 'rocket_type', value: data.rocketType });

    for (const item of updates) {
      await this.prisma.systemSetting.upsert({
        where: { key: item.key },
        update: { value: item.value },
        create: { key: item.key, value: item.value },
      });
    }

    return {
      success: true,
      message: 'Payment gateway numbers updated successfully in database.',
    };
  }

  // 3. Student Submits Manual Payment Verification Form
  async submitManualPayment(userId: string, data: {
    planId: string;
    provider: PaymentProvider;
    senderNumber: string;
    transactionId: string;
    amount?: number;
    notes?: string;
  }) {
    // Falling back to "the first plan in the table" meant a bad id quietly
    // charged the student for a package they never chose. Accept an id or a
    // code, and otherwise refuse.
    const plan =
      (await this.prisma.subscriptionPlan.findUnique({ where: { id: data.planId } })) ||
      (await this.prisma.subscriptionPlan.findUnique({
        where: { code: String(data.planId || '').trim().toUpperCase() },
      }));

    if (!plan) throw new NotFoundException('That package does not exist. Pick one from the list.');
    if (!plan.isActive) {
      throw new BadRequestException(`'${plan.nameEn}' is not on sale right now.`);
    }

    // Prevent duplicate TrxID submissions
    const existing = await this.prisma.payment.findFirst({
      where: { transactionId: data.transactionId.trim().toUpperCase() },
    });

    if (existing) {
      throw new BadRequestException('This Transaction ID has already been submitted.');
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        planId: plan.id,
        amount: data.amount || plan.priceBdt,
        provider: data.provider,
        transactionId: data.transactionId.trim().toUpperCase(),
        status: PaymentStatus.PENDING,
        metadata: {
          senderNumber: data.senderNumber,
          planId: plan.id,
          planName: plan.nameEn,
          planCode: plan.code,
          durationDays: plan.durationDays,
          userNotes: data.notes || '',
          submittedAt: new Date().toISOString(),
        },
      },
    });

    return {
      success: true,
      message: 'Payment verification request submitted! Admin will verify and activate your plan shortly.',
      payment,
    };
  }

  // 4. Admin Gets All Pending Manual Payments for Verification
  async getPendingManualPayments() {
    return this.prisma.payment.findMany({
      where: { status: PaymentStatus.PENDING },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        plan: {
          select: { id: true, nameEn: true, code: true, durationDays: true, priceBdt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 4b. Admin Gets All Payments with filters (All, Pending, Success, Failed)
  async getAllPayments(query?: { status?: PaymentStatus; search?: string; provider?: PaymentProvider }) {
    const where: any = {};

    if (query?.status) {
      where.status = query.status;
    }
    if (query?.provider) {
      where.provider = query.provider;
    }
    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { transactionId: { contains: s, mode: 'insensitive' } },
        { user: { name: { contains: s, mode: 'insensitive' } } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
        { user: { phone: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [items, total, pendingCount, successCount, failedCount, totalRevenueAgg] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
          plan: {
            select: { id: true, nameEn: true, code: true, durationDays: true, priceBdt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.count({ where: { status: PaymentStatus.PENDING } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.SUCCESS } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.FAILED } }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum: { amount: true },
      }),
    ]);

    return {
      items,
      total,
      stats: {
        pending: pendingCount,
        success: successCount,
        failed: failedCount,
        totalRevenue: totalRevenueAgg._sum.amount || 0,
      },
    };
  }

  // 5. Admin Approves Payment & Activates User Subscription
  async approveManualPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true, plan: true },
    });

    if (!payment) throw new NotFoundException('Payment record not found');
    if (payment.status === PaymentStatus.SUCCESS) {
      throw new BadRequestException('Payment is already approved and active.');
    }

    const meta: any = payment.metadata || {};
    const planId = payment.planId || meta.planId;

    // Update Payment Status to SUCCESS
    const updatedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.SUCCESS,
        metadata: {
          ...meta,
          approvedAt: new Date().toISOString(),
        },
      },
    });

    // SubscriptionsService owns what "activating a plan" actually means
    // (computing expiresAt from the plan's real durationDays) — this used to
    // re-implement that inline, which meant a change to the real rule here
    // wouldn't apply to a payment approval.
    const subscription = planId
      ? await this.subscriptionsService.activateSubscription(payment.userId, planId)
      : null;
    const expiresAt = subscription?.expiresAt ?? new Date();

    // Send Push & In-App Notification to Student
    await this.notificationsService.sendToUser(
      payment.userId,
      'Subscription Activated! 🎉',
      `Your payment (TrxID: ${payment.transactionId}) has been verified. Your ${payment.plan?.nameEn || 'Premium'} plan is now active until ${expiresAt.toLocaleDateString()}!`,
      { type: 'SUBSCRIPTION_ACTIVATED' },
    );

    // A referral reward only fires off the referred student's FIRST-EVER
    // approved payment — not renewals or additional packages — so it can't
    // be farmed by one student buying (and re-buying) repeatedly.
    const priorSuccessCount = await this.prisma.payment.count({
      where: { userId: payment.userId, status: PaymentStatus.SUCCESS, id: { not: paymentId } },
    });
    if (priorSuccessCount === 0 && (payment.user as any).referredById) {
      await this.grantReferralReward((payment.user as any).referredById, payment.userId);
    }

    return {
      success: true,
      message: `Payment approved! Plan activated for ${payment.user.name}.`,
      payment: updatedPayment,
    };
  }

  /**
   * Rewards whoever referred this now-paying student. `Referral.referredId`
   * is unique, so re-running this (e.g. a retried request) can never grant
   * the same referral twice. The reward extends every currently active
   * subscription the referrer holds; if they have none right now, the
   * referral is still recorded (for the console to see) but grants 0 days —
   * there is nothing to extend.
   */
  private async grantReferralReward(referrerId: string, referredId: string) {
    const existing = await this.prisma.referral.findUnique({ where: { referredId } });
    if (existing) return;

    const REWARD_DAYS = 7;
    const activeSubs = await this.prisma.subscription.findMany({
      where: { userId: referrerId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    });

    for (const sub of activeSubs) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { expiresAt: new Date(sub.expiresAt.getTime() + REWARD_DAYS * 24 * 60 * 60 * 1000) },
      });
    }

    await this.prisma.referral.create({
      data: {
        referrerId,
        referredId,
        rewardDays: activeSubs.length > 0 ? REWARD_DAYS : 0,
        rewardAppliedAt: activeSubs.length > 0 ? new Date() : null,
      },
    });

    if (activeSubs.length > 0) {
      await this.notificationsService.sendToUser(
        referrerId,
        'Referral Bonus! 🎁',
        `Your referred friend just subscribed — we added ${REWARD_DAYS} days to your active plan${activeSubs.length > 1 ? 's' : ''}!`,
        { type: 'REFERRAL_REWARD' },
      );
    }
  }

  // 6. Admin Rejects Payment
  async rejectManualPayment(paymentId: string, reason?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) throw new NotFoundException('Payment record not found');

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.FAILED,
        metadata: {
          ...(payment.metadata as any || {}),
          rejectionReason: reason || 'Transaction ID not verified in SMS statement.',
          rejectedAt: new Date().toISOString(),
        },
      },
    });

    // Send Notification to user
    await this.notificationsService.sendToUser(
      payment.userId,
      'Payment Verification Failed ⚠️',
      `Your submission for TrxID ${payment.transactionId} could not be verified: ${reason || 'Transaction ID not found'}. Please contact support or retry.`,
      { type: 'PAYMENT_REJECTED' },
    );

    return {
      success: true,
      message: 'Payment rejected and student has been notified.',
      payment: updated,
    };
  }
}
