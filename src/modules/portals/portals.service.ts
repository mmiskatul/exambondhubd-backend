import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PortalGroup } from '@prisma/client';
import { SubjectsService } from '../subjects/subjects.service';

/**
 * Exam Portals are the cards on the mobile home screen (DU, Medical & Dental,
 * BCS ...). Every question, model test, subject and year is hard-linked to a
 * Portal row by foreign key, so content created under one portal can never
 * show up under another.
 */
@Injectable()
export class PortalsService {
  constructor(
    private prisma: PrismaService,
    private subjectsService: SubjectsService,
  ) {}

  /**
   * PlanScope cascades away with a deleted Portal, but the SubscriptionPlan
   * that owned it does not — a package scoped only to portals being removed
   * would survive with zero scopes left, which every access check reads as
   * "unlocks everything" (see subscriptions.service.ts). Called before any
   * portal delete so that never happens; a plan that also covers a portal
   * outside this list is left alone.
   */
  private async deletePlansOrphanedByPortals(portalIds: string[]) {
    if (portalIds.length === 0) return;

    const scopedPlanIds = await this.prisma.planScope.findMany({
      where: { portalId: { in: portalIds } },
      select: { planId: true },
      distinct: ['planId'],
    });

    for (const { planId } of scopedPlanIds) {
      const survivingScopes = await this.prisma.planScope.count({
        where: { planId, portalId: { notIn: portalIds } },
      });
      if (survivingScopes === 0) {
        await this.prisma.planScope.deleteMany({ where: { planId } });
        await this.prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
      }
    }
  }

  private toDto(portal: any) {
    return {
      id: portal.id,
      key: portal.key,
      title: portal.titleEn,
      titleEn: portal.titleEn,
      bn: portal.titleBn,
      titleBn: portal.titleBn,
      icon: portal.icon,
      badge: portal.badge,
      color: portal.color,
      group: portal.group,
      isEnabled: portal.isEnabled,
      sortOrder: portal.sortOrder,
      // Units travel with the portal so clients can label ক/খ/গ/ঘ immediately
      // instead of waiting on a second request per portal.
      units: (portal.units || []).map((u: any) => ({
        id: u.id,
        key: u.key,
        titleEn: u.titleEn,
        titleBn: u.titleBn,
        badge: u.badge,
        isEnabled: u.isEnabled,
        sortOrder: u.sortOrder,
        questionCount: u._count?.questions ?? 0,
      })),
      hasUnits: (portal.units || []).length > 0,
    };
  }

  /** Resolve a portal by its public key. Throws when the key is unknown. */
  async resolveByKey(key: string) {
    const portal = await this.findByKey(key);

    if (!portal) {
      throw new NotFoundException(
        `Exam portal '${decodeURIComponent(key || '').trim()}' does not exist. Create it in the App Portals Hub first.`,
      );
    }

    return portal;
  }

  /** Same as resolveByKey but returns null instead of throwing. */
  async findByKey(key: string) {
    const searchKey = decodeURIComponent(key || '').trim();
    if (!searchKey) return null;

    return this.prisma.portal.findFirst({
      where: { key: { equals: searchKey, mode: 'insensitive' } },
    });
  }

  /** Grouped payload consumed by the mobile home screen and the admin hub. */
  async getPortals() {
    const portals = await this.prisma.portal.findMany({
      orderBy: [{ sortOrder: 'asc' }, { titleEn: 'asc' }],
      include: {
        units: {
          orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
          include: { _count: { select: { questions: true } } },
        },
      },
    });

    return {
      university: portals
        .filter((p) => p.group === PortalGroup.UNIVERSITY)
        .map((p) => this.toDto(p)),
      jobs: portals
        .filter((p) => p.group === PortalGroup.JOBS)
        .map((p) => this.toDto(p)),
    };
  }

  /**
   * Persist the whole hub layout. Portals are matched on `key`, so renaming a
   * title keeps every linked question; removing a card from the payload
   * deletes that portal and cascades to its questions.
   */
  async updatePortals(data: { university?: any[]; jobs?: any[] }) {
    const incoming = [
      ...(data.university || []).map((p, idx) => ({ ...p, group: PortalGroup.UNIVERSITY, sortOrder: idx })),
      ...(data.jobs || []).map((p, idx) => ({ ...p, group: PortalGroup.JOBS, sortOrder: idx })),
    ].filter((p) => p && typeof p.key === 'string' && p.key.trim().length > 0);

    if (incoming.length === 0) {
      throw new BadRequestException('Refusing to save an empty portal configuration.');
    }

    for (const p of incoming) {
      const payload = {
        titleEn: p.title || p.titleEn || p.key,
        titleBn: p.bn || p.titleBn || p.title || p.key,
        icon: p.icon || null,
        badge: p.badge || null,
        color: p.color || null,
        group: p.group,
        isEnabled: p.isEnabled !== false,
        sortOrder: p.sortOrder,
      };

      await this.prisma.portal.upsert({
        where: { key: p.key.trim() },
        update: payload,
        create: { key: p.key.trim(), ...payload },
      });
    }

    const keptKeys = incoming.map((p) => p.key.trim());
    const droppedPortalIds = (
      await this.prisma.portal.findMany({
        where: { key: { notIn: keptKeys } },
        select: { id: true },
      })
    ).map((p) => p.id);

    await this.deletePlansOrphanedByPortals(droppedPortalIds);
    await this.prisma.portal.deleteMany({ where: { key: { notIn: keptKeys } } });

    return {
      success: true,
      message: 'Exam portals updated. The mobile app picks this up on next refresh.',
      data: await this.getPortals(),
    };
  }

  async createPortal(data: any) {
    const key = String(data?.key || '').trim();

    if (!key) {
      throw new BadRequestException('An exam key is required (for example "DU" or "JU").');
    }

    const clash = await this.prisma.portal.findFirst({
      where: { key: { equals: key, mode: 'insensitive' } },
    });

    if (clash) {
      throw new BadRequestException(
        `An exam portal with the key '${clash.key}' already exists (${clash.titleEn}).`,
      );
    }

    // New cards go to the end of their own group.
    const group = data.group === 'JOBS' ? PortalGroup.JOBS : PortalGroup.UNIVERSITY;
    const existing = await this.prisma.portal.count({ where: { group } });

    const created = await this.prisma.portal.create({
      data: {
        key,
        titleEn: data.title || data.titleEn || key,
        titleBn: data.bn || data.titleBn || data.title || key,
        icon: data.icon || null,
        badge: data.badge || null,
        color: data.color || 'bg-slate-50 border-slate-200 text-slate-800',
        group,
        isEnabled: data.isEnabled !== false,
        sortOrder: data.sortOrder === undefined ? existing : Number(data.sortOrder),
      },
    });

    const message = `${created.titleEn} added and live on the app.`;
    return { success: true, message, data: { message, portal: this.toDto({ ...created, units: [] }) } };
  }

  /**
   * Update one portal in place. Used by the visibility toggle, which persists
   * on click rather than waiting for a separate Save.
   */
  async updatePortal(key: string, data: any) {
    const portal = await this.resolveByKey(key);

    const payload: any = {};
    if (data.title !== undefined || data.titleEn !== undefined) {
      payload.titleEn = data.title ?? data.titleEn;
    }
    if (data.bn !== undefined || data.titleBn !== undefined) {
      payload.titleBn = data.bn ?? data.titleBn;
    }
    if (data.icon !== undefined) payload.icon = data.icon || null;
    if (data.badge !== undefined) payload.badge = data.badge || null;
    if (data.color !== undefined) payload.color = data.color || null;
    if (data.isEnabled !== undefined) payload.isEnabled = Boolean(data.isEnabled);
    if (data.sortOrder !== undefined) payload.sortOrder = Number(data.sortOrder);

    const updated = await this.prisma.portal.update({
      where: { id: portal.id },
      data: payload,
    });

    const message =
      data.isEnabled === undefined
        ? `${updated.titleEn} updated.`
        : `${updated.titleEn} is now ${updated.isEnabled ? 'visible on the app' : 'hidden from the app'}.`;

    return { success: true, message, data: { message, portal: this.toDto({ ...updated, units: [] }) } };
  }

  async deletePortal(key: string) {
    const portal = await this.resolveByKey(key);
    await this.deletePlansOrphanedByPortals([portal.id]);

    // deleteMany reports a count rather than raising P2025 when the row is
    // already gone, so two concurrent deletes cannot fail as a database error.
    const removed = await this.prisma.portal.deleteMany({ where: { id: portal.id } });
    if (removed.count === 0) {
      throw new NotFoundException('That exam portal has already been deleted.');
    }

    const message = `Portal '${portal.key}' and all its content were removed.`;
    return { success: true, message, data: { message, key: portal.key } };
  }


  // ---------------------------------------------------------------
  // Admission units: DU's ক/খ/গ/ঘ, JU's A-E, RU's A-C, CU's A-D.
  // A unit is a hard sub-scope of a portal — questions, papers and
  // syllabus filed under ক unit never surface under ঘ unit.
  // ---------------------------------------------------------------

  /**
   * Resolves a unit key inside a portal. Returns null when no unit was asked
   * for, which means "the whole portal, every unit".
   */
  async resolveUnit(portalId: string, unitKey?: string | null) {
    const key = decodeURIComponent(unitKey || '').trim();
    if (!key || key.toUpperCase() === 'ALL') return null;

    const unit = await this.prisma.portalUnit.findFirst({
      where: { portalId, key: { equals: key, mode: 'insensitive' } },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit '${key}' does not exist in this exam portal. Add it under Portal Configuration first.`,
      );
    }

    return unit;
  }

  /**
   * The where-clause fragment every unit-aware query shares. With a unit it
   * pins `unitId`; without one it stays at portal level.
   */
  scopeFilter(portalId: string, unitId?: string | null) {
    return unitId ? { portalId, unitId } : { portalId };
  }


  /**
   * Once a portal has units, CONTENT filed under it must name one — otherwise a
   * question would sit at portal level, visible under "All Units" but under
   * none of ক/খ/গ/ঘ.
   *
   * Syllabus rows are deliberately exempt: a portal-level subject list is the
   * shared default that every unit inherits until it is given its own.
   */
  async requireUnitWhenPresent(portalId: string, unit: { id: string } | null, what = 'content') {
    if (unit) return;

    const units = await this.prisma.portalUnit.findMany({
      where: { portalId },
      orderBy: [{ sortOrder: 'asc' }],
      select: { key: true, titleBn: true },
    });

    if (units.length === 0) return;

    const names = units.map((u) => `${u.titleBn} (${u.key})`).join(', ');
    throw new BadRequestException(
      `This exam portal is split into units, so ${what} must be filed under one of them: ${names}.`,
    );
  }



  /**
   * Registers a paper year, tolerating concurrent callers.
   *
   * Saving several questions for a brand-new year at once makes each of them
   * register the same PortalYear row. Prisma's upsert is not atomic against the
   * unique index, so all but one lost the race with P2002 — handled, but it
   * logged a database error per question. createMany with skipDuplicates lets
   * the database resolve the conflict itself, so the race never raises at all.
   */
  async ensurePortalYear(portalId: string, unitId: string | null, year: number) {
    const parsedYear = Number(year);
    if (!parsedYear) return;

    const unitScope = unitId || '';

    await this.prisma.portalYear.createMany({
      data: [{ portalId, unitId, unitScope, year: parsedYear }],
      skipDuplicates: true,
    });
  }

  async listUnits(key: string) {
    const portal = await this.resolveByKey(key);
    return this.buildUnits(portal.id);
  }

  async buildUnits(portalId: string) {
    const [units, counts] = await Promise.all([
      this.prisma.portalUnit.findMany({
        where: { portalId },
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      }),
      this.prisma.question.groupBy({
        by: ['unitId'],
        where: { portalId, unitId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const countByUnit = new Map<string, number>();
    counts.forEach((row) => {
      if (row.unitId) countByUnit.set(row.unitId, row._count._all);
    });

    return units.map((u) => ({
      id: u.id,
      key: u.key,
      titleEn: u.titleEn,
      titleBn: u.titleBn,
      badge: u.badge,
      isEnabled: u.isEnabled,
      sortOrder: u.sortOrder,
      questionCount: countByUnit.get(u.id) || 0,
    }));
  }

  async createUnit(key: string, data: any) {
    const portal = await this.resolveByKey(key);
    const unitKey = String(data?.key || '').trim();

    if (!unitKey) {
      throw new BadRequestException('A unit key is required (for example "KA" or "A").');
    }

    const clash = await this.prisma.portalUnit.findFirst({
      where: { portalId: portal.id, key: { equals: unitKey, mode: 'insensitive' } },
    });

    if (clash) {
      throw new BadRequestException(`${portal.titleEn} already has a '${unitKey}' unit.`);
    }

    const existing = await this.prisma.portalUnit.count({ where: { portalId: portal.id } });

    const unit = await this.prisma.portalUnit.create({
      data: {
        portalId: portal.id,
        key: unitKey,
        titleEn: data.titleEn || unitKey,
        titleBn: data.titleBn || data.titleEn || unitKey,
        badge: data.badge || null,
        isEnabled: data.isEnabled !== false,
        sortOrder: data.sortOrder === undefined ? existing : Number(data.sortOrder),
      },
    });

    const message = `${unit.titleBn} added to ${portal.titleEn}.`;
    return { success: true, message, data: { message, unit } };
  }

  async updateUnit(key: string, unitKey: string, data: any) {
    const portal = await this.resolveByKey(key);
    const unit = await this.resolveUnit(portal.id, unitKey);

    if (!unit) throw new NotFoundException(`Unit '${unitKey}' not found.`);

    const { key: nextKey, id: _ignored, portalId: _p, ...rest } = data;

    if (nextKey && String(nextKey).trim() !== unit.key) {
      const clash = await this.prisma.portalUnit.findFirst({
        where: {
          portalId: portal.id,
          key: { equals: String(nextKey).trim(), mode: 'insensitive' },
          id: { not: unit.id },
        },
      });
      if (clash) throw new BadRequestException(`'${nextKey}' is already used by another unit.`);
      rest.key = String(nextKey).trim();
    }

    if (rest.sortOrder !== undefined) rest.sortOrder = Number(rest.sortOrder);

    return this.prisma.portalUnit.update({ where: { id: unit.id }, data: rest });
  }

  /** Deleting a unit takes its questions with it, so it is guarded. */
  async deleteUnit(key: string, unitKey: string, force = false) {
    const portal = await this.resolveByKey(key);
    const unit = await this.resolveUnit(portal.id, unitKey);

    if (!unit) throw new NotFoundException(`Unit '${unitKey}' not found.`);

    const questionCount = await this.prisma.question.count({
      where: { portalId: portal.id, unitId: unit.id },
    });

    if (questionCount > 0 && !force) {
      throw new BadRequestException(
        `'${unit.titleEn}' still holds ${questionCount} question(s). ` +
          'Delete them first, or confirm a forced delete.',
      );
    }

    // deleteMany reports a count rather than raising P2025 when the row is
    // already gone, so two concurrent deletes cannot fail as a database error.
    const removed = await this.prisma.portalUnit.deleteMany({ where: { id: unit.id } });
    if (removed.count === 0) {
      throw new NotFoundException('That unit has already been deleted.');
    }

    const message =
      `Deleted unit '${unit.titleEn}' from ${portal.titleEn}` +
      (questionCount > 0 ? ` along with ${questionCount} question(s).` : '.');

    return { success: true, message, data: { message, deletedQuestions: questionCount } };
  }

  // ---------------------------------------------------------------
  // Subjects. Each one belongs to exactly one exam portal, and to one
  // admission unit inside it when the portal has units. Nothing is
  // shared between exams — DU's Bangla and BCS's Bangla are separate
  // rows with separate chapters.
  // ---------------------------------------------------------------

  async listSubjects(key: string, unitKey?: string) {
    const portal = await this.resolveByKey(key);
    const unit = await this.resolveUnit(portal.id, unitKey);
    return this.buildSubjects(portal.id, unit?.id ?? null);
  }

  async buildSubjects(portalId: string, unitId: string | null = null) {
    // With no unit selected on a portal that has them, show every unit's
    // syllabus together as a read-only overview — otherwise "All Units" would
    // look empty, since subjects live at unit level.
    const unitCount = unitId
      ? 0
      : await this.prisma.portalUnit.count({ where: { portalId } });

    const where =
      !unitId && unitCount > 0
        ? { portalId }
        : { portalId, unitScope: unitId || '' };

    const rows = await this.prisma.subject.findMany({
      where,
      orderBy: [{ unitScope: 'asc' }, { sortOrder: 'asc' }, { titleEn: 'asc' }],
      include: {
        unit: { select: { id: true, key: true, titleEn: true, titleBn: true } },
        topics: {
          orderBy: { titleEn: 'asc' },
          include: { _count: { select: { questions: true } } },
        },
        _count: { select: { questions: true } },
      },
    });

    if (rows.length === 0) return [];

    const subjectIds = rows.map((r) => r.id);

    const [byDifficulty, byYear] = await Promise.all([
      this.prisma.question.groupBy({
        by: ['subjectId', 'difficulty'],
        where: { subjectId: { in: subjectIds } },
        _count: { _all: true },
      }),
      this.prisma.question.groupBy({
        by: ['subjectId', 'year'],
        where: { subjectId: { in: subjectIds }, year: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const difficultyBySubject = new Map<string, Record<string, number>>();
    byDifficulty.forEach((row) => {
      const bucket = difficultyBySubject.get(row.subjectId) || {};
      bucket[row.difficulty] = row._count._all;
      difficultyBySubject.set(row.subjectId, bucket);
    });

    const yearsBySubject = new Map<string, { year: number; count: number }[]>();
    byYear.forEach((row) => {
      if (row.year === null) return;
      const bucket = yearsBySubject.get(row.subjectId) || [];
      bucket.push({ year: row.year, count: row._count._all });
      yearsBySubject.set(row.subjectId, bucket);
    });

    return rows.map((row) => ({
      ...row,
      // True when this row is only being shown as part of the all-units
      // overview; it is owned by the unit named on it.
      fromUnit: Boolean(!unitId && row.unitId),
      stats: {
        questionsInPortal: row._count.questions,
        questionsEverywhere: row._count.questions,
        chapterCount: row.topics.length,
        chaptersWithQuestions: row.topics.filter((t) => t._count.questions > 0).length,
        difficulty: difficultyBySubject.get(row.id) || {},
        years: (yearsBySubject.get(row.id) || []).sort((a, b) => b.year - a.year),
      },
    }));
  }

  /** Creates a subject that belongs to this exam (and unit). */
  async addSubject(key: string, data: any, unitKey?: string) {
    const portal = await this.resolveByKey(key);
    const unit = await this.resolveUnit(portal.id, unitKey);

    await this.requireUnitWhenPresent(portal.id, unit, 'a subject');

    const titleEn = String(data?.titleEn || '').trim();
    if (!titleEn) throw new BadRequestException('An English subject title is required.');

    const code = String(data?.code || titleEn)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);

    if (!code) throw new BadRequestException('Could not derive a subject code from that title.');

    const scope = unit?.id || '';
    const scopeName = unit ? `${portal.titleEn} ${unit.titleBn}` : portal.titleEn;

    const clash = await this.prisma.subject.findFirst({
      where: { portalId: portal.id, unitScope: scope, code },
    });

    if (clash) {
      throw new BadRequestException(
        `${scopeName} already has a subject with the code '${code}' (${clash.titleEn}).`,
      );
    }

    const existing = await this.prisma.subject.count({
      where: { portalId: portal.id, unitScope: scope },
    });

    const subject = await this.prisma.subject.create({
      data: {
        portalId: portal.id,
        unitId: unit?.id ?? null,
        unitScope: scope,
        titleEn,
        titleBn: String(data?.titleBn || titleEn).trim(),
        code,
        icon: data?.icon || null,
        marks:
          data?.marks === undefined || data?.marks === null || data?.marks === ''
            ? null
            : Number(data.marks),
        sortOrder: data?.sortOrder === undefined ? existing : Number(data.sortOrder),
      },
      include: { topics: true, _count: { select: { questions: true } } },
    });

    const message = `${subject.titleEn} added to ${scopeName}.`;
    return { success: true, message, data: { ...subject, message } };
  }

  /**
   * Copies a whole syllabus — subjects and their chapters — from one scope into
   * another. Setting up a new exam or a second unit by hand would otherwise
   * mean retyping everything.
   */
  async copySubjects(
    key: string,
    body: { fromPortalKey?: string; fromUnitKey?: string; unitKey?: string },
  ) {
    const target = await this.resolveByKey(key);
    const targetUnit = await this.resolveUnit(target.id, body.unitKey);
    await this.requireUnitWhenPresent(target.id, targetUnit, 'a copied syllabus');

    const source = await this.resolveByKey(body.fromPortalKey || key);
    const sourceUnit = await this.resolveUnit(source.id, body.fromUnitKey);

    const targetScope = targetUnit?.id || '';
    const sourceScope = sourceUnit?.id || '';

    if (source.id === target.id && sourceScope === targetScope) {
      throw new BadRequestException('Pick a different source — that is the same syllabus.');
    }

    const sourceSubjects = await this.prisma.subject.findMany({
      where: { portalId: source.id, unitScope: sourceScope },
      include: { topics: true },
      orderBy: [{ sortOrder: 'asc' }],
    });

    if (sourceSubjects.length === 0) {
      throw new BadRequestException('That syllabus has no subjects to copy.');
    }

    const existing = await this.prisma.subject.findMany({
      where: { portalId: target.id, unitScope: targetScope },
      select: { code: true },
    });
    const taken = new Set(existing.map((e) => e.code));

    let copied = 0;
    let skipped = 0;

    for (const subject of sourceSubjects) {
      if (taken.has(subject.code)) {
        skipped++;
        continue;
      }

      await this.prisma.subject.create({
        data: {
          portalId: target.id,
          unitId: targetUnit?.id ?? null,
          unitScope: targetScope,
          titleEn: subject.titleEn,
          titleBn: subject.titleBn,
          code: subject.code,
          icon: subject.icon,
          marks: subject.marks,
          sortOrder: subject.sortOrder,
          topics: {
            create: subject.topics.map((t) => ({ titleEn: t.titleEn, titleBn: t.titleBn })),
          },
        },
      });
      copied++;
    }

    const targetName = targetUnit ? `${target.titleEn} ${targetUnit.titleBn}` : target.titleEn;
    const sourceName = sourceUnit ? `${source.titleEn} ${sourceUnit.titleBn}` : source.titleEn;
    const message =
      `Copied ${copied} subject(s) from ${sourceName} into ${targetName}` +
      (skipped > 0 ? `; ${skipped} already existed and were left alone.` : '.');

    return { success: true, message, data: { message, copied, skipped } };
  }

  /** Marks weight / ordering for a subject inside its own scope. */
  async updateSubject(
    key: string,
    subjectId: string,
    data: { marks?: number | null; sortOrder?: number },
  ) {
    const portal = await this.resolveByKey(key);

    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, portalId: portal.id },
    });

    if (!subject) {
      throw new NotFoundException(`That subject does not belong to ${portal.titleEn}.`);
    }

    return this.prisma.subject.update({
      where: { id: subject.id },
      data: {
        marks:
          data.marks === undefined
            ? undefined
            : data.marks === null || String(data.marks).trim() === ''
              ? null
              : Number(data.marks),
        sortOrder: data.sortOrder === undefined ? undefined : Number(data.sortOrder),
      },
    });
  }

  /**
   * Deletes a subject from its exam. The guard checks (blocked while it
   * holds questions/blueprint items, unless forced) and the deletion itself
   * live in SubjectsService — the one place that logic exists now, instead
   * of a second copy here. This adds the portal-ownership check a scoped
   * route like `/portals/:key/subjects/:id` needs (so a URL cannot delete a
   * different exam's subject by guessing an id) and keeps this route's own
   * message phrasing.
   */
  async removeSubject(key: string, subjectId: string, force = false) {
    const portal = await this.resolveByKey(key);

    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, portalId: portal.id },
      include: { unit: { select: { titleBn: true } } },
    });

    if (!subject) {
      throw new NotFoundException(`That subject does not belong to ${portal.titleEn}.`);
    }

    const scopeName = subject.unit
      ? `${portal.titleEn} ${subject.unit.titleBn}`
      : portal.titleEn;

    const result = await this.subjectsService.deleteSubject(subject.id, force);
    const questionCount = result.data.deletedQuestions;

    const message =
      `Deleted '${subject.titleEn}' from ${scopeName}` +
      (questionCount > 0 ? ` along with ${questionCount} question(s).` : '.');

    return { success: true, message, data: { message, deletedQuestions: questionCount } };
  }

  // ---------------------------------------------------------------
  // Exam years shown as the "Past Question Papers" cards.
  // ---------------------------------------------------------------


  async listYears(key: string, unitKey?: string) {
    const portal = await this.resolveByKey(key);
    const unit = await this.resolveUnit(portal.id, unitKey);
    return this.buildYears(portal.id, unit?.id ?? null);
  }

  /**
   * Years registered for the portal, merged with any year that already holds
   * questions, each carrying its real question count. Nothing is hardcoded.
   */
  async buildYears(portalId: string, unitId: string | null = null) {
    const questionScope = unitId
      ? { portalId, unitId, year: { not: null } as any }
      : { portalId, year: { not: null } as any };

    const [configured, counted] = await Promise.all([
      this.prisma.portalYear.findMany({
        where: { portalId, unitScope: unitId || '' },
        orderBy: { year: 'desc' },
      }),
      this.prisma.question.groupBy({
        by: ['year'],
        where: questionScope,
        _count: { _all: true },
      }),
    ]);

    const countsByYear = new Map<number, number>();
    counted.forEach((row) => {
      if (row.year !== null) countsByYear.set(row.year, row._count._all);
    });

    const merged = new Map<number, any>();

    configured.forEach((cy) => {
      merged.set(cy.year, {
        id: cy.id,
        year: cy.year,
        durationMinutes: cy.durationMinutes,
        totalMarks: cy.totalMarks,
        isPublished: cy.isPublished,
        questionCount: countsByYear.get(cy.year) || 0,
        isConfigured: true,
      });
    });

    // A year holding questions is always listed, even if the admin never
    // registered it, so questions can never become unreachable.
    countsByYear.forEach((count, year) => {
      if (!merged.has(year)) {
        merged.set(year, {
          id: null,
          year,
          durationMinutes: 60,
          totalMarks: 100,
          isPublished: true,
          questionCount: count,
          isConfigured: false,
        });
      }
    });

    return Array.from(merged.values()).sort((a, b) => b.year - a.year);
  }

  async addYear(
    key: string,
    year: number,
    durationMinutes?: number,
    totalMarks?: number,
    unitKey?: string,
  ) {
    const portal = await this.resolveByKey(key);
    const unit = await this.resolveUnit(portal.id, unitKey);
    const parsedYear = Number(year);

    if (!parsedYear || parsedYear < 1971 || parsedYear > 2100) {
      throw new BadRequestException(`'${year}' is not a valid exam year.`);
    }

    await this.requireUnitWhenPresent(portal.id, unit, 'a question paper year');

    return this.prisma.portalYear.upsert({
      where: {
        portalId_year_unitScope: {
          portalId: portal.id,
          year: parsedYear,
          unitScope: unit?.id || '',
        },
      },
      update: {
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        totalMarks: totalMarks ? Number(totalMarks) : undefined,
      },
      create: {
        portalId: portal.id,
        unitId: unit?.id ?? null,
        unitScope: unit?.id || '',
        year: parsedYear,
        durationMinutes: Number(durationMinutes) || 60,
        totalMarks: Number(totalMarks) || 100,
      },
    });
  }

  /** Removes the year card. Refuses while questions still reference it. */
  async removeYear(key: string, year: number, unitKey?: string) {
    const portal = await this.resolveByKey(key);
    const unit = await this.resolveUnit(portal.id, unitKey);
    const parsedYear = Number(year);
    const scopeName = unit ? `${portal.titleEn} ${unit.titleEn}` : portal.titleEn;

    const questionCount = await this.prisma.question.count({
      where: unit
        ? { portalId: portal.id, unitId: unit.id, year: parsedYear }
        : { portalId: portal.id, year: parsedYear },
    });

    if (questionCount > 0) {
      throw new BadRequestException(
        `${parsedYear} still holds ${questionCount} question(s) in ${scopeName}. ` +
          "Delete the paper's questions first.",
      );
    }

    await this.prisma.portalYear.deleteMany({
      where: { portalId: portal.id, year: parsedYear, unitScope: unit?.id || '' },
    });

    const message = `${parsedYear} paper removed from ${scopeName}.`;
    return { success: true, message, data: { message, year: parsedYear } };
  }
}
