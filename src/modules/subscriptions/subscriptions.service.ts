import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SubscriptionsService {
  constructor(private prisma: PrismaService) {}

  private readonly scopeInclude = {
    scopes: {
      include: {
        portal: { select: { id: true, key: true, titleEn: true, titleBn: true, icon: true } },
        unit: { select: { id: true, key: true, titleEn: true, titleBn: true } },
      },
    },
  };

  async getPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceBdt: 'asc' },
      include: this.scopeInclude,
    });
  }

  async getAllPlansAdmin() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: { priceBdt: 'asc' },
      include: {
        ...this.scopeInclude,
        _count: {
          select: { subscriptions: true, payments: true },
        },
      },
    });
  }

  /**
   * Turns { portalKey, unitKey? } pairs into scope rows. A pair with no unit
   * covers the whole portal, which is how Medical & Dental is sold as one
   * package while DU's units are priced separately.
   */
  private async resolveScopes(scopes?: { portalKey: string; unitKey?: string | null }[]) {
    if (!scopes || scopes.length === 0) return [];

    const rows: { portalId: string; unitId: string | null; unitScope: string }[] = [];

    for (const raw of scopes) {
      const key = (raw?.portalKey || '').trim();
      if (!key) continue;

      const portal = await this.prisma.portal.findUnique({ where: { key } });
      if (!portal) {
        throw new BadRequestException(`No exam portal with the key '${key}'.`);
      }

      const unitKey = (raw.unitKey || '').trim();
      if (!unitKey) {
        rows.push({ portalId: portal.id, unitId: null, unitScope: '' });
        continue;
      }

      const unit = await this.prisma.portalUnit.findFirst({
        where: { portalId: portal.id, key: unitKey },
      });

      if (!unit) {
        throw new BadRequestException(
          `'${portal.titleEn}' has no unit '${unitKey}'. Add it under Portal Configuration first.`,
        );
      }

      rows.push({ portalId: portal.id, unitId: unit.id, unitScope: unit.id });
    }

    // The same exam listed twice would violate the unique index.
    const seen = new Set<string>();
    return rows.filter((r) => {
      const key = `${r.portalId}:${r.unitScope}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async createPlan(data: {
    code: any;
    nameEn: string;
    nameBn: string;
    priceBdt: number;
    discountPriceBdt?: number;
    durationDays: number;
    descriptionEn: string;
    descriptionBn?: string;
    features?: string[];
    isActive?: boolean;
    scopes?: { portalKey: string; unitKey?: string | null }[];
  }) {
    const code = String(data.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!code) throw new BadRequestException('A package code is required.');

    const existing = await this.prisma.subscriptionPlan.findUnique({ where: { code } });
    if (existing) {
      throw new BadRequestException(`A package with the code '${code}' already exists.`);
    }

    const scopeRows = await this.resolveScopes(data.scopes);

    return this.prisma.subscriptionPlan.create({
      data: {
        code,
        nameEn: data.nameEn,
        nameBn: data.nameBn || data.nameEn,
        priceBdt: Number(data.priceBdt),
        discountPriceBdt: data.discountPriceBdt ? Number(data.discountPriceBdt) : null,
        durationDays: Number(data.durationDays),
        descriptionEn: data.descriptionEn,
        descriptionBn: data.descriptionBn || data.descriptionEn,
        features: data.features || [],
        isActive: data.isActive ?? true,
        scopes: { create: scopeRows },
      },
      include: this.scopeInclude,
    });
  }

  async updatePlan(id: string, data: {
    nameEn?: string;
    nameBn?: string;
    priceBdt?: number;
    discountPriceBdt?: number;
    durationDays?: number;
    descriptionEn?: string;
    descriptionBn?: string;
    features?: string[];
    isActive?: boolean;
    scopes?: { portalKey: string; unitKey?: string | null }[];
  }) {
    const found = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('That package no longer exists.');

    // Scopes are replaced wholesale so removing an exam from a package works.
    if (data.scopes !== undefined) {
      const scopeRows = await this.resolveScopes(data.scopes);
      await this.prisma.planScope.deleteMany({ where: { planId: id } });
      if (scopeRows.length > 0) {
        await this.prisma.planScope.createMany({
          data: scopeRows.map((r) => ({ ...r, planId: id })),
          skipDuplicates: true,
        });
      }
    }

    // Named field-by-field rather than `...rest` — this route has no formal
    // DTO to whitelist against, so spreading the raw body would let an
    // unlisted property (anything Prisma would accept as a SubscriptionPlan
    // column) ride along into the update. Naming each field caps it to
    // exactly what this method's own signature promises.
    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        nameEn: data.nameEn,
        nameBn: data.nameBn,
        descriptionEn: data.descriptionEn,
        descriptionBn: data.descriptionBn,
        features: data.features,
        isActive: data.isActive,
        priceBdt: data.priceBdt !== undefined ? Number(data.priceBdt) : undefined,
        discountPriceBdt: data.discountPriceBdt !== undefined ? (data.discountPriceBdt ? Number(data.discountPriceBdt) : null) : undefined,
        durationDays: data.durationDays !== undefined ? Number(data.durationDays) : undefined,
      },
      include: this.scopeInclude,
    });
  }

  /**
   * Every exam the student currently has paid access to, flattened from their
   * live subscriptions so the app can gate a portal or unit without working out
   * plan overlaps itself.
   */
  async getMyAccess(userId: string) {
    const subs = await this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      include: {
        plan: { include: this.scopeInclude },
      },
      orderBy: { expiresAt: 'desc' },
    });

    const portals = new Set<string>();
    const units = new Set<string>();
    let platformWide = false;

    for (const sub of subs) {
      const scopes = sub.plan?.scopes || [];

      // A package with no scopes at all is a platform-wide pass.
      if (scopes.length === 0) {
        platformWide = true;
        continue;
      }

      for (const sc of scopes) {
        if (sc.unit) units.add(sc.unit.key);
        // No unit means the whole portal, every unit inside it.
        else if (sc.portal) portals.add(sc.portal.key);
      }
    }

    return {
      hasActiveSubscription: subs.length > 0,
      platformWide,
      /** Portal keys unlocked in full. */
      portalKeys: Array.from(portals),
      /** Individually unlocked unit keys. */
      unitKeys: Array.from(units),
      subscriptions: subs.map((s) => ({
        id: s.id,
        planId: s.planId,
        planName: s.plan?.nameEn,
        planNameBn: s.plan?.nameBn,
        startsAt: s.startsAt,
        expiresAt: s.expiresAt,
        scopes: s.plan?.scopes || [],
      })),
    };
  }

  /** Does this student have access to a given exam, and unit within it? */
  async canAccess(userId: string, portalKey: string, unitKey?: string) {
    const access = await this.getMyAccess(userId);

    if (access.platformWide) return { allowed: true, reason: 'platform' };
    if (access.portalKeys.includes(portalKey)) return { allowed: true, reason: 'portal' };
    if (unitKey && access.unitKeys.includes(unitKey)) return { allowed: true, reason: 'unit' };

    return { allowed: false, reason: 'not-subscribed' };
  }

  async getUserSubscription(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      include: { plan: true },
      orderBy: { expiresAt: 'desc' },
    });

    return sub || null;
  }

  async activateSubscription(userId: string, planId: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) throw new NotFoundException('Subscription plan not found');

    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    return this.prisma.subscription.create({
      data: {
        userId,
        planId,
        startsAt,
        expiresAt,
        status: 'ACTIVE',
      },
      include: { plan: true },
    });
  }

  /**
   * The packages that unlock a given exam, cheapest first. A unit is covered
   * either by its own package or by one that covers the whole portal, so both
   * are offered and the student picks.
   */
  async getPlansFor(portalKey: string, unitKey?: string) {
    const portal = await this.prisma.portal.findUnique({ where: { key: portalKey } });
    if (!portal) throw new NotFoundException(`No exam portal with the key '${portalKey}'.`);

    const unit = unitKey
      ? await this.prisma.portalUnit.findFirst({ where: { portalId: portal.id, key: unitKey } })
      : null;

    if (unitKey && !unit) {
      throw new NotFoundException(`'${portal.titleEn}' has no unit '${unitKey}'.`);
    }

    const plans = await this.prisma.subscriptionPlan.findMany({
      where: {
        isActive: true,
        scopes: {
          some: {
            portalId: portal.id,
            // Either the whole portal, or this exact unit.
            OR: [{ unitId: null }, ...(unit ? [{ unitId: unit.id }] : [])],
          },
        },
      },
      orderBy: { priceBdt: 'asc' },
      include: this.scopeInclude,
    });

    return {
      portal: { key: portal.key, titleEn: portal.titleEn, titleBn: portal.titleBn },
      unit: unit ? { key: unit.key, titleEn: unit.titleEn, titleBn: unit.titleBn } : null,
      plans,
    };
  }

  /** One package with everything the console's detail view shows. */
  async getPlan(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: {
        ...this.scopeInclude,
        _count: { select: { subscriptions: true, payments: true } },
      },
    });

    if (!plan) throw new NotFoundException('That package no longer exists.');

    const [activeSubs, revenue] = await Promise.all([
      this.prisma.subscription.count({
        where: { planId: id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      }),
      this.prisma.payment.aggregate({
        where: { planId: id, status: 'SUCCESS' },
        _sum: { amount: true },
      }),
    ]);

    return {
      ...plan,
      stats: {
        subscriptions: plan._count.subscriptions,
        activeSubscriptions: activeSubs,
        payments: plan._count.payments,
        revenueBdt: revenue._sum.amount || 0,
      },
    };
  }

  /**
   * Deleting a package cascades into Subscription and Payment, so a package
   * anyone has ever bought would take their access and their payment record
   * with it. Those are refused; taking the package off sale is the safe way to
   * retire it.
   */
  async deletePlan(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true, payments: true } } },
    });

    if (!plan) throw new NotFoundException('That package has already been deleted.');

    const { subscriptions, payments } = plan._count;

    if (subscriptions > 0 || payments > 0) {
      const parts = [];
      if (subscriptions > 0) parts.push(`${subscriptions} subscription(s)`);
      if (payments > 0) parts.push(`${payments} payment(s)`);

      throw new BadRequestException(
        `'${plan.nameEn}' has ${parts.join(' and ')} against it. Deleting it would erase them. ` +
          'Take it off sale instead — students who bought it keep their access.',
      );
    }

    await this.prisma.planScope.deleteMany({ where: { planId: id } });

    // deleteMany reports a count instead of raising when the row is already gone.
    const removed = await this.prisma.subscriptionPlan.deleteMany({ where: { id } });
    if (removed.count === 0) {
      throw new NotFoundException('That package has already been deleted.');
    }

    const message = `Deleted the package '${plan.nameEn}'.`;
    return { success: true, message, data: { message, id } };
  }
}
