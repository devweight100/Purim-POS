import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';

/**
 * Turn a Prisma error left over after explicit validation into a Thai 4xx instead of a 500.
 * Anything that is not a known Prisma request error is re-thrown unchanged.
 */
export function rethrowPrismaError(err: any, messages: { conflict?: string; notFound?: string; badRef?: string } = {}): never {
  if (err instanceof HttpException) throw err;
  const code = err?.code;
  if (code === 'P2002') throw new ConflictException(messages.conflict || 'ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
  if (code === 'P2025') throw new NotFoundException(messages.notFound || 'ไม่พบข้อมูลที่ต้องการ');
  if (code === 'P2003') throw new BadRequestException(messages.badRef || 'ข้อมูลอ้างอิงไม่ถูกต้อง');
  if (code === 'P2000' || code === 'P2020' || code === 'P2033') throw new BadRequestException('ค่าที่ระบุใหญ่เกินกว่าที่ระบบรองรับ');
  if (code === 'P2006' || code === 'P2007' || code === 'P2009' || code === 'P2012') throw new BadRequestException('ข้อมูลไม่ถูกต้อง');
  if (err?.name === 'PrismaClientValidationError') throw new BadRequestException('ข้อมูลไม่ถูกต้อง');
  throw err;
}

/** Parse a list query integer and clamp it; invalid input falls back to the default. */
export function clampInt(raw: unknown, def: number, min: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
