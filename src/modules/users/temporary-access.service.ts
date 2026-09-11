import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, UserStatus } from '@prisma/client';
import { JwtStrategy } from '../auth/jwt.strategy';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

/** Roles that may be handed out temporarily. SUPER_ADMIN is deliberately absent. */
export const GRANTABLE_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.QUESTION_EDITOR,
  UserRole.QUESTION_REVIEWER,
  UserRole.SUPPORT,
];

const MAX_HOURS = 24 * 30; // a month is the longest a "temporary" pass makes sense

/**
 * Short-lived console credentials.
 *
 * An admin issues an email + password that works for a fixed window, carries a
 * restricted role, and can be revoked instantly. They are ordinary User rows
 * flagged `isTemporary`, so the existing login and guards apply unchanged —
 * with an extra expiry check in the auth path.
 */
@Injectable()
export class TemporaryAccessService {
  constructor(
    private prisma: PrismaService,
    private jwtStrategy: JwtStrategy,
  ) {}

  /** Readable but unguessable, e.g. `temp-review-4f2a91@exambondhubd.local`. */
  private buildEmail(role: UserRole) {
    const slug = role.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8);
    const suffix = crypto.randomBytes(3).toString('hex');
    return `temp-${slug}-${suffix}@exambondhubd.local`;
  }

  /** 16 chars from an unambiguous alphabet — no O/0/I/l to misread aloud. */
  private buildPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(16);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  }

  private decorate(user: any) {
    const expired = user.accessExpiresAt ? user.accessExpiresAt.getTime() <= Date.now() : false;
    const revoked = user.status === UserStatus.SUSPENDED;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      note: user.accessNote,
      expiresAt: user.accessExpiresAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      isExpired: expired,
      isRevoked: revoked,
      state: revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE',
      hoursRemaining:
        !expired && !revoked && user.accessExpiresAt
          ? Math.max(0, Math.round((user.accessExpiresAt.getTime() - Date.now()) / 36e5))
          : 0,
    };
  }

  async list() {
    const rows = await this.prisma.user.findMany({
      where: { isTemporary: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => this.decorate(r));
  }

  async create(data: { role?: string; expiresInHours?: number; note?: string }, issuedById?: string) {
    const role = (data.role || UserRole.SUPPORT) as UserRole;

    if (!GRANTABLE_ROLES.includes(role)) {
      throw new BadRequestException(
        `'${role}' cannot be granted temporarily. Choose one of: ${GRANTABLE_ROLES.join(', ')}.`,
      );
    }

    const hours = Number(data.expiresInHours) || 24;
    if (hours < 1 || hours > MAX_HOURS) {
      throw new BadRequestException(`Access must last between 1 and ${MAX_HOURS} hours.`);
    }

    const email = this.buildEmail(role);
    const password = this.buildPassword();
    const expiresAt = new Date(Date.now() + hours * 36e5);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 10),
        name: data.note?.trim() || `Temporary ${role.replace(/_/g, ' ').toLowerCase()}`,
        role,
        status: UserStatus.ACTIVE,
        isTemporary: true,
        accessExpiresAt: expiresAt,
        accessNote: data.note?.trim() || null,
        issuedById: issuedById || null,
      },
    });

    const message = `Temporary ${role} access created, valid for ${hours} hour${hours === 1 ? '' : 's'}.`;

    return {
      success: true,
      message,
      data: {
        message,
        // The password is returned once, here, and never stored in the clear.
        credentials: { email, password, expiresAt, role, hours },
        access: this.decorate(user),
      },
    };
  }

  /** Ends access immediately, without deleting the audit trail. */
  async revoke(id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, isTemporary: true } });
    if (!user) throw new NotFoundException('That temporary access does not exist.');

    await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.SUSPENDED, accessExpiresAt: new Date() },
    });

    // Any token already issued stops working on the next request.
    this.jwtStrategy.invalidate(id);

    const message = `Access for ${user.email} has been revoked.`;
    return { success: true, message, data: { message } };
  }

  /** Removes the record entirely. */
  async remove(id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, isTemporary: true } });
    if (!user) throw new NotFoundException('That temporary access does not exist.');

    await this.prisma.userProfile.deleteMany({ where: { userId: id } });
    await this.prisma.userNotification.deleteMany({ where: { userId: id } });
    await this.prisma.user.deleteMany({ where: { id } });
    this.jwtStrategy.invalidate(id);

    const message = `Deleted the temporary access for ${user.email}.`;
    return { success: true, message, data: { message } };
  }

  /** Pushes the expiry out, or brings a revoked pass back for a fresh window. */
  async extend(id: string, hours: number) {
    const user = await this.prisma.user.findFirst({ where: { id, isTemporary: true } });
    if (!user) throw new NotFoundException('That temporary access does not exist.');

    const extra = Number(hours) || 24;
    if (extra < 1 || extra > MAX_HOURS) {
      throw new BadRequestException(`Access must last between 1 and ${MAX_HOURS} hours.`);
    }

    // Extend from now when it has already lapsed, otherwise from its end.
    const base =
      user.accessExpiresAt && user.accessExpiresAt.getTime() > Date.now()
        ? user.accessExpiresAt.getTime()
        : Date.now();

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        accessExpiresAt: new Date(base + extra * 36e5),
        status: UserStatus.ACTIVE,
      },
    });

    this.jwtStrategy.invalidate(id);

    const message = `Extended ${user.email} by ${extra} hour${extra === 1 ? '' : 's'}.`;
    return { success: true, message, data: { message, access: this.decorate(updated) } };
  }

  /** Housekeeping: how many passes have lapsed but not been cleared. */
  async purgeExpired(olderThanHours = 24 * 7) {
    const cutoff = new Date(Date.now() - olderThanHours * 36e5);

    const stale = await this.prisma.user.findMany({
      where: { isTemporary: true, accessExpiresAt: { lt: cutoff } },
      select: { id: true },
    });

    if (stale.length === 0) {
      return { success: true, message: 'Nothing to clear.', data: { message: 'Nothing to clear.', removed: 0 } };
    }

    const ids = stale.map((s) => s.id);
    await this.prisma.userProfile.deleteMany({ where: { userId: { in: ids } } });
    await this.prisma.userNotification.deleteMany({ where: { userId: { in: ids } } });
    await this.prisma.user.deleteMany({ where: { id: { in: ids } } });
    ids.forEach((id) => this.jwtStrategy.invalidate(id));

    const message = `Cleared ${ids.length} expired access record(s).`;
    return { success: true, message, data: { message, removed: ids.length } };
  }
}
