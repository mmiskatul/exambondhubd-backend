import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { TemporaryAccessService, GRANTABLE_ROLES } from './temporary-access.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, UserStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly tempAccess: TemporaryAccessService,
  ) {}

  // ---------------- Temporary console access ----------------

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('admin/temporary')
  @ApiOperation({ summary: 'List issued temporary console credentials (Super Admin)' })
  async listTemporary() {
    return this.tempAccess.list();
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('admin/temporary/roles')
  @ApiOperation({ summary: 'Roles that may be granted temporarily' })
  async grantableRoles() {
    return GRANTABLE_ROLES;
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Post('admin/temporary')
  @ApiOperation({ summary: 'Issue a time-limited email + password (Super Admin)' })
  async createTemporary(
    @Body() body: { role?: string; expiresInHours?: number; note?: string },
    @CurrentUser('id') issuedById?: string,
  ) {
    return this.tempAccess.create(body, issuedById);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Patch('admin/temporary/:id/extend')
  @ApiOperation({ summary: 'Extend a temporary access window (Super Admin)' })
  async extendTemporary(@Param('id') id: string, @Body('hours') hours: number) {
    return this.tempAccess.extend(id, hours);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Patch('admin/temporary/:id/revoke')
  @ApiOperation({ summary: 'End a temporary access immediately (Super Admin)' })
  async revokeTemporary(@Param('id') id: string) {
    return this.tempAccess.revoke(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Delete('admin/temporary/expired')
  @ApiOperation({ summary: 'Clear long-expired access records (Super Admin)' })
  async purgeTemporary() {
    return this.tempAccess.purgeExpired();
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Delete('admin/temporary/:id')
  @ApiOperation({ summary: 'Delete a temporary access record (Super Admin)' })
  async deleteTemporary(@Param('id') id: string) {
    return this.tempAccess.remove(id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile and exam statistics' })
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your own name/phone/push notification preference' })
  async updateOwnProfile(
    @CurrentUser('id') userId: string,
    @Body() body: { name?: string; phone?: string; pushNotificationsEnabled?: boolean },
  ) {
    return this.usersService.updateOwnProfile(userId, body);
  }

  @Delete('me')
  @ApiOperation({ summary: 'Delete your own account (requires your password, if you have one)' })
  async deleteOwnAccount(@CurrentUser('id') userId: string, @Body('password') password?: string) {
    return this.usersService.deleteOwnAccount(userId, password);
  }

  @Get('me/referrals')
  @ApiOperation({ summary: 'Your referral code and how many signups/rewards it has earned' })
  async getMyReferrals(@CurrentUser('id') userId: string) {
    return this.usersService.getMyReferrals(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/all')
  @ApiOperation({ summary: 'Get all users with search and pagination (Admin)' })
  @ApiQuery({ name: 'group', required: false, enum: ['students', 'staff', 'all'] })
  async getAllUsers(@Query() query: any) {
    return this.usersService.getAllUsers(query);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('admin/:id/status')
  @ApiOperation({ summary: 'Activate or suspend user account (Admin)' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: UserStatus,
    @CurrentUser('id') actingUserId?: string,
  ) {
    return this.usersService.updateUserStatus(id, status, actingUserId);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/:id')
  @ApiOperation({ summary: 'One user with their full activity history (Admin)' })
  async getUserDetail(@Param('id') id: string) {
    return this.usersService.getUserDetail(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('admin/:id/verify-email')
  @ApiOperation({ summary: "Manually mark a student's email verified (Admin)" })
  async verifyEmailAdmin(@Param('id') id: string) {
    return this.usersService.adminVerifyEmail(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('admin/:id/resend-verification')
  @ApiOperation({ summary: "Resend a student's verification code, bypassing the cooldown (Admin)" })
  async resendVerificationAdmin(@Param('id') id: string) {
    return this.usersService.adminResendVerification(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Delete('admin/:id')
  @ApiOperation({ summary: 'Delete a user and all of their activity (Admin)' })
  async deleteUser(@Param('id') id: string, @CurrentUser('id') actingUserId?: string) {
    return this.usersService.deleteUser(id, actingUserId);
  }
}
