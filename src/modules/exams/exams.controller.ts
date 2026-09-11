import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ExamsService } from './exams.service';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Exams')
@Controller('exams')
export class ExamsController {
  constructor(private readonly examsService: ExamsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all available exams' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'portalKey', required: false })
  @ApiQuery({ name: 'unitKey', required: false })
  @ApiQuery({ name: 'isPremium', required: false, type: Boolean })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @Query('categoryId') categoryId?: string,
    @Query('portalKey') portalKey?: string,
    @Query('unitKey') unitKey?: string,
    @Query('isPremium') isPremium?: string,
    @Query('search') search?: string,
  ) {
    return this.examsService.findAll({
      categoryId,
      portalKey,
      unitKey,
      isPremium: isPremium !== undefined ? isPremium === 'true' : undefined,
      isPublished: true,
      search,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Get('admin/all')
  @ApiOperation({ summary: 'Get all exams including drafts (Admin)' })
  async findAllAdmin(
    @Query('categoryId') categoryId?: string,
    @Query('portalKey') portalKey?: string,
    @Query('unitKey') unitKey?: string,
  ) {
    return this.examsService.findAll({ categoryId, portalKey, unitKey });
  }

  @Public()
  @Get('portal/:key')
  @ApiOperation({ summary: 'Live portal data (Units, Years, Subjects, Chapters, Model Tests)' })
  @ApiQuery({ name: 'unitKey', required: false })
  async getPortalDetails(@Param('key') key: string, @Query('unitKey') unitKey?: string) {
    return this.examsService.getPortalDetails(key, unitKey);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get exam details and blueprint by ID' })
  async findOne(@Param('id') id: string) {
    return this.examsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a new exam with blueprint (Admin)' })
  async create(@Body() body: any) {
    return this.examsService.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update exam and blueprint (Admin)' })
  async update(@Param('id') id: string, @Body() body: any) {
    return this.examsService.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete exam (Admin)' })
  async delete(@Param('id') id: string) {
    return this.examsService.delete(id);
  }
}
