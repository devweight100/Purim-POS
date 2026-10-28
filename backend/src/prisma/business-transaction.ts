import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

// Shared ordering for POS money/inventory writes. ReadCommitted reads AFTER the
// lock see the preceding commit. Do not perform external side effects in work.
export function businessTransaction<T>(prisma: PrismaService, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 1)`;
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 5000 });
}
