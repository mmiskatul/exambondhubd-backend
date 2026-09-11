import { Module } from '@nestjs/common';
import { AttemptsService } from './attempts.service';
import { AttemptsController } from './attempts.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ExamsModule } from '../exams/exams.module';

@Module({
  imports: [SubscriptionsModule, ExamsModule],
  controllers: [AttemptsController],
  providers: [AttemptsService],
  exports: [AttemptsService],
})
export class AttemptsModule {}
