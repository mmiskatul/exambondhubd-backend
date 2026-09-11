import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Sends transactional email over SMTP. Any standard SMTP provider works —
 * Gmail (with an app password), Brevo, SendGrid's SMTP relay, Mailtrap for
 * testing, or a self-hosted server — configured entirely through env vars, so
 * nothing provider-specific lives in code.
 *
 * If SMTP_HOST is not set the transporter is never created and every send
 * falls back to logging the message (and, for OTP codes, the code itself) to
 * the console. That keeps registration working in a fresh checkout before
 * anyone has filled in real credentials, rather than 500ing every signup.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress = 'ExamBondhuBD <no-reply@exambondhubd.com>';

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('SMTP_HOST');
    // ConfigService.get<T>() doesn't coerce types — every env var is a
    // string at runtime regardless of the generic — so this still needs an
    // explicit Number() the same as the raw process.env version did.
    const port = Number(this.configService.get<string>('SMTP_PORT')) || 587;
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASSWORD');

    const fromName = this.configService.get<string>('MAIL_FROM_NAME', 'ExamBondhuBD');
    const fromEmail = this.configService.get<string>('MAIL_FROM_EMAIL') || user || 'no-reply@exambondhubd.com';
    this.fromAddress = `${fromName} <${fromEmail}>`;

    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD missing in .env). ' +
          'Verification emails will be logged to the console instead of sent.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      // 465 is always implicit TLS; anything else (587, 25) upgrades via STARTTLS.
      secure: this.configService.get<string>('SMTP_SECURE') === 'true' || port === 465,
      auth: { user, pass },
    });

    this.logger.log(`SMTP configured: ${host}:${port} as ${fromEmail}`);
  }

  get isConfigured() {
    return this.transporter !== null;
  }

  private async send(to: string, subject: string, html: string, text: string) {
    if (!this.transporter) {
      this.logger.warn(`[DEV FALLBACK] Email to ${to} not sent (SMTP unconfigured):\n${text}`);
      return { sent: false };
    }

    try {
      await this.transporter.sendMail({ from: this.fromAddress, to, subject, html, text });
      return { sent: true };
    } catch (err: any) {
      // A broken SMTP connection should not take the whole request down —
      // the caller decides how to handle a failed send.
      this.logger.error(`Could not send email to ${to}: ${err.message}`);
      return { sent: false, error: err.message };
    }
  }

  async sendVerificationEmail(to: string, name: string, code: string) {
    const subject = 'Verify your ExamBondhuBD account · আপনার একাউন্ট যাচাই করুন';

    const text =
      `Hi ${name},\n\nYour ExamBondhuBD verification code is: ${code}\n` +
      `This code expires in 15 minutes.\n\nIf you did not create this account, you can ignore this email.`;

    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #f8fafc;">
        <div style="background: #059669; width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
          <span style="color: white; font-size: 24px; font-weight: 900; line-height: 48px; display: block; text-align: center;">E</span>
        </div>
        <h1 style="font-size: 18px; color: #0f172a; margin: 0 0 4px;">Verify your email address</h1>
        <p style="font-size: 13px; color: #64748b; margin: 0 0 24px;">আপনার ইমেইল ঠিকানা যাচাই করুন</p>

        <p style="font-size: 14px; color: #334155; line-height: 1.6;">
          Hi ${name}, use the code below to verify your account. It expires in 15 minutes.
        </p>

        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #0f172a; font-family: monospace;">${code}</span>
        </div>

        <p style="font-size: 12px; color: #94a3b8; line-height: 1.6;">
          If you did not create an ExamBondhuBD account, you can safely ignore this email.
        </p>
      </div>
    `;

    return this.send(to, subject, html, text);
  }

  async sendPasswordResetEmail(to: string, name: string, code: string) {
    const subject = 'Reset your ExamBondhuBD password · পাসওয়ার্ড রিসেট করুন';

    const text =
      `Hi ${name},\n\nYour ExamBondhuBD password reset code is: ${code}\n` +
      `This code expires in 15 minutes.\n\nIf you did not request this, you can ignore this email — your password will not change.`;

    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #f8fafc;">
        <div style="background: #059669; width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
          <span style="color: white; font-size: 24px; font-weight: 900; line-height: 48px; display: block; text-align: center;">E</span>
        </div>
        <h1 style="font-size: 18px; color: #0f172a; margin: 0 0 4px;">Reset your password</h1>
        <p style="font-size: 13px; color: #64748b; margin: 0 0 24px;">আপনার পাসওয়ার্ড রিসেট করুন</p>

        <p style="font-size: 14px; color: #334155; line-height: 1.6;">
          Hi ${name}, use the code below to reset your password. It expires in 15 minutes.
        </p>

        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #0f172a; font-family: monospace;">${code}</span>
        </div>

        <p style="font-size: 12px; color: #94a3b8; line-height: 1.6;">
          If you did not request a password reset, you can safely ignore this email — your password will not change.
        </p>
      </div>
    `;

    return this.send(to, subject, html, text);
  }
}
