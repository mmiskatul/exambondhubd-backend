import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SyncUserDto, AdminLoginDto } from './dto/sync-user.dto';
import { Public } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

// The app-wide default (120 req/min, set in AppModule) is fine for normal
// browsing but far too loose for anything that guesses a password or spams
// a code — 120 login attempts/min from one IP is still ~172k/day. Every
// route below that touches a password or a one-time code gets this instead:
// still well past what any real user needs (15/day for the median student
// hits the ceiling), but 21,600/day is nowhere near enough to brute-force a
// real password or a bcrypt-hashed 6-digit code within its own 15-minute
// lifetime.
const AUTH_THROTTLE = { default: { limit: 15, ttl: 60_000 } };

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Create a student account (sends an email verification code)' })
  async register(@Body() dto: any) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify-email')
  @ApiOperation({ summary: 'Confirm the code sent by /register or /resend-verification' })
  async verifyEmail(@Body() dto: any) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('resend-verification')
  @ApiOperation({ summary: 'Send a fresh verification code (rate-limited)' })
  async resendVerification(@Body() dto: any) {
    return this.authService.resendVerification(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset code by email' })
  async forgotPassword(@Body() dto: any) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @ApiOperation({ summary: 'Confirm a reset code and set a new password' })
  async resetPassword(@Body() dto: any) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @ApiOperation({ summary: 'Student sign-in with email and password' })
  async login(@Body() dto: any) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('google')
  @ApiOperation({ summary: 'Sign in with a Google account verified through Supabase' })
  async google(@Body() dto: any) {
    return this.authService.googleSignIn(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('admin-login')
  @ApiOperation({ summary: 'Admin login for management dashboard' })
  async adminLogin(@Body() dto: AdminLoginDto) {
    return this.authService.adminLogin(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('change-password')
  @ApiOperation({ summary: 'Change user/admin password by verifying old password' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(userId, body.oldPassword, body.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get currently authenticated user profile' })
  async getMe(@CurrentUser('id') userId: string) {
    // Loaded here rather than on every authenticated request.
    return this.authService.getFullUser(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a valid token for a fresh one' })
  async refresh(@CurrentUser('id') userId: string) {
    return this.authService.refreshSession(userId);
  }
}
