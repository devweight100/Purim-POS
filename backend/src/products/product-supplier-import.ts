import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeAverageSupplierCost,
  MAX_SUPPLIERS_PER_IMPORT,
  parseSupplierImportRow,
  SUPPLIER_COST_MODES,
  type ParsedSupplierImportRow,
  type SupplierImportCostMode,
  type SupplierImportRawRow,
} from '../../../shared/src/product-supplier-import';
import { canViewCost } from './cost-visibility';

export type SupplierPlanAction = 'create' | 'update' | 'delete' | 'unchanged' | 'error';

export interface SupplierPlanRow {
  rowNo: number;
  action: SupplierPlanAction;
  errors: string[];
  productId?: string;
  sku: string;
  productName: string;
  matchedBy?: 'systemId' | 'sku' | 'barcode';
  supplierId?: string;
  supplierName: string;
  isNewSupplier: boolean;
  barcodes: string[];
  unitCost: number | null;
  costBefore: number | null;
  changes: string[];
  data: ParsedSupplierImportRow;
}

export interface SupplierImportPlan {
  rows: SupplierPlanRow[];
  counts: Record<SupplierPlanAction, number>;
  newSuppliers: string[];
  costMode: SupplierImportCostMode;
}

function normalizeCostMode(raw: unknown): SupplierImportCostMode {
  const s = String(raw || 'zero_only') as SupplierImportCostMode;
  return (SUPPLIER_COST_MODES as readonly string[]).includes(s) ? s : 'zero_only';
}

function readRawRows(raw: unknown): SupplierImportRawRow[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestException('ไม่พบแถวข้อมูลผู้จำหน่ายในไฟล์');
  }
  if (raw.length > MAX_SUPPLIERS_PER_IMPORT) {
    throw new BadRequestException(`นำเข้าได้ครั้งละไม่เกิน ${MAX_SUPPLIERS_PER_IMPORT.toLocaleString('en-US')} แถว`);
  }
  return raw.map((r: any, i) => {
    const values: Record<string, string> = {};
    if (r && typeof r.values === 'object' && r.values) {
      for (const [k, v] of Object.entries(r.values)) {
        if (v !== null && v !== undefined) values[k] = String(v).slice(0, 2000);
      }
    }
    return {
      rowNo: Number.isInteger(r?.rowNo) && r.rowNo > 0 ? r.rowNo : i + 2,
      values,
    };
  });
}

const fmtMoney = (n: number | null | undefined) =>
  n === null || n === undefined ? 'ไม่ระบุ' : `฿${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const sameArray = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Validate and plan every row of a supplier-cost-barcode Excel file against the database without writing anything.
 * Matching priority (per owner rule): systemId ("รหัสระบบ (ห้ามแก้ไข)") -> SKU -> product barcode.
 */
export async function planSupplierImport(
  db: any,
  rawRows: unknown,
  rawCostMode: unknown,
  user: any,
): Promise<SupplierImportPlan> {
  const costMode = normalizeCostMode(rawCostMode);
  const input = readRawRows(rawRows);
  const parsed = input.map((r) => ({ rowNo: r.rowNo, ...parseSupplierImportRow(r) }));
  const allowCost = canViewCost(user);

  // Gather lookup keys in bulk so 5,000 rows need only a handful of queries
  const systemIds = [...new Set(parsed.map((p) => p.data.systemId).filter(Boolean))] as string[];
  const skusLower = [...new Set(parsed.map((p) => p.data.sku?.toLowerCase()).filter(Boolean))] as string[];
  const lookupBarcodes = [
    ...new Set([
      ...parsed.map((p) => p.data.productBarcode).filter(Boolean),
      ...parsed.flatMap((p) => p.data.supplierBarcodes || []),
    ]),
  ] as string[];
  const allCodeCandidates = [...new Set([...lookupBarcodes, ...parsed.map((p) => p.data.sku).filter(Boolean)])] as string[];

  const byId = new Map<string, { id: string; sku: string; name: string; costPrice: number }>();
  const bySkuLower = new Map<string, { id: string; sku: string; name: string; costPrice: number }>();

  if (systemIds.length) {
    const prods = await db.product.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, sku: true, name: true, costPrice: true },
    });
    for (const p of prods) {
      const item = { id: p.id, sku: p.sku, name: p.name, costPrice: Number(p.costPrice || 0) };
      byId.set(p.id, item);
      bySkuLower.set(p.sku.toLowerCase(), item);
    }
  }

  if (skusLower.length || allCodeCandidates.length) {
    const lowers = [...new Set([...skusLower, ...allCodeCandidates.map((c) => c.toLowerCase())])];
    const prods: { id: string; sku: string; name: string; cost_price: string }[] = lowers.length
      ? await db.$queryRaw(
          Prisma.sql`SELECT id, sku, name, cost_price::text FROM products WHERE lower(sku) = ANY(${lowers}::text[])`,
        )
      : [];
    for (const p of prods) {
      const item = { id: p.id, sku: p.sku, name: p.name, costPrice: Number(p.cost_price || 0) };
      byId.set(p.id, item);
      bySkuLower.set(p.sku.toLowerCase(), item);
    }
  }

  // Existing product_barcodes and product_packaging_units for all candidate codes
  const barcodeOwners = new Map<string, { productId: string; sku: string; name: string; costPrice: number }>();
  const packBarcodeOwners = new Map<string, { productId: string; unitName: string; productName: string }>();

  if (allCodeCandidates.length) {
    const bcs = await db.productBarcode.findMany({
      where: { barcode: { in: allCodeCandidates } },
      include: { product: { select: { id: true, sku: true, name: true, costPrice: true } } },
    });
    for (const b of bcs) {
      if (b.product) {
        const item = { id: b.product.id, sku: b.product.sku, name: b.product.name, costPrice: Number(b.product.costPrice || 0) };
        byId.set(item.id, item);
        barcodeOwners.set(b.barcode, { productId: item.id, sku: item.sku, name: item.name, costPrice: item.costPrice });
      }
    }

    const packs = await db.productPackagingUnit.findMany({
      where: { barcode: { in: allCodeCandidates } },
      include: { product: { select: { id: true, name: true } } },
    });
    for (const u of packs) {
      if (u.barcode) {
        packBarcodeOwners.set(u.barcode, {
          productId: u.productId,
          unitName: u.name,
          productName: u.product?.name || '',
        });
      }
    }
  }

  // Suppliers (all, including inactive so we can warn instead of duplicating an inactive supplier)
  const allSuppliers: { id: string; name: string; isActive: boolean }[] = await db.supplier.findMany({
    select: { id: true, name: true, isActive: true },
  });
  const supplierByNameLower = new Map<string, { id: string; name: string; isActive: boolean }>();
  for (const s of allSuppliers) {
    const k = s.name.trim().replace(/\s+/g, ' ').toLowerCase();
    // prefer active supplier if duplicate names already exist
    if (!supplierByNameLower.has(k) || s.isActive) {
      supplierByNameLower.set(k, s);
    }
  }

  // Load existing product_suppliers for all matched products
  const matchedProductIds = [...byId.keys()];
  const existingLinks = matchedProductIds.length
    ? await db.productSupplier.findMany({
        where: { productId: { in: matchedProductIds } },
      })
    : [];
  const linkByPair = new Map<string, any>();
  for (const link of existingLinks) {
    linkByPair.set(`${link.productId}::${link.supplierId}`, link);
  }

  const seenPairInFile = new Map<string, number>();
  const seenBarcodeInFile = new Map<string, { productId: string; productName: string; rowNo: number }>();
  const newSupplierMap = new Map<string, string>(); // lower -> display name

  const out: SupplierPlanRow[] = [];

  for (const p of parsed) {
    const errors = [...p.errors];
    const d = p.data;

    if (!allowCost && (d.unitCost !== undefined || costMode !== 'none')) {
      errors.push('คุณไม่มีสิทธิ์ดูหรือแก้ไขราคาทุนสินค้า');
    }

    // 1. Resolve product: systemId -> sku -> productBarcode
    let prod: { id: string; sku: string; name: string; costPrice: number } | undefined;
    let matchedBy: SupplierPlanRow['matchedBy'];
    if (d.systemId) {
      prod = byId.get(d.systemId);
      if (prod) matchedBy = 'systemId';
      else errors.push(`ไม่พบสินค้าตามรหัสระบบ "${d.systemId}" (อาจถูกลบไปแล้ว หรือรหัสระบบถูกแก้ไข)`);
    } else if (d.sku) {
      prod = bySkuLower.get(d.sku.toLowerCase());
      if (prod) matchedBy = 'sku';
      else errors.push(`ไม่พบสินค้าที่มีรหัสสินค้า (SKU) "${d.sku}" ในระบบ`);
    } else if (d.productBarcode) {
      const owner = barcodeOwners.get(d.productBarcode);
      if (owner) {
        prod = { id: owner.productId, sku: owner.sku, name: owner.name, costPrice: owner.costPrice };
        matchedBy = 'barcode';
      } else {
        errors.push(`ไม่พบสินค้าที่มีบาร์โค้ด "${d.productBarcode}" ในระบบ`);
      }
    }

    // Untouched row from an export ("รวมสินค้าที่ยังไม่มีผู้จำหน่าย")
    if (d.skipBlankSupplier) {
      out.push({
        rowNo: p.rowNo,
        action: errors.length ? 'error' : 'unchanged',
        errors,
        productId: prod?.id,
        sku: prod?.sku || d.sku || '',
        productName: prod?.name || d.productName || '-',
        matchedBy,
        supplierName: '',
        isNewSupplier: false,
        barcodes: d.supplierBarcodes || [],
        unitCost: null,
        costBefore: null,
        changes: errors.length ? [] : ['เว้นว่างผู้จำหน่าย (ข้าม)'],
        data: d,
      });
      continue;
    }

    // 2. Resolve supplier
    const sName = d.supplierName || '';
    const sKey = sName.toLowerCase();
    const existingSupplier = sKey ? supplierByNameLower.get(sKey) : undefined;
    let isNewSupplier = false;
    if (existingSupplier && !existingSupplier.isActive) {
      errors.push(`ผู้จำหน่าย "${existingSupplier.name}" ถูกปิดการใช้งานอยู่ กรุณาเปิดใช้งานก่อนนำเข้า`);
    } else if (!existingSupplier && sName && d.command === 'upsert') {
      isNewSupplier = true;
    }

    // 3. Duplicate (product, supplier) check in same file
    if (prod && sKey) {
      const pairKey = `${prod.id}::${sKey}`;
      const prevRow = seenPairInFile.get(pairKey);
      if (prevRow !== undefined) {
        errors.push(`สินค้านี้กับผู้จำหน่าย "${sName}" ซ้ำกับแถวที่ ${prevRow} ในไฟล์เดียวกัน`);
      } else {
        seenPairInFile.set(pairKey, p.rowNo);
      }
    }

    // 4. Barcode uniqueness checks (only on upsert when supplierBarcodes given)
    if (prod && d.command === 'upsert' && d.supplierBarcodes?.length) {
      for (const code of d.supplierBarcodes) {
        // Check against product SKUs (case-sensitive exact + lower match against own SKU)
        const skuHit = bySkuLower.get(code.toLowerCase());
        if (skuHit && skuHit.sku === code) {
          if (skuHit.id === prod.id) {
            errors.push(`บาร์โค้ด "${code}" ซ้ำกับรหัสสินค้า (SKU) ของสินค้านี้เอง`);
          } else {
            errors.push(`บาร์โค้ด "${code}" ซ้ำกับรหัสสินค้า (SKU) ของสินค้า "${skuHit.name}"`);
          }
          continue;
        }
        // Check against pack barcodes (including this product's own pack units!)
        const packHit = packBarcodeOwners.get(code);
        if (packHit) {
          errors.push(`บาร์โค้ด "${code}" ซ้ำกับบาร์โค้ดหน่วย "${packHit.unitName}" ของสินค้า "${packHit.productName}"`);
          continue;
        }
        // Check against other products' base barcodes in DB
        const bcHit = barcodeOwners.get(code);
        if (bcHit && bcHit.productId !== prod.id) {
          errors.push(`บาร์โค้ด "${code}" ถูกใช้แล้วกับสินค้า "${bcHit.name}"`);
          continue;
        }
        // Check against other products in the same import file
        const inFile = seenBarcodeInFile.get(code);
        if (inFile && inFile.productId !== prod.id) {
          errors.push(`บาร์โค้ด "${code}" ซ้ำกับสินค้า "${inFile.productName}" ในแถวที่ ${inFile.rowNo} ของไฟล์นี้`);
          continue;
        }
        if (!inFile) {
          seenBarcodeInFile.set(code, { productId: prod.id, productName: prod.name, rowNo: p.rowNo });
        }
      }
    }

    const curLink = prod && existingSupplier ? linkByPair.get(`${prod.id}::${existingSupplier.id}`) : undefined;
    const prevCost = curLink && curLink.unitCost !== null && curLink.unitCost !== undefined ? Number(curLink.unitCost) : null;
    const prevBarcodes: string[] = curLink && Array.isArray(curLink.barcodes) ? curLink.barcodes : [];
    const nextBarcodes = d.supplierBarcodes !== undefined ? d.supplierBarcodes : prevBarcodes;
    const nextCost = d.unitCost !== undefined ? d.unitCost : prevCost;

    let action: SupplierPlanAction = 'unchanged';
    const changes: string[] = [];

    if (errors.length > 0) {
      action = 'error';
    } else if (d.command === 'delete') {
      if (!curLink) {
        action = 'unchanged';
        changes.push('ไม่ได้ผูกผู้จำหน่ายรายนี้อยู่แล้ว (ข้าม)');
      } else {
        action = 'delete';
        changes.push('ถอดผู้จำหน่ายออกจากสินค้า');
        if (prevBarcodes.length) changes.push(`ถอดบาร์โค้ด: ${prevBarcodes.join(', ')}`);
      }
    } else if (!curLink) {
      action = 'create';
      if (isNewSupplier) {
        changes.push('สร้างผู้จำหน่ายใหม่ในระบบ');
        if (!newSupplierMap.has(sKey)) newSupplierMap.set(sKey, sName);
      }
      if (nextCost !== null) changes.push(`ต้นทุน ${fmtMoney(nextCost)}`);
      if (nextBarcodes.length) changes.push(`บาร์โค้ด: ${nextBarcodes.join(', ')}`);
      if (d.supplierProductName) changes.push(`ชื่อผู้ขาย: ${d.supplierProductName}`);
      if (d.supplierSku) changes.push(`รหัสผู้ขาย: ${d.supplierSku}`);
      if (d.isPreferred) changes.push('ตั้งเป็นผู้จำหน่ายหลัก');
      if (changes.length === 0) changes.push('ผูกผู้จำหน่ายเข้ากับสินค้า');
    } else {
      // Compare fields explicitly given in the file
      if (d.unitCost !== undefined && d.unitCost !== prevCost) {
        changes.push(`ต้นทุน ${fmtMoney(prevCost)} → ${fmtMoney(d.unitCost)}`);
      }
      if (d.supplierBarcodes !== undefined && !sameArray(d.supplierBarcodes, prevBarcodes)) {
        changes.push(`บาร์โค้ด ${prevBarcodes.length ? prevBarcodes.join(', ') : 'ไม่มี'} → ${d.supplierBarcodes.join(', ')}`);
      }
      if (d.supplierProductName !== undefined && d.supplierProductName !== (curLink.supplierProductName || '')) {
        changes.push(`ชื่อผู้ขาย "${d.supplierProductName}"`);
      }
      if (d.supplierSku !== undefined && d.supplierSku !== (curLink.supplierSku || '')) {
        changes.push(`รหัสผู้ขาย "${d.supplierSku}"`);
      }
      if (d.isPreferred !== undefined && d.isPreferred !== Boolean(curLink.isPreferred)) {
        changes.push(d.isPreferred ? 'ตั้งเป็นผู้จำหน่ายหลัก' : 'ยกเลิกผู้จำหน่ายหลัก');
      }
      action = changes.length > 0 ? 'update' : 'unchanged';
    }

    out.push({
      rowNo: p.rowNo,
      action,
      errors,
      productId: prod?.id,
      sku: prod?.sku || d.sku || '',
      productName: prod?.name || d.productName || '-',
      matchedBy,
      supplierId: existingSupplier?.id,
      supplierName: existingSupplier?.name || sName,
      isNewSupplier: action !== 'error' && isNewSupplier,
      barcodes: nextBarcodes,
      unitCost: allowCost ? nextCost : null,
      costBefore: allowCost ? prevCost : null,
      changes,
      data: d,
    });
  }

  const counts: Record<SupplierPlanAction, number> = {
    create: 0,
    update: 0,
    delete: 0,
    unchanged: 0,
    error: 0,
  };
  for (const r of out) counts[r.action]++;

  return {
    rows: out,
    counts,
    newSuppliers: [...newSupplierMap.values()],
    costMode,
  };
}

/**
 * Commit a supplier-cost-barcode import atomically in one transaction:
 * - Re-plans inside the transaction lock; if any row has an error, throws 400 and saves nothing.
 * - Creates any new suppliers.
 * - Upserts / deletes product_suppliers rows while keeping other suppliers of the product intact.
 * - Syncs product_barcodes so every supplier barcode is immediately scannable at the POS.
 * - Optionally updates products.costPrice according to `costMode` ('zero_only' | 'average' | 'none').
 */
export async function commitSupplierImport(
  prisma: any,
  rawRows: unknown,
  rawCostMode: unknown,
  user: any,
  fileName?: string,
) {
  return prisma.$transaction(
    async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 1)`;
      const plan = await planSupplierImport(tx, rawRows, rawCostMode, user);
      if (plan.counts.error > 0) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'IMPORT_HAS_ERRORS',
          message: `มี ${plan.counts.error} แถวที่ต้องแก้ก่อนนำเข้า (ยังไม่ได้บันทึกข้อมูลใด ๆ)`,
          errors: plan.rows
            .filter((r) => r.action === 'error')
            .slice(0, 200)
            .map((r) => ({ rowNo: r.rowNo, errors: r.errors })),
        });
      }

      // 1. Create any new suppliers
      const createdSupplierIds = new Map<string, string>(); // lower name -> id
      for (const name of plan.newSuppliers) {
        const created = await tx.supplier.create({ data: { name } });
        createdSupplierIds.set(name.toLowerCase(), created.id);
      }

      const touchedProductIds = new Set<string>();
      const removedSupplierBarcodesByProduct = new Map<string, Set<string>>();
      const addedSupplierBarcodesByProduct = new Map<string, Set<string>>();

      const markRemoved = (productId: string, codes: string[]) => {
        if (!codes.length) return;
        let set = removedSupplierBarcodesByProduct.get(productId);
        if (!set) {
          set = new Set();
          removedSupplierBarcodesByProduct.set(productId, set);
        }
        for (const c of codes) set.add(c);
      };
      const markAdded = (productId: string, codes: string[]) => {
        if (!codes.length) return;
        let set = addedSupplierBarcodesByProduct.get(productId);
        if (!set) {
          set = new Set();
          addedSupplierBarcodesByProduct.set(productId, set);
        }
        for (const c of codes) set.add(c);
      };

      let created = 0;
      let updated = 0;
      let deleted = 0;

      // 2. Apply each actionable row
      for (const r of plan.rows) {
        if (r.action === 'unchanged' || r.action === 'error' || !r.productId) continue;
        const productId = r.productId;
        touchedProductIds.add(productId);

        const supplierId = r.supplierId || createdSupplierIds.get(r.supplierName.toLowerCase());
        if (!supplierId) continue;

        const existing = await tx.productSupplier.findUnique({
          where: { productId_supplierId: { productId, supplierId } },
        });
        const oldCodes: string[] = existing && Array.isArray(existing.barcodes) ? existing.barcodes : [];

        if (r.action === 'delete') {
          if (existing) {
            await tx.productSupplier.delete({ where: { id: existing.id } });
            markRemoved(productId, oldCodes);
            deleted++;
          }
          continue;
        }

        const d = r.data;
        if (d.isPreferred === true) {
          await tx.productSupplier.updateMany({
            where: { productId, supplierId: { not: supplierId }, isPreferred: true },
            data: { isPreferred: false },
          });
        }

        if (!existing) {
          const countExisting = await tx.productSupplier.count({ where: { productId } });
          const barcodes = d.supplierBarcodes ?? [];
          await tx.productSupplier.create({
            data: {
              productId,
              supplierId,
              barcodes,
              unitCost: d.unitCost ?? null,
              supplierProductName: d.supplierProductName ?? null,
              supplierSku: d.supplierSku ?? null,
              isPreferred: d.isPreferred !== undefined ? d.isPreferred : countExisting === 0,
            },
          });
          markAdded(productId, barcodes);
          created++;
        } else {
          const nextBarcodes = d.supplierBarcodes !== undefined ? d.supplierBarcodes : oldCodes;
          await tx.productSupplier.update({
            where: { id: existing.id },
            data: {
              ...(d.unitCost !== undefined ? { unitCost: d.unitCost } : {}),
              ...(d.supplierBarcodes !== undefined ? { barcodes: nextBarcodes } : {}),
              ...(d.supplierProductName !== undefined ? { supplierProductName: d.supplierProductName } : {}),
              ...(d.supplierSku !== undefined ? { supplierSku: d.supplierSku } : {}),
              ...(d.isPreferred !== undefined ? { isPreferred: d.isPreferred } : {}),
            },
          });
          if (d.supplierBarcodes !== undefined) {
            const nextSet = new Set(nextBarcodes);
            markRemoved(productId, oldCodes.filter((c) => !nextSet.has(c)));
            markAdded(productId, nextBarcodes);
          }
          updated++;
        }
      }

      // 3. Sync product_barcodes and (optionally) products.costPrice for each touched product
      let productsCostUpdated = 0;
      for (const productId of touchedProductIds) {
        const remainingLinks = await tx.productSupplier.findMany({
          where: { productId },
          select: { barcodes: true, unitCost: true },
        });
        const activeSupplierCodes = new Set<string>(
          remainingLinks.flatMap((l: any) => (Array.isArray(l.barcodes) ? l.barcodes : [])),
        );

        const toRemove = [...(removedSupplierBarcodesByProduct.get(productId) || [])].filter(
          (code) => !activeSupplierCodes.has(code),
        );
        if (toRemove.length > 0) {
          await tx.productBarcode.deleteMany({
            where: { productId, barcode: { in: toRemove } },
          });
        }

        const toAdd = [...(addedSupplierBarcodesByProduct.get(productId) || [])];
        if (toAdd.length > 0) {
          await tx.productBarcode.createMany({
            data: toAdd.map((barcode) => ({ productId, barcode })),
            skipDuplicates: true,
          });
        }

        if (plan.costMode !== 'none') {
          const avg = computeAverageSupplierCost(remainingLinks.map((l: any) => (l.unitCost === null ? null : Number(l.unitCost))));
          if (avg !== null && avg > 0) {
            const prod = await tx.product.findUnique({ where: { id: productId }, select: { costPrice: true } });
            const curCost = Number(prod?.costPrice || 0);
            if ((plan.costMode === 'zero_only' && curCost === 0) || (plan.costMode === 'average' && curCost !== avg)) {
              await tx.product.update({ where: { id: productId }, data: { costPrice: avg } });
              productsCostUpdated++;
            }
          }
        }
      }

      const userName = user?.fullName || user?.username || 'ระบบ';
      await tx.auditLog.create({
        data: {
          userId: user?.id || null,
          action: 'PRODUCT_SUPPLIER_IMPORT',
          entity: 'Product',
          entityId: null,
          details: {
            fileName: fileName || null,
            rows: plan.rows.length,
            created,
            updated,
            deleted,
            unchanged: plan.counts.unchanged,
            suppliersCreated: plan.newSuppliers.length,
            newSupplierNames: plan.newSuppliers,
            costMode: plan.costMode,
            productsCostUpdated,
            userName,
          },
        },
      });

      return {
        created,
        updated,
        deleted,
        unchanged: plan.counts.unchanged,
        suppliersCreated: plan.newSuppliers.length,
        productsCostUpdated,
        rows: plan.rows.length,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 180000 },
  );
}
