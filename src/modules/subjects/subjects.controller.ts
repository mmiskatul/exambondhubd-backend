import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SubjectsService } from './subjects.service';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Subjects & Topics')
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get subjects with their owning exam portal and unit' })
  @ApiQuery({ name: 'portalKey', required: false })
  async findAll(@Query('portalKey') portalKey?: string) {
    return this.subjectsService.findAll(portalKey);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get subject details by ID' })
  async findOne(@Param('id') id: string) {
    return this.subjectsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Deprecated — create subjects via POST /portals/:key/subjects' })
  async createSubject() {
    return this.subjectsService.createSubject();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update subject (Admin/Editor)' })
  async updateSubject(@Param('id') id: string, @Body() body: any) {
    return this.subjectsService.updateSubject(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete subject (Admin). Refuses while questions exist unless force=true' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  async deleteSubject(@Param('id') id: string, @Query('force') force?: string) {
    return this.subjectsService.deleteSubject(id, force === 'true');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Post(':id/topics')
  @ApiOperation({ summary: 'Create a topic under subject' })
  async createTopic(@Param('id') subjectId: string, @Body() body: any) {
    return this.subjectsService.createTopic(subjectId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Patch('topics/:topicId')
  @ApiOperation({ summary: 'Update topic' })
  async updateTopic(@Param('topicId') topicId: string, @Body() body: any) {
    return this.subjectsService.updateTopic(topicId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete('topics/:topicId')
  @ApiOperation({ summary: 'Delete topic' })
  async deleteTopic(@Param('topicId') topicId: string) {
    return this.subjectsService.deleteTopic(topicId);
  }
}
