import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  // Save device push token (Expo Push Token / FCM)
  async registerPushToken(userId: string, token: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token },
    });
  }

  // Get user notifications
  async getUserNotifications(userId: string) {
    return this.prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { notification: true },
      take: 30,
    });
  }

  // Mark notification as read
  async markAsRead(userId: string, notificationId: string) {
    return this.prisma.userNotification.updateMany({
      where: { userId, notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.userNotification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  // Broadcast push notification to all users or specific roles (Admin)
  /** Broadcast history for the admin console. */
  async getBroadcastHistory(limit = 20) {
    return this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 20, 100),
      select: {
        id: true,
        title: true,
        body: true,
        createdAt: true,
      },
    });
  }

  async broadcastNotification(data: {
    title: string;
    body: string;
    data?: any;
  }) {
    // 1. Create central notification record
    const notification = await this.prisma.notification.create({
      data: {
        title: data.title,
        body: data.body,
        data: data.data || {},
      },
    });

    // 2. Query active users with push tokens
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, fcmToken: true, pushNotificationsEnabled: true },
    });

    // 3. Link user notifications in database — everyone gets it in their
    // in-app notification center regardless of push preference; muting push
    // only skips the device notification, not the record itself.
    await this.prisma.userNotification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        notificationId: notification.id,
      })),
    });

    // 4. Send Push via Expo Push API / FCM — skip anyone who muted push.
    const tokens = users
      .filter((u) => u.pushNotificationsEnabled)
      .map((u) => u.fcmToken)
      .filter(Boolean) as string[];

    if (tokens.length > 0) {
      await this.sendExpoPushNotifications(tokens, data.title, data.body, data.data);
    }

    return {
      success: true,
      message: `Notification broadcasted to ${users.length} users (${tokens.length} push tokens dispatched).`,
      notificationId: notification.id,
    };
  }

  // Send Push Notification to single user
  async sendToUser(userId: string, title: string, body: string, payloadData?: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fcmToken: true, pushNotificationsEnabled: true },
    });

    const notification = await this.prisma.notification.create({
      data: { title, body, data: payloadData || {} },
    });

    await this.prisma.userNotification.create({
      data: {
        userId,
        notificationId: notification.id,
      },
    });

    if (user?.fcmToken && user.pushNotificationsEnabled) {
      await this.sendExpoPushNotifications([user.fcmToken], title, body, payloadData);
    }

    return { success: true };
  }

  // Get Push Notification Configuration & API Keys
  async getPushConfig() {
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'push_provider',
            'expo_access_token',
            'fcm_server_key',
            'fcm_project_id',
            'onesignal_app_id',
            'onesignal_api_key',
            'push_enabled',
          ],
        },
      },
    });

    const map = new Map(settings.map((s) => [s.key, s.value]));

    return {
      provider: map.get('push_provider') || 'EXPO',
      expoAccessToken: map.get('expo_access_token') || '',
      fcmServerKey: map.get('fcm_server_key') || '',
      fcmProjectId: map.get('fcm_project_id') || '',
      onesignalAppId: map.get('onesignal_app_id') || '',
      onesignalApiKey: map.get('onesignal_api_key') || '',
      isEnabled: map.get('push_enabled') !== 'false',
    };
  }

  // Update Push Notification Configuration & API Keys
  async updatePushConfig(data: {
    provider?: string;
    expoAccessToken?: string;
    fcmServerKey?: string;
    fcmProjectId?: string;
    onesignalAppId?: string;
    onesignalApiKey?: string;
    isEnabled?: boolean;
  }) {
    const updates: { key: string; value: string }[] = [];

    if (data.provider !== undefined) updates.push({ key: 'push_provider', value: data.provider });
    if (data.expoAccessToken !== undefined) updates.push({ key: 'expo_access_token', value: data.expoAccessToken });
    if (data.fcmServerKey !== undefined) updates.push({ key: 'fcm_server_key', value: data.fcmServerKey });
    if (data.fcmProjectId !== undefined) updates.push({ key: 'fcm_project_id', value: data.fcmProjectId });
    if (data.onesignalAppId !== undefined) updates.push({ key: 'onesignal_app_id', value: data.onesignalAppId });
    if (data.onesignalApiKey !== undefined) updates.push({ key: 'onesignal_api_key', value: data.onesignalApiKey });
    if (data.isEnabled !== undefined) updates.push({ key: 'push_enabled', value: String(data.isEnabled) });

    for (const item of updates) {
      await this.prisma.systemSetting.upsert({
        where: { key: item.key },
        update: { value: item.value },
        create: { key: item.key, value: item.value },
      });
    }

    return {
      success: true,
      message: 'Push notification configuration updated successfully in database.',
    };
  }

  // Test Push Notification Dispatch
  async testPushNotification(data: { title?: string; body?: string }) {
    const title = data.title || 'ExamBondhuBD Test Ping 🔔';
    const body = data.body || 'This is a test push notification to verify your API credentials.';

    // Send to active users or log delivery
    const result = await this.broadcastNotification({
      title,
      body,
      data: { type: 'TEST_PING', timestamp: Date.now() },
    });

    return {
      success: true,
      message: `Test push sent! ${result.message}`,
    };
  }

  // Expo Push API Dispatcher
  private async sendExpoPushNotifications(tokens: string[], title: string, body: string, data?: any) {
    try {
      const config = await this.getPushConfig();
      if (!config.isEnabled) {
        this.logger.log('Push notifications are currently disabled in settings.');
        return;
      }

      const messages = tokens.map((token) => ({
        to: token,
        sound: 'default',
        title,
        body,
        data,
      }));

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      };

      if (config.expoAccessToken) {
        headers['Authorization'] = `Bearer ${config.expoAccessToken}`;
      }

      // Send to Expo Push Notification API
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      });

      const json = await res.json();
      this.logger.log(`⚡ Push notifications dispatched: ${JSON.stringify(json.data?.[0]?.status || 'OK')}`);
    } catch (err: any) {
      this.logger.warn(`Push delivery notice: ${err.message}`);
    }
  }
}
