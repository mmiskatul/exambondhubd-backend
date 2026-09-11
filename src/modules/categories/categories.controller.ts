import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Categories & Exam Portals')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get('portals')
  @ApiOperation({ summary: 'Get all dynamic exam portals (University & Job)' })
  async getPortals() {
    return this.categoriesService.getPortals();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post('portals')
  @ApiOperation({ summary: 'Update dynamic exam portals configuration (Admin)' })
  async updatePortals(@Body() body: any) {
    return this.categoriesService.updatePortals(body);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all active examination categories' })
  async findAll(@Query('includeExams') includeExams?: string) {
    return this.categoriesService.findAll(includeExams === 'true');
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get category by slug with exams and blueprint' })
  async findBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create new category (Admin)' })
  async create(@Body() body: any) {
    return this.categoriesService.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update category (Admin)' })
  async update(@Param('id') id: string, @Body() body: any) {
    return this.categoriesService.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete category (Admin)' })
  async delete(@Param('id') id: string) {
    return this.categoriesService.delete(id);
  }
}
