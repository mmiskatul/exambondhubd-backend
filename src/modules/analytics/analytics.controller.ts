import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Get('dashboard')
  @ApiOperation({ summary: 'Get overview KPI metrics, revenue, and trends (Admin)' })
  async getDashboardMetrics() {
    return this.analyticsService.getAdminDashboardMetrics();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Get('user-growth')
  @ApiOperation({ summary: 'Daily registrations and running total (Admin)' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async getUserGrowth(@Query('days') days?: string) {
    return this.analyticsService.getUserGrowth(days ? Number(days) : 30);
  }
}
