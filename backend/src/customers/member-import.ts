import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseMemberRow, type MemberImportRow, type MemberRowData } from '../../../shared/src/member-import';
import { userHasPermission } from '../auth/permissions';
import { canManageCredit } from './customers.controller';

/**
 * Member import (docs/round-shift-today-bundle-replace.md section 5b). Rows are matched by รหัสสมาชิก
 * (customers.profile.code, case-insensitive), else by phone. Matched rows update the member (blank cells keep the
 * current value), the others create one. Imported points set the balance through a history entry
 * (audit_logs CUSTOMER_POINTS_ADJUST, reason "นำเข้าคะแนน": before / after / delta), never silently.
 */

export const MAX_IMPORT_ROWS = 10_000;

export type PlanAction = 'create' | 'update' | 'unchanged' | 'error';
export interface PlanRow {
  rowNo: number;
  action: PlanAction;
  errors: string[];
  name: string;
  phone: string | null;
  code: string | null;
  matchedBy?: 'code' | 'phone';
  customerId?: string;
  /** fields that change (Thai labels) */
  changes: string[];
  pointsBefore?: number;
  pointsAfter?: number;
  data: MemberRowData;
}

const PROFILE_KEYS = ['priceLevel', 'creditLimit', 'creditTerms', 'taxId', 'deliveryFee', 'pointEarnRateBaht', 'pointEarnUnits', 'pointRedeemRatePoints', 'pointRedeemDiscountBaht'] as const;
const LABEL: Record<string, string> = {
  name: 'ชื่อ', phone: 'เบอร์โทร', address: 'ที่อยู่', email: 'อีเมล', note: 'หมายเหตุ', code: 'รหัสสมาชิก', priceLevel: 'ระดับราคา',
  creditLimit: 'วงเงินเครดิต', creditTerms: 'เครดิต (วัน)', taxId: 'เลขผู้เสียภาษี', deliveryFee: 'ค่าส่ง', points: 'คะแนนสะสม',
  pointEarnRateBaht: 'เรทสะสม (บาท)', pointEarnUnits: 'เรทสะสม (คะแนน)', pointRedeemRatePoints: 'เรทแลก (คะแนน)', pointRedeemDiscountBaht: 'เรทแลก (บาท)',
};

const phoneKey = (p: string | null | undefined) => (p ? p.replace(/[^\d+]/g, '') : '');

function readRows(raw: unknown): MemberImportRow[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('ไม่มีแถวข้อมูลสมาชิก');
  if (raw.length > MAX_IMPORT_ROWS) throw new BadRequestException(`นำเข้าได้ครั้งละไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString('en-US')} แถว`);
  return raw.map((r: any, i) => {
    const values: Record<string, string> = {};
    if (r && typeof r.values === 'object' && r.values) {
      for (const [k, v] of Object.entries(r.values)) if (v !== null && v !== undefined) values[k] = String(v).slice(0, 2000);
    }
    return { rowNo: Number.isInteger(r?.rowNo) ? r.rowNo : i + 2, values };
  });
}

/** Plan every row against the database (no writes). `user` decides the credit / price-level rights. */
export async function planImport(db: any, rawRows: unknown, user: any): Promise<{ rows: PlanRow[]; counts: Record<PlanAction, number> }> {
  const input = readRows(rawRows);
  const parsed = input.map((r) => ({ rowNo: r.rowNo, ...parseMemberRow(r) }));

  // existing members by code / phone (one query each)
  const codes = [...new Set(parsed.map((p) => p.data.code?.toLowerCase()).filter(Boolean))] as string[];
  const phones = [...new Set(parsed.map((p) => p.data.phone).filter(Boolean))] as string[];
  const byCode = new Map<string, any>();
  if (codes.length) {
    const rows: any[] = await db.$queryRaw(Prisma.sql`SELECT id, name, phone, email, address, note, points, profile FROM customers WHERE lower(profile->>'code') = ANY(${codes}::text[])`);
    for (const r of rows) byCode.set(String(r.profile?.code).toLowerCase(), r);
  }
  const byPhone = new Map<string, any>();
  if (phones.length) {
    const keys = [...new Set(phones.map(phoneKey))];
    const rows: any[] = await db.$queryRaw(Prisma.sql`SELECT id, name, phone, email, address, note, points, profile FROM customers WHERE regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = ANY(${keys}::text[])`);
    for (const r of rows) byPhone.set(phoneKey(r.phone), r);
  }
  const settings = await db.storeSettings.findFirst({ select: { walkInLevelNeedsDiscount: true } });

  const seenPhone = new Map<string, number>();
  const seenCode = new Map<string, number>();
  const seenMember = new Map<string, number>();
  const out: PlanRow[] = [];
  for (const p of parsed) {
    const errors = [...p.errors];
    const d = p.data;
    const pk = phoneKey(d.phone);
    if (pk) {
      if (seenPhone.has(pk)) errors.push(`เบอร์โทรซ้ำกับแถว ${seenPhone.get(pk)} ในไฟล์`);
      else seenPhone.set(pk, p.rowNo);
    }
    const ck = d.code?.toLowerCase();
    if (ck) {
      if (seenCode.has(ck)) errors.push(`รหัสสมาชิกซ้ำกับแถว ${seenCode.get(ck)} ในไฟล์`);
      else seenCode.set(ck, p.rowNo);
    }
    const viaCode = ck ? byCode.get(ck) : undefined;
    const viaPhone = pk ? byPhone.get(pk) : undefined;
    let existing = viaCode || viaPhone;
    const matchedBy: PlanRow['matchedBy'] = viaCode ? 'code' : viaPhone ? 'phone' : undefined;
    if (viaCode && viaPhone && viaCode.id !== viaPhone.id) {
      errors.push(`รหัส ${d.code} เป็นของ "${viaCode.name}" แต่เบอร์ ${d.phone} เป็นของ "${viaPhone.name}"`);
      existing = undefined;
    }
    if (existing) {
      if (seenMember.has(existing.id)) errors.push(`จับคู่สมาชิกคนเดียวกับแถว ${seenMember.get(existing.id)}`);
      else seenMember.set(existing.id, p.rowNo);
    }
    const profile = (existing?.profile && typeof existing.profile === 'object' ? existing.profile : {}) as Record<string, any>;

    // rights: credit fields (debt managers) and a price level 2-5 (setting "walk-in level needs the discount right")
    const creditChange = (d.creditLimit !== undefined && Number(profile.creditLimit ?? 0) !== d.creditLimit)
      || (d.creditTerms !== undefined && Number(profile.creditTerms ?? 30) !== d.creditTerms);
    if (creditChange && !canManageCredit(user)) errors.push('ไม่มีสิทธิ์กำหนดวงเงิน / เครดิต (ต้องมีสิทธิ์จัดการลูกหนี้)');
    if (d.priceLevel !== undefined && d.priceLevel > 1 && d.priceLevel !== Number(profile.priceLevel || 1)
      && settings?.walkInLevelNeedsDiscount && !userHasPermission(user, 'POS_DISCOUNT')) {
      errors.push('ตั้งระดับราคา 2-5 ต้องมีสิทธิ์ให้ส่วนลด');
    }

    const changes: string[] = [];
    if (existing) {
      const cur: Record<string, any> = { name: existing.name, phone: existing.phone, address: existing.address, email: existing.email, note: existing.note, code: profile.code };
      for (const k of ['name', 'phone', 'address', 'email', 'note', 'code'] as const) {
        if (d[k] !== undefined && String(d[k]) !== String(cur[k] ?? '')) changes.push(LABEL[k]);
      }
      for (const k of PROFILE_KEYS) {
        if (d[k] !== undefined && String(d[k]) !== String(profile[k] ?? '')) changes.push(LABEL[k]);
      }
      if (d.points !== undefined && d.points !== Number(existing.points || 0)) changes.push(LABEL.points);
    }
    out.push({
      rowNo: p.rowNo,
      action: errors.length ? 'error' : existing ? (changes.length ? 'update' : 'unchanged') : 'create',
      errors,
      name: d.name || existing?.name || '',
      phone: d.phone ?? existing?.phone ?? null,
      code: d.code ?? profile.code ?? null,
      matchedBy,
      customerId: existing?.id,
      changes,
      pointsBefore: existing ? Number(existing.points || 0) : 0,
      pointsAfter: d.points !== undefined ? d.points : existing ? Number(existing.points || 0) : 0,
      data: d,
    });
  }
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 } as Record<PlanAction, number>;
  for (const r of out) counts[r.action]++;
  return { rows: out, counts };
}

/**
 * Import: re-plans inside one transaction (the same checks), refuses when any row has an error (nothing is saved),
 * writes creates / updates, the points history entries and one CUSTOMER_IMPORT audit entry.
 */
export async function commitImport(prisma: any, rawRows: unknown, user: any, fileName?: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 11)`; // one member import at a time
    const plan = await planImport(tx, rawRows, user);
    if (plan.counts.error > 0) {
      throw new BadRequestException({
        statusCode: 400, code: 'IMPORT_HAS_ERRORS', message: `มี ${plan.counts.error} แถวที่ต้องแก้ก่อน (ยังไม่ได้บันทึกแถวใด)`,
        errors: plan.rows.filter((r) => r.action === 'error').slice(0, 200).map((r) => ({ rowNo: r.rowNo, errors: r.errors })),
      });
    }
    // next CUST-#### for new members without a code
    const [{ max }] = await tx.$queryRaw(Prisma.sql`
      SELECT COALESCE(max(substring(profile->>'code' from '(?i)CUST-([0-9]+)')::numeric), 0)::int AS max FROM customers`);
    let nextCode = Number(max) || 0;
    const userName = user?.fullName || user?.username || 'ระบบ';
    const pointEntries: any[] = [];
    let created = 0;
    let updated = 0;
    for (const r of plan.rows) {
      if (r.action === 'unchanged') continue;
      const d = r.data;
      const profilePart: Record<string, any> = {};
      for (const k of PROFILE_KEYS) if (d[k] !== undefined) profilePart[k] = d[k];
      if (d.code) profilePart.code = d.code;
      if (r.action === 'create') {
        if (!profilePart.code) profilePart.code = `CUST-${String(++nextCode).padStart(4, '0')}`;
        const c = await tx.customer.create({
          data: {
            name: d.name!, phone: d.phone ?? null, email: d.email ?? null, address: d.address ?? null, note: d.note ?? null,
            points: d.points ?? 0,
            profile: { type: 'INDIVIDUAL', priceLevel: 1, creditLimit: 0, creditTerms: 30, isCreditBlocked: false, ...profilePart },
          },
        });
        created++;
        if ((d.points ?? 0) !== 0) pointEntries.push({ customerId: c.id, name: c.name, before: 0, after: d.points, rowNo: r.rowNo });
      } else {
        const cur = await tx.customer.findUnique({ where: { id: r.customerId } });
        const profile = { ...((cur.profile as any) || {}), ...profilePart };
        const data: any = { profile };
        for (const k of ['name', 'phone', 'email', 'address', 'note'] as const) if (d[k] !== undefined) data[k] = d[k];
        if (d.points !== undefined && d.points !== cur.points) {
          data.points = d.points;
          pointEntries.push({ customerId: cur.id, name: cur.name, before: cur.points, after: d.points, rowNo: r.rowNo });
        }
        await tx.customer.update({ where: { id: cur.id }, data });
        updated++;
      }
    }
    if (pointEntries.length) {
      await tx.auditLog.createMany({
        data: pointEntries.map((e) => ({
          userId: user?.id || null, action: 'CUSTOMER_POINTS_ADJUST', entity: 'Customer', entityId: e.customerId,
          details: { reason: 'นำเข้าคะแนน', source: 'IMPORT', customerName: e.name, before: e.before, after: e.after, delta: e.after - e.before, rowNo: e.rowNo, fileName: fileName || null, userName },
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        userId: user?.id || null, action: 'CUSTOMER_IMPORT', entity: 'Customer', entityId: null,
        details: { fileName: fileName || null, rows: plan.rows.length, created, updated, unchanged: plan.counts.unchanged, pointsAdjusted: pointEntries.length, userName },
      },
    });
    return { created, updated, unchanged: plan.counts.unchanged, pointsAdjusted: pointEntries.length, rows: plan.rows.length };
  }, { maxWait: 10000, timeout: 180000 });
}
