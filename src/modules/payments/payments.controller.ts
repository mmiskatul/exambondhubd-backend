import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, PaymentProvider, PaymentStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Payments & Manual Verification')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Get('instructions')
  @ApiOperation({ summary: 'Get bKash/Nagad/Rocket account numbers for student Send Money' })
  getPaymentInstructions() {
    return this.paymentsService.getPaymentInstructions();
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('manual-submit')
  @ApiOperation({ summary: 'Student submits manual TrxID and phone number verification' })
  async submitManualPayment(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      planId: string;
      provider: PaymentProvider;
      senderNumber: string;
      transactionId: string;
      amount: number;
      notes?: string;
    },
  ) {
    return this.paymentsService.submitManualPayment(userId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post('admin/numbers')
  @ApiOperation({ summary: 'Admin updates bKash/Nagad/Rocket receiver numbers in database' })
  async updatePaymentNumbers(
    @Body()
    body: {
      bkashNumber?: string;
      nagadNumber?: string;
      rocketNumber?: string;
      bkashType?: string;
      nagadType?: string;
      rocketType?: string;
    },
  ) {
    return this.paymentsService.updatePaymentNumbers(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Get('admin/pending')
  @ApiOperation({ summary: 'Get all pending manual payment verification requests (Admin)' })
  async getPendingManualPayments() {
    return this.paymentsService.getPendingManualPayments();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Get('admin/all')
  @ApiOperation({ summary: 'Get all payments with search and status filters (Admin)' })
  async getAllPayments(
    @Query('status') status?: PaymentStatus,
    @Query('provider') provider?: PaymentProvider,
    @Query('search') search?: string,
  ) {
    return this.paymentsService.getAllPayments({ status, provider, search });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post('admin/:id/approve')
  @ApiOperation({ summary: 'Admin approves TrxID and activates student subscription' })
  async approveManualPayment(@Param('id') paymentId: string) {
    return this.paymentsService.approveManualPayment(paymentId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post('admin/:id/reject')
  @ApiOperation({ summary: 'Admin rejects TrxID with reason' })
  async rejectManualPayment(
    @Param('id') paymentId: string,
    @Body('reason') reason?: string,
  ) {
    return this.paymentsService.rejectManualPayment(paymentId, reason);
  }
}
