import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { TemporaryAccessService } from './temporary-access.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [UsersController],
  providers: [UsersService, TemporaryAccessService],
  exports: [UsersService, TemporaryAccessService],
})
export class UsersModule {}
