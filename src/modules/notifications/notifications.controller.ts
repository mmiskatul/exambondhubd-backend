import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Push Notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('token')
  @ApiOperation({ summary: 'Register user device push token (FCM / Expo Push Token)' })
  async registerPushToken(
    @CurrentUser('id') userId: string,
    @Body('token') token: string,
  ) {
    return this.notificationsService.registerPushToken(userId, token);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get in-app notifications for current user' })
  async getUserNotifications(@CurrentUser('id') userId: string) {
    return this.notificationsService.getUserNotifications(userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every in-app notification as read for the current user' })
  async markAllAsRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark in-app notification as read' })
  async markAsRead(
    @CurrentUser('id') userId: string,
    @Param('id') notificationId: string,
  ) {
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/history')
  @ApiOperation({ summary: 'Recently broadcast notifications (Admin)' })
  async getBroadcastHistory(@Query('limit') limit?: string) {
    return this.notificationsService.getBroadcastHistory(Number(limit) || 20);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/config')
  @ApiOperation({ summary: 'Get push notification API keys and configuration (Admin)' })
  async getPushConfig() {
    return this.notificationsService.getPushConfig();
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('admin/config')
  @ApiOperation({ summary: 'Update push notification API keys and settings (Admin)' })
  async updatePushConfig(@Body() body: any) {
    return this.notificationsService.updatePushConfig(body);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('admin/test')
  @ApiOperation({ summary: 'Send test push notification to verify credentials (Admin)' })
  async testPushNotification(@Body() body: { title?: string; body?: string }) {
    return this.notificationsService.testPushNotification(body);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('admin/broadcast')
  @ApiOperation({ summary: 'Broadcast push notification to examinees (Admin)' })
  async broadcastNotification(
    @Body() body: { title: string; body: string; data?: any },
  ) {
    return this.notificationsService.broadcastNotification(body);
  }
}
