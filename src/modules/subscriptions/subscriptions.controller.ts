import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Get all available subscription pricing plans' })
  async getPlans() {
    return this.subscriptionsService.getPlans();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Get('admin/plans')
  @ApiOperation({ summary: 'Get all subscription pricing plans including inactive (Admin)' })
  async getAllPlansAdmin() {
    return this.subscriptionsService.getAllPlansAdmin();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post('admin/plans')
  @ApiOperation({ summary: 'Create a new subscription pricing plan (Admin)' })
  async createPlan(@Body() body: any) {
    return this.subscriptionsService.createPlan(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Patch('admin/plans/:id')
  @ApiOperation({ summary: 'Update subscription plan pricing/status (Admin)' })
  async updatePlan(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.subscriptionsService.updatePlan(id, body);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get current user active subscription' })
  async getUserSubscription(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getUserSubscription(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('my-access')
  @ApiOperation({ summary: 'Which exams and units this student has paid access to' })
  async getMyAccess(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getMyAccess(userId);
  }

  @Public()
  @Get('plans/for')
  @ApiOperation({ summary: 'Packages that unlock a given exam portal or unit' })
  @ApiQuery({ name: 'portalKey', required: true })
  @ApiQuery({ name: 'unitKey', required: false })
  async getPlansFor(
    @Query('portalKey') portalKey: string,
    @Query('unitKey') unitKey?: string,
  ) {
    return this.subscriptionsService.getPlansFor(portalKey, unitKey);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Get('admin/plans/:id')
  @ApiOperation({ summary: 'One package with its scope and sales figures (Admin)' })
  async getPlan(@Param('id') id: string) {
    return this.subscriptionsService.getPlan(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete('admin/plans/:id')
  @ApiOperation({ summary: 'Delete a package that nobody has bought (Admin)' })
  async deletePlan(@Param('id') id: string) {
    return this.subscriptionsService.deletePlan(id);
  }
}
