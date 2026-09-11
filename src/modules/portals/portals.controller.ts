import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PortalsService } from './portals.service';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Exam Portals')
@Controller('portals')
export class PortalsController {
  constructor(private readonly portalsService: PortalsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all exam portals grouped as university / jobs' })
  async getPortals() {
    return this.portalsService.getPortals();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Save the whole portal hub layout (Admin)' })
  async updatePortals(@Body() body: any) {
    return this.portalsService.updatePortals(body);
  }

  // ---------------- Admission units ----------------

  @Public()
  @Get(':key/units')
  @ApiOperation({ summary: "This portal's admission units (DU ক/খ/গ/ঘ, JU A-E, …)" })
  async listUnits(@Param('key') key: string) {
    return this.portalsService.listUnits(key);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post(':key/units')
  @ApiOperation({ summary: 'Add an admission unit to this portal (Admin)' })
  async createUnit(@Param('key') key: string, @Body() body: any) {
    return this.portalsService.createUnit(key, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Patch(':key/units/:unitKey')
  @ApiOperation({ summary: 'Rename or reorder an admission unit (Admin)' })
  async updateUnit(
    @Param('key') key: string,
    @Param('unitKey') unitKey: string,
    @Body() body: any,
  ) {
    return this.portalsService.updateUnit(key, unitKey, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete(':key/units/:unitKey')
  @ApiOperation({ summary: 'Delete an admission unit (Admin). Guarded while it holds questions' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  async deleteUnit(
    @Param('key') key: string,
    @Param('unitKey') unitKey: string,
    @Query('force') force?: string,
  ) {
    return this.portalsService.deleteUnit(key, unitKey, force === 'true');
  }

  // ---------------- Syllabus ----------------

  @Public()
  @Get(':key/subjects')
  @ApiOperation({ summary: 'Subjects attached to this portal (or one unit), with live counts' })
  @ApiQuery({ name: 'unitKey', required: false })
  async listSubjects(@Param('key') key: string, @Query('unitKey') unitKey?: string) {
    return this.portalsService.listSubjects(key, unitKey);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Post(':key/subjects')
  @ApiOperation({ summary: 'Attach a subject to this portal (Admin)' })
  @ApiQuery({ name: 'unitKey', required: false })
  async addSubject(
    @Param('key') key: string,
    @Body() body: any,
    @Query('unitKey') unitKey?: string,
  ) {
    return this.portalsService.addSubject(key, body, body.unitKey || unitKey);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Post(':key/subjects/copy')
  @ApiOperation({ summary: 'Copy a whole syllabus (subjects + chapters) from another scope' })
  async copySubjects(
    @Param('key') key: string,
    @Body() body: { fromPortalKey?: string; fromUnitKey?: string; unitKey?: string },
  ) {
    return this.portalsService.copySubjects(key, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Patch(':key/subjects/:subjectId')
  @ApiOperation({ summary: 'Update a subject marks weight / order inside this portal (Admin)' })
  async updateSubject(
    @Param('key') key: string,
    @Param('subjectId') subjectId: string,
    @Body() body: { marks?: number | null; sortOrder?: number },
  ) {
    return this.portalsService.updateSubject(key, subjectId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Delete(':key/subjects/:subjectId')
  @ApiOperation({ summary: 'Detach a subject from this portal (Admin)' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  async removeSubject(
    @Param('key') key: string,
    @Param('subjectId') subjectId: string,
    @Query('force') force?: string,
  ) {
    return this.portalsService.removeSubject(key, subjectId, force === 'true');
  }

  @Public()
  @Get(':key/years')
  @ApiOperation({ summary: 'Question paper years for this portal or unit, with live counts' })
  @ApiQuery({ name: 'unitKey', required: false })
  async listYears(@Param('key') key: string, @Query('unitKey') unitKey?: string) {
    return this.portalsService.listYears(key, unitKey);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.QUESTION_EDITOR)
  @ApiBearerAuth()
  @Post(':key/years')
  @ApiOperation({ summary: 'Register a question paper year for this portal (Admin)' })
  @ApiQuery({ name: 'unitKey', required: false })
  async addYear(
    @Param('key') key: string,
    @Body() body: { year: number; durationMinutes?: number; totalMarks?: number; unitKey?: string },
    @Query('unitKey') unitKey?: string,
  ) {
    return this.portalsService.addYear(
      key,
      body.year,
      body.durationMinutes,
      body.totalMarks,
      body.unitKey || unitKey,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete(':key/years/:year')
  @ApiOperation({ summary: 'Remove an empty question paper year (Admin)' })
  @ApiQuery({ name: 'unitKey', required: false })
  async removeYear(
    @Param('key') key: string,
    @Param('year') year: string,
    @Query('unitKey') unitKey?: string,
  ) {
    return this.portalsService.removeYear(key, Number(year), unitKey);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Post('create')
  @ApiOperation({ summary: 'Create a single new exam portal (Admin)' })
  async createPortal(@Body() body: any) {
    return this.portalsService.createPortal(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Patch(':key')
  @ApiOperation({ summary: 'Update a single exam portal, e.g. its app visibility (Admin)' })
  async updatePortal(@Param('key') key: string, @Body() body: any) {
    return this.portalsService.updatePortal(key, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @Delete(':key')
  @ApiOperation({ summary: 'Delete a portal and everything linked to it (Super Admin)' })
  async deletePortal(@Param('key') key: string) {
    return this.portalsService.deletePortal(key);
  }
}
