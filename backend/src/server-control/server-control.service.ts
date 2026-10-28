import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, spawn } from 'child_process';

export interface LiveCartItem {
  productId: string;
  name: string;
  barcode?: string;
  unitName: string;
  price: number;
  quantity: number;
  total: number;
}

export interface TerminalLiveState {
  activeAction: 'IDLE' | 'SCANNING' | 'PAYMENT' | 'VOID' | 'DRAWER' | 'CLAIM';
  actionDescription: string;
  actionTimestamp: string;
  customerName?: string;
  itemCount: number;
  totalAmount: number;
  discountAmount: number;
  cartItems: LiveCartItem[];
  alertLevel?: 'NORMAL' | 'WARNING' | 'ALERT';
  screenSnapshot?: string;
}

export interface TerminalTelemetry {
  terminalId: string;
  terminalName: string;
  ipAddress: string;
  userName: string;
  status: 'ONLINE' | 'ACTIVE' | 'IDLE' | 'OFFLINE';
  lastPingAt: string;
  latencyMs: number;
  todaySales: number;
  todayBills: number;
  lastOrderTime?: string;
  liveState?: TerminalLiveState;
}

export interface ActivityLogItem {
  id: string;
  timestamp: string;
  terminalName: string;
  type: 'SALE' | 'CLAIM' | 'DRAWER' | 'SHIFT' | 'SYSTEM';
  description: string;
  amount?: number;
  badgeColor?: string;
}

export interface BackupFileInfo {
  fileName: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupVerifyResult {
  ok: boolean;
  fileName: string;
  sizeBytes: number;
  checkedAt: string;
  message?: string;
}

@Injectable()
export class ServerControlService {
  private readonly logger = new Logger('Backup');

  private backupStatus: {
    lastAutoBackupAt: string | null;
    lastBackupAt: string | null;
    lastBackupFile: string | null;
    lastBackupOk: boolean | null;
    lastError: string | null;
    lastVerify: BackupVerifyResult | null;
    nextRunAt: string | null;
  } = {
    lastAutoBackupAt: null,
    lastBackupAt: null,
    lastBackupFile: null,
    lastBackupOk: null,
    lastError: null,
    lastVerify: null,
    nextRunAt: null,
  };

  setNextBackupRunAt(iso: string | null) {
    this.backupStatus.nextRunAt = iso;
  }

  private activePings = new Map<string, {
    terminalName: string;
    ipAddress: string;
    userName: string;
    lastPingAt: number;
    latencyMs: number;
  }>();

  private terminalLiveStates = new Map<string, TerminalLiveState>();

  constructor(private readonly prisma: PrismaService) {}

  private getBackupsDir(): string {
    const cwd = process.cwd();
    const candidateInBackend = path.join(cwd, 'backend', 'backups');
    if (fs.existsSync(path.join(cwd, 'backend', 'prisma'))) {
      fs.mkdirSync(candidateInBackend, { recursive: true });
      return candidateInBackend;
    }
    const directBackups = path.join(cwd, 'backups');
    fs.mkdirSync(directBackups, { recursive: true });
    return directBackups;
  }

  private getDbConfig(): { containerName: string; dbUser: string; dbName: string } {
    let dbUser = 'pos_admin';
    let dbName = 'pos_purim';
    const containerName = process.env.POSTGRES_CONTAINER || 'pos-purim-db';

    if (process.env.DATABASE_URL) {
      try {
        const url = new URL(process.env.DATABASE_URL);
        if (url.username) dbUser = decodeURIComponent(url.username);
        if (url.pathname && url.pathname.length > 1) {
          dbName = decodeURIComponent(url.pathname.slice(1));
        }
      } catch {
        // Fallback to defaults
      }
    }

    return { containerName, dbUser, dbName };
  }

  async listBackups(): Promise<BackupFileInfo[]> {
    const backupsDir = this.getBackupsDir();
    const entries = await fs.promises.readdir(backupsDir, { withFileTypes: true });
    const files: BackupFileInfo[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(backupsDir, entry.name);
      try {
        const stat = await fs.promises.stat(fullPath);
        const createdDate =
          stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime;
        files.push({
          fileName: entry.name,
          filename: entry.name,
          sizeBytes: stat.size,
          createdAt: createdDate.toISOString(),
        });
      } catch {
        // Ignore files that disappeared during stat
      }
    }

    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return files;
  }

  /**
   * Public entry point (used by the controller and the scheduler): creates a backup,
   * verifies it and records the status in memory for the UI.
   */
  async createBackup(source: 'manual' | 'auto' = 'manual') {
    try {
      const result = await this.createBackupRaw();
      const verify = await this.verifyBackup(result.fileName);
      this.backupStatus.lastBackupAt = new Date().toISOString();
      this.backupStatus.lastBackupFile = result.fileName;
      this.backupStatus.lastBackupOk = verify.ok;
      this.backupStatus.lastError = verify.ok ? null : verify.message || 'verify failed';
      this.backupStatus.lastVerify = verify;
      if (source === 'auto') this.backupStatus.lastAutoBackupAt = this.backupStatus.lastBackupAt;
      this.logger.log(
        `Backup (${source}) ${result.fileName} ${result.sizeBytes} bytes, verify=${verify.ok ? 'OK' : 'FAILED'}`,
      );
      return { ...result, verify };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.backupStatus.lastBackupOk = false;
      this.backupStatus.lastError = message;
      this.logger.error(`Backup (${source}) failed: ${message}`);
      throw err;
    }
  }

  getBackupStatus() {
    return { ...this.backupStatus };
  }

  /** Verify a backup file. .dump => pg_restore --list inside the DB container; .json => parse check. */
  async verifyBackup(fileName: string): Promise<BackupVerifyResult> {
    const checkedAt = new Date().toISOString();
    const safeName = path.basename(fileName || '');
    const fullPath = path.join(this.getBackupsDir(), safeName);
    if (!safeName || safeName !== fileName || !fs.existsSync(fullPath)) {
      return { ok: false, fileName: safeName, sizeBytes: 0, checkedAt, message: 'file not found' };
    }
    const sizeBytes = fs.statSync(fullPath).size;
    if (safeName.endsWith('.json')) {
      try {
        JSON.parse(await fs.promises.readFile(fullPath, 'utf8'));
        return { ok: sizeBytes > 0, fileName: safeName, sizeBytes, checkedAt };
      } catch (e) {
        return { ok: false, fileName: safeName, sizeBytes, checkedAt, message: 'invalid JSON' };
      }
    }
    if (!safeName.endsWith('.dump')) {
      return { ok: false, fileName: safeName, sizeBytes, checkedAt, message: 'unsupported file type' };
    }
    const { containerName } = this.getDbConfig();
    const result = await new Promise<BackupVerifyResult>((resolve) => {
      const child = spawn('docker', ['exec', '-i', containerName, 'pg_restore', '--list'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = 0;
      let stderr = '';
      const timer = setTimeout(() => child.kill(), 60000);
      child.stdout.on('data', (d) => (stdout += d.length));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, fileName: safeName, sizeBytes, checkedAt, message: e.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          ok: code === 0 && stdout > 0,
          fileName: safeName,
          sizeBytes,
          checkedAt,
          message: code === 0 ? undefined : stderr.trim().slice(0, 300) || `exit ${code}`,
        });
      });
      child.stdin.on('error', () => undefined);
      fs.createReadStream(fullPath).pipe(child.stdin);
    });
    return result;
  }

  private parseBackupTime(name: string, dbName: string): Date | null {
    const m = new RegExp(`^backup-${dbName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4})(\\d{2})(\\d{2})_(\\d{2})(\\d{2})(\\d{2})\\.(dump|json)$`).exec(name);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  /**
   * Retention: keep newest backup per day for the last N days with backups (default 14) plus
   * newest backup per week for the last M weeks (default 8). Never deletes the newest backup.
   * Only touches files of the current database name.
   */
  async applyRetention(): Promise<{ kept: number; deleted: string[] }> {
    const dailyKeep = Math.max(1, parseInt(process.env.BACKUP_DAILY_KEEP || '14', 10) || 14);
    const weeklyKeep = Math.max(0, parseInt(process.env.BACKUP_WEEKLY_KEEP || '8', 10) || 8);
    const { dbName } = this.getDbConfig();
    const dir = this.getBackupsDir();
    const items = fs
      .readdirSync(dir)
      .map((name) => ({ name, time: this.parseBackupTime(name, dbName) }))
      .filter((x): x is { name: string; time: Date } => !!x.time)
      .sort((a, b) => b.time.getTime() - a.time.getTime());
    if (items.length === 0) return { kept: 0, deleted: [] };

    const keep = new Set<string>([items[0].name]);
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const weekKey = (d: Date) => {
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      return dayKey(monday);
    };
    const days = new Set<string>();
    const weeks = new Set<string>();
    for (const it of items) {
      const dk = dayKey(it.time);
      if (!days.has(dk) && days.size < dailyKeep) {
        days.add(dk);
        keep.add(it.name);
      }
      const wk = weekKey(it.time);
      if (!weeks.has(wk) && weeks.size < weeklyKeep) {
        weeks.add(wk);
        keep.add(it.name);
      }
    }
    const deleted: string[] = [];
    for (const it of items) {
      if (keep.has(it.name)) continue;
      try {
        fs.unlinkSync(path.join(dir, it.name));
        deleted.push(it.name);
      } catch (e) {
        this.logger.warn(`Retention: cannot delete ${it.name}`);
      }
    }
    this.logger.log(`Retention: kept ${keep.size}, deleted ${deleted.length}${deleted.length ? ' (' + deleted.join(', ') + ')' : ''}`);
    return { kept: keep.size, deleted };
  }

  /** Called by BackupScheduler. Backup, then retention (retention runs only if backup verified OK). */
  async runScheduledBackup() {
    try {
      const res = await this.createBackup('auto');
      if (res.verify.ok) await this.applyRetention();
      else this.logger.warn('Auto backup verify failed; retention skipped');
    } catch {
      // already logged
    }
  }

  /** Newest backup time for the current DB (null if none). */
  async getNewestBackupTime(): Promise<Date | null> {
    const { dbName } = this.getDbConfig();
    const times = fs
      .readdirSync(this.getBackupsDir())
      .map((n) => this.parseBackupTime(n, dbName))
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime());
    return times[0] ?? null;
  }

  private async createBackupRaw() {
    const backupsDir = this.getBackupsDir();
    const { containerName, dbUser, dbName } = this.getDbConfig();

    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    const timestamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const dumpFileName = `backup-${dbName}-${timestamp}.dump`;
    const dumpFilePath = path.join(backupsDir, dumpFileName);

    let dockerSucceeded = false;
    try {
      const fd = fs.openSync(dumpFilePath, 'w');
      try {
        const result = spawnSync(
          'docker',
          ['exec', containerName, 'pg_dump', '-U', dbUser, '-d', dbName, '-Fc'],
          { stdio: ['ignore', fd, 'pipe'], timeout: 60000 }
        );
        if (result.status === 0) {
          dockerSucceeded = true;
        }
      } finally {
        fs.closeSync(fd);
      }

      if (dockerSucceeded && fs.existsSync(dumpFilePath)) {
        const stat = fs.statSync(dumpFilePath);
        if (stat.size >= 100) {
          const createdAt = (
            stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime
          ).toISOString();
          return {
            success: true,
            fileName: dumpFileName,
            filename: dumpFileName,
            sizeBytes: stat.size,
            createdAt,
          };
        }
      }
    } catch {
      dockerSucceeded = false;
    }

    // Clean up empty/failed dump file before JSON snapshot fallback
    try {
      if (fs.existsSync(dumpFilePath)) {
        fs.unlinkSync(dumpFilePath);
      }
    } catch {}

    // Fallback: JSON snapshot export of core tables via Prisma
    const jsonFileName = `backup-${dbName}-${timestamp}.json`;
    const jsonFilePath = path.join(backupsDir, jsonFileName);

    const [
      categories,
      products,
      productBarcodes,
      productPackagingUnits,
      productWholesalePrices,
      productBundleItems,
      stockBatches,
      suppliers,
      purchaseOrders,
      purchaseOrderItems,
      paymentVouchers,
      supplierReturnNotes,
      customers,
      customerDebts,
      debtPayments,
      orders,
      orderItems,
      payments,
      customerClaims,
      claimInventory,
      shifts,
      cashMovements,
      bankAccounts,
      storeSettings,
    ] = await Promise.all([
      this.prisma.category.findMany(),
      this.prisma.product.findMany(),
      this.prisma.productBarcode.findMany(),
      this.prisma.productPackagingUnit.findMany(),
      this.prisma.productWholesalePrice.findMany(),
      this.prisma.productBundleItem.findMany(),
      this.prisma.stockBatch.findMany(),
      this.prisma.supplier.findMany(),
      this.prisma.purchaseOrder.findMany(),
      this.prisma.purchaseOrderItem.findMany(),
      this.prisma.paymentVoucher.findMany(),
      this.prisma.supplierReturnNote.findMany(),
      this.prisma.customer.findMany(),
      this.prisma.customerDebt.findMany(),
      this.prisma.debtPayment.findMany(),
      this.prisma.order.findMany(),
      this.prisma.orderItem.findMany(),
      this.prisma.payment.findMany(),
      this.prisma.customerClaim.findMany(),
      this.prisma.claimInventory.findMany(),
      this.prisma.shift.findMany(),
      this.prisma.cashMovement.findMany(),
      this.prisma.bankAccount.findMany(),
      this.prisma.storeSettings.findMany(),
    ]);

    const snapshot = {
      metadata: {
        database: dbName,
        exportedAt: now.toISOString(),
        format: 'prisma-json-snapshot',
      },
      data: {
        categories,
        products,
        productBarcodes,
        productPackagingUnits,
        productWholesalePrices,
        productBundleItems,
        stockBatches,
        suppliers,
        purchaseOrders,
        purchaseOrderItems,
        paymentVouchers,
        supplierReturnNotes,
        customers,
        customerDebts,
        debtPayments,
        orders,
        orderItems,
        payments,
        customerClaims,
        claimInventory,
        shifts,
        cashMovements,
        bankAccounts,
        storeSettings,
      },
    };

    await fs.promises.writeFile(jsonFilePath, JSON.stringify(snapshot, null, 2), 'utf8');
    const stat = await fs.promises.stat(jsonFilePath);
    const createdAt = (
      stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime
    ).toISOString();

    return {
      success: true,
      fileName: jsonFileName,
      filename: jsonFileName,
      sizeBytes: stat.size,
      createdAt,
    };
  }

  recordPing(
    terminalId: string,
    terminalName: string,
    userName: string,
    ip: string,
    latencyMs = 5,
    liveState?: Partial<TerminalLiveState>,
  ) {
    this.activePings.set(terminalId, {
      terminalName: terminalName || `Terminal ${terminalId.slice(0, 4).toUpperCase()}`,
      ipAddress: ip || '127.0.0.1',
      userName: userName || 'แคชเชียร์',
      lastPingAt: Date.now(),
      latencyMs: Math.max(1, Math.round(latencyMs)),
    });
    if (liveState) {
      this.recordLiveState(terminalId, liveState);
    }
  }

  recordLiveState(terminalId: string, state: Partial<TerminalLiveState>, ip = '127.0.0.1') {
    if (!this.activePings.has(terminalId)) {
      this.activePings.set(terminalId, {
        terminalName: `จุดขาย #${terminalId.slice(0, 6).toUpperCase()}`,
        ipAddress: ip,
        userName: 'แคชเชียร์',
        lastPingAt: Date.now(),
        latencyMs: 3,
      });
    } else {
      const p = this.activePings.get(terminalId);
      if (p) p.lastPingAt = Date.now();
    }

    const existing = this.terminalLiveStates.get(terminalId) || {
      activeAction: 'IDLE',
      actionDescription: 'จุดขายพร้อมให้บริการ',
      actionTimestamp: new Date().toISOString(),
      itemCount: 0,
      totalAmount: 0,
      discountAmount: 0,
      cartItems: [],
      alertLevel: 'NORMAL',
    };
    this.terminalLiveStates.set(terminalId, {
      ...existing,
      ...state,
      actionTimestamp: new Date().toISOString(),
    });
  }

  async getTelemetry() {
    const startTime = Date.now();
    let dbStatus = 'ONLINE';
    let dbLatencyMs = 0;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - startTime;
    } catch {
      dbStatus = 'DEGRADED';
      dbLatencyMs = -1;
    }

    // 1. Network Interfaces & Local IP
    const nets = os.networkInterfaces();
    let localIp = '127.0.0.1';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          localIp = net.address;
          break;
        }
      }
      if (localIp !== '127.0.0.1') break;
    }

    // 2. System Hardware Metrics
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;
    const memoryUsagePercent = Math.round((usedMemBytes / totalMemBytes) * 100);

    const processMem = process.memoryUsage();
    const uptimeSec = Math.floor(process.uptime());

    // 3. Today's Date Range (Asia/Bangkok local time)
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 4. Sales Aggregates for Today
    const todayOrders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: startOfToday },
        status: { notIn: ['VOIDED', 'REFUNDED'] },
      },
      include: {
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalRevenue = 0;
    let cashRevenue = 0;
    let qrRevenue = 0;
    let creditRevenue = 0;

    const ordersByTerminal = new Map<string, { sales: number; bills: number; lastOrder?: string }>();

    for (const order of todayOrders) {
      const orderAmt = Number(order.totalAmount || 0);
      totalRevenue += orderAmt;

      // Group by Terminal ID or Cashier
      const termKey = (order as any).terminalId || (order as any).shiftId || 'MAIN_POS';
      const cur = ordersByTerminal.get(termKey) || { sales: 0, bills: 0, lastOrder: order.createdAt.toISOString() };
      cur.sales += orderAmt;
      cur.bills += 1;
      ordersByTerminal.set(termKey, cur);

      // Payments breakdown
      for (const p of order.payments) {
        const pAmt = Number(p.amount || 0);
        if (p.method === 'CASH') cashRevenue += pAmt;
        else if (p.method === 'QR_PROMPTPAY' || p.method === 'TRANSFER') qrRevenue += pAmt;
        else if (p.method === 'CREDIT_DEBT') creditRevenue += pAmt;
      }
    }

    // 5. Active Terminals Consolidation
    const nowMs = Date.now();
    const terminals: TerminalTelemetry[] = [];

    // Ensure at least default Main Terminal is shown if none pinged
    if (this.activePings.size === 0) {
      terminals.push({
        terminalId: 'SERVER-POS-01',
        terminalName: 'เครื่องแม่ (Main Terminal)',
        ipAddress: localIp,
        userName: 'Admin / แคชเชียร์หลัก',
        status: 'ONLINE',
        lastPingAt: new Date().toISOString(),
        latencyMs: 1,
        todaySales: totalRevenue,
        todayBills: todayOrders.length,
        lastOrderTime: todayOrders[0]?.createdAt.toISOString(),
        liveState: this.terminalLiveStates.get('SERVER-POS-01'),
      });
    } else {
      this.activePings.forEach((val, id) => {
        const diffMs = nowMs - val.lastPingAt;
        let status: 'ONLINE' | 'ACTIVE' | 'IDLE' | 'OFFLINE' = 'OFFLINE';
        if (diffMs < 30000) status = 'ACTIVE';
        else if (diffMs < 90000) status = 'ONLINE';
        else if (diffMs < 300000) status = 'IDLE';

        const stats = ordersByTerminal.get(id) || { sales: 0, bills: 0 };

        terminals.push({
          terminalId: id,
          terminalName: val.terminalName,
          ipAddress: val.ipAddress,
          userName: val.userName,
          status,
          lastPingAt: new Date(val.lastPingAt).toISOString(),
          latencyMs: val.latencyMs,
          todaySales: stats.sales,
          todayBills: stats.bills,
          lastOrderTime: stats.lastOrder,
          liveState: this.terminalLiveStates.get(id),
        });
      });
    }

    // 6. Recent Activity Feed
    const recentActivity: ActivityLogItem[] = todayOrders.slice(0, 15).map((o) => {
      const amt = Number(o.totalAmount || 0);
      const isClaimFree = amt === 0;
      return {
        id: o.id,
        timestamp: o.createdAt.toISOString(),
        terminalName: (o as any).terminalId ? `เครื่อง [${(o as any).terminalId.slice(0, 6)}]` : 'เครื่องแคชเชียร์',
        type: isClaimFree ? 'CLAIM' : 'SALE',
        description: isClaimFree
          ? `บิล #${o.orderNumber}: เคลมสินค้า/ฟรี ฿0.00`
          : `บิล #${o.orderNumber}: สำเร็จ (+฿${amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })})`,
        amount: amt,
        badgeColor: isClaimFree ? 'emerald' : 'cyan',
      };
    });

    return {
      serverTime: new Date().toISOString(),
      uptimeSec,
      serverIp: localIp,
      serverPort: process.env.PORT || 3001,
      frontendPort: 3000,
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        engine: 'PostgreSQL 16 (Native)',
        databaseName: 'pos_purim',
        storageDrive: 'D:\\ (Active Project)',
      },
      system: {
        platform: `${os.type()} ${os.release()}`,
        cpuModel: os.cpus()[0]?.model || 'Multi-Core Processor',
        cpuCores: os.cpus().length,
        memoryUsagePercent,
        usedMemMB: Math.round(usedMemBytes / (1024 * 1024)),
        totalMemMB: Math.round(totalMemBytes / (1024 * 1024)),
        processRssMB: Math.round(processMem.rss / (1024 * 1024)),
      },
      todaySummary: {
        totalRevenue,
        totalBills: todayOrders.length,
        averageBill: todayOrders.length > 0 ? totalRevenue / todayOrders.length : 0,
        cashRevenue,
        qrRevenue,
        creditRevenue,
      },
      terminals,
      recentActivity,
    };
  }
}
