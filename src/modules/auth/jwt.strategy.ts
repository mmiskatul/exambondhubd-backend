import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  name?: string;
  status?: string;
}

/** How long a user's account status is trusted before it is re-checked. */
const STATUS_TTL_MS = 60_000;

type CachedStatus = {
  status: string;
  role: string;
  name: string | null;
  accessExpiresAt: Date | null;
  checkedAt: number;
};

/**
 * The JWT is the session: identity and role come straight off the verified
 * token, with no database round trip.
 *
 * This strategy used to load the user, their profile and their subscriptions on
 * EVERY authenticated request. The admin dashboard fires several requests per
 * page, so each one paid a Supabase round trip just to re-establish who was
 * already proven by the signature — which is what made the console feel slow.
 *
 * Account status (suspended / deleted) still has to be honoured, so it is
 * checked at most once a minute per user and cached. Anything needing the full
 * record — profile, subscriptions — loads it explicitly, e.g. GET /users/me.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly statusCache = new Map<string, CachedStatus>();

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    // Must match auth.module.ts's signing secret exactly — both read
    // JWT_SECRET with no fallback, since a fallback here would mean tokens
    // silently verify against a secret sitting in source control.
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET must be set — refusing to start with no configured secret.');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /** Drops a user from the cache so the next request re-reads them. */
  invalidate(userId: string) {
    this.statusCache.delete(userId);
  }

  private async resolveStatus(userId: string): Promise<CachedStatus> {
    const cached = this.statusCache.get(userId);
    if (cached && Date.now() - cached.checkedAt < STATUS_TTL_MS) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, role: true, name: true, accessExpiresAt: true },
    });

    if (!user) {
      this.statusCache.delete(userId);
      throw new UnauthorizedException('User account not found.');
    }

    const fresh: CachedStatus = {
      status: user.status,
      role: user.role,
      name: user.name,
      accessExpiresAt: user.accessExpiresAt,
      checkedAt: Date.now(),
    };

    // Keep the map from growing without bound on a long-running process.
    if (this.statusCache.size > 5000) this.statusCache.clear();
    this.statusCache.set(userId, fresh);

    return fresh;
  }

  async validate(payload: JwtPayload) {
    const { status, role, name, accessExpiresAt } = await this.resolveStatus(payload.sub);

    if (status === 'SUSPENDED') {
      throw new UnauthorizedException('This account has been suspended.');
    }

    // Temporary passes stop working the moment their window closes, even if
    // the token itself has not expired yet.
    if (accessExpiresAt && accessExpiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('This temporary access has expired.');
    }

    // The role comes from the database rather than the token, so a demotion
    // takes effect within the cache window instead of at token expiry.
    return {
      id: payload.sub,
      email: payload.email,
      name: name ?? payload.name ?? null,
      role,
      status,
    };
  }
}
