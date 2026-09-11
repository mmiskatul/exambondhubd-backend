import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const VERIFY_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const VERIFY_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const VERIFY_MAX_ATTEMPTS = 5;

const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RESET_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const RESET_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private configService: ConfigService,
  ) {}

  private readonly userInclude = {
    profile: true,
    subscriptions: {
      where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
      include: { plan: true },
      take: 1,
    },
  };

  /** Students only. Staff accounts sign in through the admin console. */
  private assertStudentAccount(user: { role: UserRole; status: UserStatus }) {
    if (user.role !== UserRole.USER) {
      throw new UnauthorizedException(
        'This is a staff account. Please sign in through the admin console.',
      );
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('This account has been suspended.');
    }
  }

  private normaliseEmail(email?: string) {
    const value = (email || '').trim().toLowerCase();
    if (!value || !value.includes('@') || value.length < 5) {
      throw new BadRequestException('Please enter a valid email address.');
    }
    return value;
  }

  /** A random 6-digit OTP, formatted so it never drops a leading zero. */
  private generateCode() {
    return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  }

  /** No 0/O/1/I/L — a code a student might have to type back in by hand. */
  private async generateReferralCode() {
    const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let attempt = 0; attempt < 5; attempt++) {
      const code =
        'PP' + Array.from({ length: 6 }, () => charset[Math.floor(Math.random() * charset.length)]).join('');
      const taken = await this.prisma.user.findUnique({ where: { referralCode: code } });
      if (!taken) return code;
    }
    throw new Error('Could not generate a unique referral code.');
  }

  /**
   * Creates a student account and emails it a 6-digit code. The account is
   * created (not just held in memory) so a half-finished signup that never
   * verifies can be resumed with the resend endpoint rather than lost — but no
   * session is issued until the code is confirmed, since an unverified email
   * might not belong to whoever typed it.
   */
  async register(dto: {
    email: string;
    password: string;
    name?: string;
    phone?: string;
    referralCode?: string;
  }) {
    const email = this.normaliseEmail(dto.email);
    const password = String(dto.password || '');

    if (password.length < 6) {
      throw new BadRequestException('Your password must be at least 6 characters.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('An account with this email already exists. Sign in instead.');
    }

    const code = this.generateCode();
    const name = (dto.name || '').trim() || email.split('@')[0];
    const referralCode = await this.generateReferralCode();

    // A bad/unknown code is not worth blocking a signup over — it is just
    // silently not credited to anyone.
    const enteredCode = (dto.referralCode || '').trim().toUpperCase() || null;
    const referrer = enteredCode
      ? await this.prisma.user.findUnique({ where: { referralCode: enteredCode } })
      : null;

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        phone: (dto.phone || '').trim() || null,
        password: await bcrypt.hash(password, 10),
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        emailVerifyCodeHash: await bcrypt.hash(code, 10),
        emailVerifyExpires: new Date(Date.now() + VERIFY_CODE_TTL_MS),
        emailVerifySentAt: new Date(),
        emailVerifyAttempts: 0,
        referralCode,
        referredByCode: enteredCode,
        referredById: referrer?.id,
        profile: { create: {} },
      },
    });

    // A dead SMTP server should not stop the account from being created —
    // the student can always ask for the code again once mail is fixed.
    const { sent } = await this.mailService.sendVerificationEmail(email, name, code);

    return {
      success: true,
      message: sent
        ? `We sent a verification code to ${email}.`
        : `Account created. Verification email could not be sent — ask an admin to check the mail settings, or try Resend once it is fixed.`,
      data: { requiresVerification: true, email: user.email },
    };
  }

  /**
   * Confirms the code from `register` (or a resend) and, on success, signs the
   * student straight in — the verified email and the password check at
   * registration together are enough to trust this session.
   */
  async verifyEmail(dto: { email: string; code: string }) {
    const email = this.normaliseEmail(dto.email);
    const code = String(dto.code || '').trim();

    const user = await this.prisma.user.findUnique({ where: { email }, include: this.userInclude });
    if (!user) throw new BadRequestException('No account found with this email.');

    if (user.emailVerified) {
      return {
        success: true,
        message: 'This email is already verified. Please sign in.',
        data: { alreadyVerified: true },
      };
    }

    if (!user.emailVerifyCodeHash || !user.emailVerifyExpires) {
      throw new BadRequestException('No verification code is pending. Request a new one.');
    }

    if (user.emailVerifyExpires.getTime() < Date.now()) {
      throw new BadRequestException('That code has expired. Request a new one.');
    }

    if (user.emailVerifyAttempts >= VERIFY_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many incorrect attempts. Request a new code.');
    }

    const matches = await bcrypt.compare(code, user.emailVerifyCodeHash);

    if (!matches) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifyAttempts: { increment: 1 } },
      });

      const left = VERIFY_MAX_ATTEMPTS - (user.emailVerifyAttempts + 1);
      throw new BadRequestException(
        left > 0
          ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Incorrect code. No attempts left — request a new code.',
      );
    }

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyCodeHash: null,
        emailVerifyExpires: null,
        emailVerifyAttempts: 0,
        lastLoginAt: new Date(),
      },
      include: this.userInclude,
    });

    return {
      success: true,
      message: `Email verified. Welcome, ${verified.name}!`,
      data: { accessToken: this.generateToken(verified), user: this.sanitise(verified) },
    };
  }

  /** Issues a fresh code, rate-limited so a retry loop cannot spam the inbox. */
  async resendVerification(dto: { email: string }) {
    const email = this.normaliseEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) throw new BadRequestException('No account found with this email.');
    if (user.emailVerified) {
      throw new BadRequestException('This email is already verified. Please sign in.');
    }

    if (user.emailVerifySentAt) {
      const waited = Date.now() - user.emailVerifySentAt.getTime();
      if (waited < VERIFY_RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((VERIFY_RESEND_COOLDOWN_MS - waited) / 1000);
        throw new BadRequestException(`Please wait ${wait}s before requesting another code.`);
      }
    }

    const code = this.generateCode();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyCodeHash: await bcrypt.hash(code, 10),
        emailVerifyExpires: new Date(Date.now() + VERIFY_CODE_TTL_MS),
        emailVerifySentAt: new Date(),
        emailVerifyAttempts: 0,
      },
    });

    const { sent } = await this.mailService.sendVerificationEmail(email, user.name, code);

    return {
      success: true,
      message: sent
        ? `A new code was sent to ${email}.`
        : 'Could not send the email right now — please try again shortly.',
      data: { email },
    };
  }

  /**
   * Forgot-password is the classic way to probe which addresses have
   * accounts, so — unlike resend-verification above — this answers
   * identically whether or not the email, or a password to reset, exists.
   */
  async forgotPassword(dto: { email: string }) {
    const email = this.normaliseEmail(dto.email);
    const message = `If ${email} has an account, a reset code has been sent to it.`;

    const user = await this.prisma.user.findUnique({ where: { email } });
    // No account, or a Google-only account with no password to reset —
    // either way, say nothing that would let a caller tell the difference.
    if (!user || !user.password) {
      return { success: true, message, data: { email } };
    }

    if (user.passwordResetSentAt) {
      const waited = Date.now() - user.passwordResetSentAt.getTime();
      if (waited < RESET_RESEND_COOLDOWN_MS) {
        return { success: true, message, data: { email } };
      }
    }

    const code = this.generateCode();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetCodeHash: await bcrypt.hash(code, 10),
        passwordResetExpires: new Date(Date.now() + RESET_CODE_TTL_MS),
        passwordResetSentAt: new Date(),
        passwordResetAttempts: 0,
      },
    });

    await this.mailService.sendPasswordResetEmail(email, user.name, code);

    return { success: true, message, data: { email } };
  }

  /** Confirms the code from `forgotPassword` and signs the student in with their new password. */
  async resetPassword(dto: { email: string; code: string; newPassword: string }) {
    const email = this.normaliseEmail(dto.email);
    const code = String(dto.code || '').trim();
    const newPassword = String(dto.newPassword || '');

    if (newPassword.length < 6) {
      throw new BadRequestException('Your new password must be at least 6 characters.');
    }

    const user = await this.prisma.user.findUnique({ where: { email }, include: this.userInclude });
    if (!user || !user.passwordResetCodeHash || !user.passwordResetExpires) {
      throw new BadRequestException('Invalid or expired code. Request a new one.');
    }

    if (user.passwordResetExpires.getTime() < Date.now()) {
      throw new BadRequestException('That code has expired. Request a new one.');
    }

    if (user.passwordResetAttempts >= RESET_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many incorrect attempts. Request a new code.');
    }

    const matches = await bcrypt.compare(code, user.passwordResetCodeHash);
    if (!matches) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordResetAttempts: { increment: 1 } },
      });

      const left = RESET_MAX_ATTEMPTS - (user.passwordResetAttempts + 1);
      throw new BadRequestException(
        left > 0
          ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Incorrect code. No attempts left — request a new code.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        passwordResetCodeHash: null,
        passwordResetExpires: null,
        passwordResetAttempts: 0,
      },
      include: this.userInclude,
    });

    return {
      success: true,
      message: `Password updated. Welcome back, ${updated.name}!`,
      data: { accessToken: this.generateToken(updated), user: this.sanitise(updated) },
    };
  }

  /** Email and password sign-in for students. */
  async login(dto: { email: string; password: string }) {
    const email = this.normaliseEmail(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: this.userInclude,
    });

    // The same message either way, so this cannot be used to discover which
    // addresses have accounts.
    const rejected = new UnauthorizedException('Wrong email or password.');

    if (!user || !user.password) throw rejected;

    const ok = await bcrypt.compare(String(dto.password || ''), user.password);
    if (!ok) throw rejected;

    this.assertStudentAccount(user);

    // A password match confirms it is them, but not yet that the address is
    // real — that is what the registration code proved. The structured
    // `error`/`details` here let the app recognise this one case and send
    // them straight to the verify screen instead of a dead-end toast.
    if (!user.emailVerified) {
      throw new UnauthorizedException({
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address before signing in.',
        details: { email: user.email },
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      success: true,
      message: `Welcome back, ${user.name}!`,
      data: { accessToken: this.generateToken(user), user: this.sanitise(user) },
    };
  }

  /**
   * Google sign-in. The client completes OAuth with Supabase and sends the
   * resulting access token; it is verified against Supabase here rather than
   * trusted, so a caller cannot simply claim to be an email address.
   */
  async googleSignIn(dto: { supabaseAccessToken: string }) {
    const token = (dto?.supabaseAccessToken || '').trim();
    if (!token) throw new BadRequestException('No Google sign-in token was provided.');

    const url = this.configService.get<string>('SUPABASE_URL');
    const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY');

    if (!url || !anonKey) {
      throw new BadRequestException('Google sign-in is not configured on the server.');
    }

    let profile: any;
    try {
      const res = await fetch(`${url}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      });

      if (!res.ok) throw new Error(String(res.status));
      profile = await res.json();
    } catch {
      throw new UnauthorizedException('That Google sign-in could not be verified. Try again.');
    }

    const email = this.normaliseEmail(profile?.email);
    const meta = profile?.user_metadata || {};

    let user = await this.prisma.user.findUnique({
      where: { email },
      include: this.userInclude,
    });

    if (user) {
      this.assertStudentAccount(user);

      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          supabaseId: profile.id || user.supabaseId,
          avatarUrl: meta.avatar_url || meta.picture || user.avatarUrl,
          // An existing name is not overwritten by Google's version.
          name: user.name || meta.full_name || meta.name || email.split('@')[0],
          lastLoginAt: new Date(),
          // Signing in through Google proves this address, even if it was
          // registered with a password earlier and never checked — no reason
          // to make them dig up an OTP for an address Google just confirmed.
          emailVerified: true,
        },
        include: this.userInclude,
      });
    } else {
      user = await this.prisma.user.create({
        data: {
          email,
          name: meta.full_name || meta.name || email.split('@')[0],
          avatarUrl: meta.avatar_url || meta.picture || null,
          supabaseId: profile.id,
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          lastLoginAt: new Date(),
          emailVerified: true,
          referralCode: await this.generateReferralCode(),
          profile: { create: {} },
        },
        include: this.userInclude,
      });
    }

    return {
      success: true,
      message: `Welcome, ${user.name}!`,
      data: { accessToken: this.generateToken(user), user: this.sanitise(user) },
    };
  }

  /** Never let a password hash leave the server. */
  private sanitise(user: any) {
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

  async adminLogin(email: string, password?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { profile: true },
    });

    if (!user || user.role === UserRole.USER) {
      throw new UnauthorizedException('Access denied. Administrator privileges required.');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Administrator account has been suspended.');
    }

    if (user.accessExpiresAt && user.accessExpiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(
        'This temporary access has expired. Ask an administrator for a new one.',
      );
    }

    // Verify hashed password. Every staff/admin row is created with one today
    // (seeding and TemporaryAccessService both always set it), but the old
    // version of this check silently skipped verification entirely whenever
    // user.password was falsy — a fail-open bug that would grant a full
    // console session with no password at all the moment any account without
    // one exists. This fails closed instead, matching the student login path.
    if (!user.password) {
      throw new UnauthorizedException('This account has no password set. Contact a super admin.');
    }
    const isValid = await bcrypt.compare(String(password || ''), user.password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid administrator credentials.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // A temporary pass must not hand out a token that outlives its window.
    const token = this.generateToken(user, user.accessExpiresAt);

    return {
      success: true,
      message: `Signed in as ${user.name || user.email}.`,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        accessToken: token,
      },
    };
  }

  // Change Password with old password verification
  async changePassword(userId: string, oldPass: string, newPass: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new UnauthorizedException('User account not found');

    // If user has existing password, verify old password
    if (user.password) {
      const isMatch = await bcrypt.compare(oldPass, user.password);
      if (!isMatch) {
        throw new BadRequestException('Current (old) password is incorrect.');
      }
    }

    if (!newPass || newPass.length < 6) {
      throw new BadRequestException('New password must be at least 6 characters.');
    }

    const hashedPassword = await bcrypt.hash(newPass, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return {
      success: true,
      message: 'Password has been changed successfully.',
    };
  }

  generateToken(
    user: { id: string; email: string; role: string; name?: string },
    accessExpiresAt?: Date | null,
  ) {
    // Everything the request pipeline needs to authorise travels in the token,
    // so authenticated requests no longer hit the database to find out who is
    // calling.
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    if (accessExpiresAt) {
      const seconds = Math.floor((accessExpiresAt.getTime() - Date.now()) / 1000);
      if (seconds > 0) {
        return this.jwtService.sign(payload, { expiresIn: seconds });
      }
    }

    return this.jwtService.sign(payload);
  }

  /** Full record for the /auth/me route, loaded on demand rather than per request. */
  async getFullUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        subscriptions: {
          where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
          include: { plan: true },
          take: 1,
        },
      },
    });

    if (!user) throw new UnauthorizedException('User account not found.');

    return { ...this.sanitise(user), activeSubscription: user.subscriptions[0] || null };
  }

  /**
   * Issues a fresh token for an already-authenticated session, so a long admin
   * session never has to re-enter credentials just because the token aged.
   */
  async refreshSession(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, role: true, status: true, accessExpiresAt: true,
      },
    });

    if (!user) throw new UnauthorizedException('User account not found.');
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('This account has been suspended.');
    }
    if (user.accessExpiresAt && user.accessExpiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('This temporary access has expired.');
    }

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      accessToken: this.generateToken(user, user.accessExpiresAt),
    };
  }
}
