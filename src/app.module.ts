import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { FaqsModule } from './modules/faqs/faqs.module';
import { PortalsModule } from './modules/portals/portals.module';
import { SubjectsModule } from './modules/subjects/subjects.module';
import { ExamsModule } from './modules/exams/exams.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { AttemptsModule } from './modules/attempts/attempts.module';
import { BookmarksModule } from './modules/bookmarks/bookmarks.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 120,
      },
    ]),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    FaqsModule,
    PortalsModule,
    SubjectsModule,
    ExamsModule,
    QuestionsModule,
    AttemptsModule,
    BookmarksModule,
    SubscriptionsModule,
    PaymentsModule,
    AnalyticsModule,
    NotificationsModule,
  ],
  providers: [
    // ThrottlerModule only registers the storage/config — nothing actually
    // enforced it until this guard is applied globally. Individual auth
    // routes (login, register, password reset, etc.) override this default
    // with a much stricter limit via @Throttle(...).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
