'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Building2, CheckCircle2, FileText, Plus, Trash2, 
  ShieldAlert, Package, Search, Receipt, CheckSquare, Square, DollarSign, RotateCcw, ChevronDown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  loadSuppliers,
  getProductsBySupplier,
  getPayablePOsBySupplier,
  fetchSupplierPurchaseOrders,
  fetchReturnableGroups,
  type GroupedClaimProduct,
  type ReturnableGroupsPage,
  createSupplierReturnNote,
  updateSupplierReturnNote,
  PayablePO,
  CreateSupplierReturnItemInput
} from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';
import { addQty, formatQty, isValidQty, parseQty, qtyInputMode, qtyStep, roundQty, useAllowDecimalQty } from '@/lib/qty';

/** Product groups shown per request of the create-return dialog (more on "แสดงเพิ่ม"). */
const GROUP_PAGE = 50;
const NO_GROUPS: ReturnableGroupsPage = { data: [], meta: { total: 0, page: 1, limit: GROUP_PAGE }, totals: { groups: 0, claims: 0, pieces: 0 } };

interface CreateSupplierReturnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSupplierId?: string;
  initialPoId?: string;
  editingNote?: SupplierReturnNote | null;
  onSuccess: (returnNote: SupplierReturnNote) => void;
}

/** Supplier as kept by supplier-return-service (local shape). */
type ReturnSupplier = { id: string; name: string; contactName?: string; phone?: string; address?: string };
/** Product of the selected supplier (local shape of getProductsBySupplier). */
type ReturnProduct = {
  id: string;
  name: string;
  sku: string;
  stock?: number;
  unit?: string;
  units?: Array<{ name?: string; unitName?: string }>;
  basePrice?: number | null;
  costPrice?: number | null;
};

export function CreateSupplierReturnModal({
  open,
  onOpenChange,
  initialSupplierId,
  initialPoId,
  editingNote,
  onSuccess,
}: CreateSupplierReturnModalProps) {
  const [suppliers, setSuppliers] = useState<ReturnSupplier[]>([]);
  const allowDecimalQty = useAllowDecimalQty();
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  
  // Available data for selected supplier
  const [payablePOs, setPayablePOs] = useState<PayablePO[]>([]);
  const [selectedPoId, setSelectedPoId] = useState<string>('');
  
  // returnable claims grouped by product, from the server: the supplier's own and every other one
  const [supplierGroups, setSupplierGroups] = useState<ReturnableGroupsPage>(NO_GROUPS);
  const [otherGroups, setOtherGroups] = useState<ReturnableGroupsPage>(NO_GROUPS);
  const [claimSearch, setClaimSearch] = useState('');
  const [debouncedClaimSearch, setDebouncedClaimSearch] = useState('');
  const [claimGroupsError, setClaimGroupsError] = useState<string | null>(null);
  const [showOtherClaims, setShowOtherClaims] = useState(false);
  const [supplierProducts, setSupplierProducts] = useState<ReturnProduct[]>([]);
  
  // Items chosen for return
  const [returnItems, setReturnItems] = useState<CreateSupplierReturnItemInput[]>([]);
  
  // Tab for adding items
  const [activeItemTab, setActiveItemTab] = useState<'defective' | 'overstock'>('defective');

  // Overstock product selection state
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ReturnProduct | null>(null);
  const [overstockQty, setOverstockQty] = useState<string>('1');
  const [overstockCost, setOverstockCost] = useState<string>('0');
  const [overstockReason, setOverstockReason] = useState<string>('สินค้าปกติขายไม่ออก / คืนสต็อก');

  // Custom Editable Deduction Amount (e.g. factoring in bill discounts)
  const [customDeductAmountStr, setCustomDeductAmountStr] = useState<string>('');
  const [isCustomEdited, setIsCustomEdited] = useState<boolean>(false);

  // Document metadata
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load suppliers on open
  // load suppliers / reset the form when the modal opens (adjusted while rendering)
  const [seenOpen, setSeenOpen] = useState<{ open: typeof open; initialSupplierId: typeof initialSupplierId; initialPoId: typeof initialPoId; editingNote: typeof editingNote } | null>(null);
  if (!seenOpen || seenOpen.open !== open || seenOpen.initialSupplierId !== initialSupplierId || seenOpen.initialPoId !== initialPoId || seenOpen.editingNote !== editingNote) {
    setSeenOpen({ open, initialSupplierId, initialPoId, editingNote });
    if (open) {
      const supps = loadSuppliers();
      setSuppliers(supps.map((s) => ({ id: s.id, name: s.name, contactName: s.contactName ?? undefined, phone: s.phone ?? undefined, address: s.address ?? undefined })));
      if (editingNote) {
        setSelectedSupplierId(editingNote.supplierId);
        setSelectedPoId(editingNote.linkedPoId || '');
        setReturnItems(editingNote.items.map((i) => ({ ...i })));
        setNotes(editingNote.notes || '');
        setCustomDeductAmountStr(String(editingNote.totalCreditAmount));
        setIsCustomEdited(true);
      } else {
        const defaultSuppId = initialSupplierId || (supps.length > 0 ? supps[0].id : '');
        setSelectedSupplierId(defaultSuppId);
        setSelectedPoId(initialPoId || '');
        setReturnItems([]);
        setNotes('');
        setCustomDeductAmountStr('');
        setIsCustomEdited(false);
      }
    }
  }

  // Load supplier-specific claims, POs, and products when supplier changes
  // load supplier-specific claims, POs and products when the supplier changes (adjusted while rendering)
  const [seenSupplier, setSeenSupplier] = useState<{ selectedSupplierId: typeof selectedSupplierId; editingNote: typeof editingNote } | null>(null);
  if (!seenSupplier || seenSupplier.selectedSupplierId !== selectedSupplierId || seenSupplier.editingNote !== editingNote) {
    setSeenSupplier({ selectedSupplierId, editingNote });
    if (selectedSupplierId) {
      const pos = getPayablePOsBySupplier(selectedSupplierId);
      setPayablePOs(pos);

      const prods = getProductsBySupplier(selectedSupplierId);
      setSupplierProducts(prods);

      if (!editingNote) {
        setReturnItems([]);
        setSelectedProduct(null);
        setProductSearch('');
        setCustomDeductAmountStr('');
        setIsCustomEdited(false);
      }
    }
  }

  // The supplier's purchase orders are loaded from the server (every page) when the supplier is chosen;
  // then the PO list, the claims matched through POs and the supplier's products are computed again.
  const [supplierPosError, setSupplierPosError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !selectedSupplierId) return;
    let cancelled = false;
    fetchSupplierPurchaseOrders(selectedSupplierId)
      .then(() => {
        if (cancelled) return;
        setSupplierPosError(null);
        setPayablePOs(getPayablePOsBySupplier(selectedSupplierId));
        setSupplierProducts(getProductsBySupplier(selectedSupplierId));
      })
      .catch((e) => {
        if (!cancelled) setSupplierPosError(e instanceof Error ? e.message : 'โหลดใบสั่งซื้อของผู้จำหน่ายไม่สำเร็จ');
      });
    return () => { cancelled = true; };
  }, [open, selectedSupplierId]);

  // The returnable claims of the supplier and the other ones, grouped by product on the server (every claim;
  // the server matches claims to the supplier with the rule this dialog used, POs of the supplier included).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedClaimSearch(claimSearch), 300);
    return () => clearTimeout(t);
  }, [claimSearch]);
  const loadClaimGroups = async (scope: 'supplier' | 'other', page: number) => {
    const res = await fetchReturnableGroups({ supplierId: selectedSupplierId, scope, search: debouncedClaimSearch, page, limit: GROUP_PAGE });
    const set = scope === 'supplier' ? setSupplierGroups : setOtherGroups;
    set((prev) => (page === 1 ? res : { ...res, data: [...prev.data, ...res.data] }));
  };
  useEffect(() => {
    if (!open || !selectedSupplierId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const [mine, other] = await Promise.all([
          fetchReturnableGroups({ supplierId: selectedSupplierId, scope: 'supplier', search: debouncedClaimSearch, limit: GROUP_PAGE }),
          fetchReturnableGroups({ supplierId: selectedSupplierId, scope: 'other', search: debouncedClaimSearch, limit: GROUP_PAGE }),
        ]);
        if (cancelled) return;
        setSupplierGroups(mine);
        setOtherGroups(other);
        setClaimGroupsError(null);
      } catch (e) {
        if (cancelled) return;
        setSupplierGroups(NO_GROUPS);
        setOtherGroups(NO_GROUPS);
        setClaimGroupsError(e instanceof Error ? e.message : 'โหลดสินค้าเคลมไม่สำเร็จ');
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [open, selectedSupplierId, debouncedClaimSearch]);
  const loadMoreGroups = (scope: 'supplier' | 'other') => {
    const cur = scope === 'supplier' ? supplierGroups : otherGroups;
    loadClaimGroups(scope, Math.floor(cur.data.length / GROUP_PAGE) + 1).catch((e) => toast.error(e instanceof Error ? e.message : 'โหลดสินค้าเคลมไม่สำเร็จ'));
  };

  const currentSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const selectedPO = payablePOs.find((p) => p.id === selectedPoId);

  // Defective claims grouped by product (identical products shown as a single row)
  const groupedSupplierClaims = supplierGroups.data;
  const groupedOtherClaims = otherGroups.data;

  // Totals
  const defectiveTotal = returnItems
    .filter((i) => i.itemType === 'DEFECTIVE')
    .reduce((s, i) => s + i.unitCost * i.quantity, 0);

  const overstockTotal = returnItems
    .filter((i) => i.itemType === 'OVERSTOCK')
    .reduce((s, i) => s + i.unitCost * i.quantity, 0);

  const grandTotalCost = Math.round((defectiveTotal + overstockTotal) * 100) / 100;

  // Auto-sync custom deduction amount if user hasn't manually overridden it
  // auto-sync the deduction amount unless the user overrode it (adjusted while rendering)
  const [seenTotal, setSeenTotal] = useState<{ grandTotalCost: typeof grandTotalCost; isCustomEdited: typeof isCustomEdited } | null>(null);
  if (!seenTotal || seenTotal.grandTotalCost !== grandTotalCost || seenTotal.isCustomEdited !== isCustomEdited) {
    setSeenTotal({ grandTotalCost, isCustomEdited });
    if (!isCustomEdited) {
      setCustomDeductAmountStr(grandTotalCost > 0 ? String(grandTotalCost) : '');
    }
  }

  const parsedCustomAmount = parseFloat(customDeductAmountStr);
  const finalEffectiveCredit = (!isNaN(parsedCustomAmount) && parsedCustomAmount >= 0)
    ? parsedCustomAmount
    : grandTotalCost;

  // Toggle or add grouped defective claim product into returnItems
  const toggleGroupedClaimItem = (group: GroupedClaimProduct) => {
    const existingIdx = returnItems.findIndex(
      (i) => (i.productId && i.productId === group.productId) || (i.sku && i.sku === group.sku)
    );

    if (existingIdx >= 0) {
      setReturnItems((prev) => prev.filter((_, idx) => idx !== existingIdx));
    } else {
      const unitCost = Number(group.costPrice > 0 ? group.costPrice : 50);
      const newItem: CreateSupplierReturnItemInput = {
        productId: group.productId,
        productName: group.productName,
        sku: group.sku,
        unitName: group.unitName || 'ชิ้น',
        quantity: group.totalQuantity,
        unitCost: unitCost,
        itemType: 'DEFECTIVE',
        defectReason: group.defectReasons.join(', ') || 'สินค้าชำรุด/มีปัญหา',
        claimId: group.claimIds.join(', '),
        originalOrderNumber: group.orderNumbers.join(', ') || undefined,
        poId: selectedPoId || undefined,
        poNumber: selectedPO?.poNumber || undefined,
      };
      setReturnItems((prev) => [...prev, newItem]);
    }
  };

  // Update return quantity for a grouped defective claim product
  const updateGroupReturnQty = (group: GroupedClaimProduct, newQty: number) => {
    const clampedQty = Math.max(allowDecimalQty ? 0 : 1, Math.min(roundQty(newQty), group.totalQuantity));
    setReturnItems((prev) => {
      const existingIdx = prev.findIndex(
        (i) => (i.productId && i.productId === group.productId) || (i.sku && i.sku === group.sku)
      );
      if (existingIdx >= 0) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: clampedQty } : item
        );
      } else {
        const unitCost = Number(group.costPrice > 0 ? group.costPrice : 50);
        return [
          ...prev,
          {
            productId: group.productId,
            productName: group.productName,
            sku: group.sku,
            unitName: group.unitName || 'ชิ้น',
            quantity: clampedQty,
            unitCost: unitCost,
            itemType: 'DEFECTIVE',
            defectReason: group.defectReasons.join(', ') || 'สินค้าชำรุด/มีปัญหา',
            claimId: group.claimIds.join(', '),
            originalOrderNumber: group.orderNumbers.join(', ') || undefined,
            poId: selectedPoId || undefined,
            poNumber: selectedPO?.poNumber || undefined,
          },
        ];
      }
    });
  };

  // Update deduction cost for a grouped defective claim product
  const updateGroupReturnCost = (group: GroupedClaimProduct, newCost: number) => {
    const clampedCost = Math.max(0, newCost);
    setReturnItems((prev) => {
      const existingIdx = prev.findIndex(
        (i) => (i.productId && i.productId === group.productId) || (i.sku && i.sku === group.sku)
      );
      if (existingIdx >= 0) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, unitCost: clampedCost } : item
        );
      } else {
        return [
          ...prev,
          {
            productId: group.productId,
            productName: group.productName,
            sku: group.sku,
            unitName: group.unitName || 'ชิ้น',
            quantity: group.totalQuantity,
            unitCost: clampedCost,
            itemType: 'DEFECTIVE',
            defectReason: group.defectReasons.join(', ') || 'สินค้าชำรุด/มีปัญหา',
            claimId: group.claimIds.join(', '),
            originalOrderNumber: group.orderNumbers.join(', ') || undefined,
            poId: selectedPoId || undefined,
            poNumber: selectedPO?.poNumber || undefined,
          },
        ];
      }
    });
  };

  // Add overstock product item
  const handleAddOverstockItem = () => {
    if (!selectedProduct) {
      toast.error('กรุณาเลือกสินค้าของผู้จำหน่าย');
      return;
    }
    const qty = parseQty(overstockQty, allowDecimalQty) || 0;
    const cost = parseFloat(overstockCost) || 0;

    if (qty <= 0) {
      toast.error('กรุณาระบุจำนวนสินค้าที่ต้องการคืนมากกว่า 0');
      return;
    }
    const currentStock = Number(selectedProduct.stock || 0);
    if (qty > currentStock) {
      toast.error(`จำนวนที่คืน (${qty}) มากกว่าสต็อกที่มีในคลัง (${currentStock} ชิ้น)`);
      return;
    }

    const newItem: CreateSupplierReturnItemInput = {
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      sku: selectedProduct.sku,
      unitName: selectedProduct.unit || selectedProduct.units?.[0]?.unitName || selectedProduct.units?.[0]?.name || 'ชิ้น',
      quantity: qty,
      unitCost: cost,
      itemType: 'OVERSTOCK',
      returnReason: overstockReason.trim() || 'สินค้าปกติขายไม่ออก / คืนสต็อก',
      poId: selectedPoId || undefined,
      poNumber: selectedPO?.poNumber || undefined,
    };

    setReturnItems((prev) => [...prev, newItem]);
    setSelectedProduct(null);
    setProductSearch('');
    setOverstockQty('1');
    setOverstockCost('0');
    toast.success(`เพิ่มสินค้าปกติ "${selectedProduct.name}" เข้ารายการส่งคืนเรียบร้อย`);
  };

  const handleUpdateItemQty = (idx: number, newQty: number) => {
    if (newQty <= 0) return;
    setReturnItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, quantity: roundQty(newQty) } : item))
    );
  };

  const handleUpdateItemCost = (idx: number, newCost: number) => {
    if (newCost < 0) return;
    setReturnItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, unitCost: newCost } : item))
    );
  };

  const handleRemoveItem = (idx: number) => {
    setReturnItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Submit and create return note
  const handleSubmit = async () => {
    if (!currentSupplier) {
      toast.error('กรุณาเลือกผู้จำหน่าย');
      return;
    }
    if (returnItems.length === 0) {
      toast.error('กรุณาเลือกหรือเพิ่มรายการสินค้าที่ต้องการส่งคืนอย่างน้อย 1 รายการ');
      return;
    }
    const badItem = returnItems.find((i) => !isValidQty(Number(i.quantity), { allowDecimal: allowDecimalQty }) || !Number.isFinite(Number(i.unitCost)) || Number(i.unitCost) < 0);
    if (badItem) {
      toast.error(`รายการ "${badItem.productName || ''}" ต้องมีจำนวน${allowDecimalQty ? 'มากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)' : 'เป็นจำนวนเต็มมากกว่า 0'} และต้นทุนไม่ติดลบ`);
      return;
    }
    if (finalEffectiveCredit > grandTotalCost + 0.001) {
      toast.error(`ยอดเครดิตต้องไม่เกินมูลค่าสินค้าที่ส่งคืน (${grandTotalCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท)`);
      return;
    }

    setIsSubmitting(true);
    try {
      let resultNote: SupplierReturnNote;
      if (editingNote) {
        resultNote = await updateSupplierReturnNote(editingNote.id, {
          supplierId: currentSupplier.id,
          supplierName: currentSupplier.name,
          supplierContact: currentSupplier.contactName,
          supplierPhone: currentSupplier.phone,
          supplierAddress: currentSupplier.address,
          linkedPoId: selectedPoId || undefined,
          linkedPoNumber: selectedPO?.poNumber || undefined,
          items: returnItems,
          customCreditAmount: finalEffectiveCredit,
          notes: notes.trim() || undefined,
        });
        toast.success(`✅ อัปเดตเอกสารส่งคืน ${resultNote.id} เรียบร้อยแล้ว`);
      } else {
        resultNote = await createSupplierReturnNote({
          supplierId: currentSupplier.id,
          supplierName: currentSupplier.name,
          supplierContact: currentSupplier.contactName,
          supplierPhone: currentSupplier.phone,
          supplierAddress: currentSupplier.address,
          linkedPoId: selectedPoId || undefined,
          linkedPoNumber: selectedPO?.poNumber || undefined,
          items: returnItems,
          customCreditAmount: finalEffectiveCredit,
          notes: notes.trim() || undefined,
          autoDeductFromPo: false,
        });
        toast.success(`✅ สร้างใบส่งคืน / ใบลดหนี้ ${resultNote.id} เรียบร้อยแล้ว`);
      }

      onSuccess(resultNote);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to save supplier return note:', err);
      toast.error((err as Error).message || 'เกิดข้อผิดพลาดในการบันทึกเอกสารส่งคืน');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredSupplierProducts = supplierProducts.filter((p) =>
    (p.name || '').toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.sku || '').toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] sm:max-w-4xl max-h-[94vh] flex flex-col bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-900">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <span>
                {editingNote ? `แก้ไขใบส่งคืนสินค้า / ใบลดหนี้ (${editingNote.id})` : 'สร้างใบส่งเคลม / คืนสินค้าบริษัทผู้จำหน่าย'}
              </span>
            </DialogTitle>
          </div>
          <p className="text-xs text-slate-500 font-medium pt-1">
            {editingNote
              ? 'แก้ไขรายการสินค้า จำนวน ต้นทุน หรือยอดลดหนี้จริงของเอกสารฉบับนี้'
              : 'ยึดตามผู้จำหน่าย เลือกสินค้าจากสต็อกของเคลมหรือสินค้าปกติในคลัง และเลือกลดหนี้กับใบสั่งซื้อ (PO) ได้อิสระ'}
          </p>
        </DialogHeader>

        {/* Form Body */}
        <div className="space-y-4 py-3 flex-1 overflow-y-auto pr-1">
          {/* STEP 1: Select Supplier */}
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-2">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-indigo-600" />
              <span>1. เลือกบริษัทผู้จำหน่าย (ยึดตามคู่ค้า):</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {suppliers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSupplierId(s.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    selectedSupplierId === s.id
                      ? 'border-indigo-500 bg-indigo-50/70 text-indigo-950 font-bold ring-2 ring-indigo-400/30 shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  <p className="text-xs font-bold truncate">{s.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {s.contactName ? `ติดต่อ: ${s.contactName}` : s.phone || 'ไม่มีข้อมูลติดต่อ'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* STEP 2: Link PO to Reduce Debt (No forcing PO item pick) */}
          <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-amber-600" />
                <span>2. เลือกใบสั่งซื้อ (PO) ที่ต้องการลดหนี้ (ระบุตามต้องการ):</span>
              </label>
              {selectedPoId && (
                <button
                  type="button"
                  onClick={() => setSelectedPoId('')}
                  className="text-[11px] text-rose-600 hover:underline font-bold"
                >
                  ไม่เลือกลดหนี้ PO
                </button>
              )}
            </div>

            {supplierPosError && (
              <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-200 mb-2">{supplierPosError}</p>
            )}
            {payablePOs.length === 0 ? (
              <p className="text-xs text-slate-400 italic bg-white p-2.5 rounded-xl border border-slate-200">
                ไม่มีใบสั่งซื้อที่มียอดค้างชำระของผู้จำหน่ายรายนี้ (สามารถออกเอกสารส่งคืนเพื่อถือเครดิตไว้หักรอบหน้าได้)
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {payablePOs.map((po) => (
                    <button
                      key={po.id}
                      type="button"
                      onClick={() => setSelectedPoId(po.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        selectedPoId === po.id
                          ? 'border-amber-500 bg-amber-50 text-amber-950 font-bold ring-2 ring-amber-400/30'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-mono font-bold">{po.poNumber}</span>
                        <Badge variant="outline" className="text-[10px] bg-white border-amber-300 text-amber-800">
                          หนี้คงเหลือ {formatCurrency(po.remainingPayable)}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        วันที่: {new Date(po.poDate).toLocaleDateString('th-TH')} | รวม {po.items.length} รายการ
                      </p>
                    </button>
                  ))}
                </div>

                {/* Selected PO Confirmation Banner */}
                {selectedPO && (
                  <div className="bg-amber-50/80 p-3 rounded-xl border border-amber-200 mt-2 flex flex-col sm:flex-row justify-between sm:items-center gap-2 text-xs">
                    <div>
                      <p className="font-bold text-amber-950">
                        ✓ เลือกใบสั่งซื้อ: <span className="font-mono text-amber-900">{selectedPO.poNumber}</span>
                      </p>
                      <p className="text-[11px] text-amber-800">
                        ยอดหนี้ค้างชำระปัจจุบัน: <strong className="font-mono font-bold">{formatCurrency(selectedPO.remainingPayable)}</strong> (หักใบลดหนี้ได้ตอนทำใบสำคัญจ่ายที่หน้าเจ้าหนี้)
                      </p>
                    </div>
                    <Badge className="bg-amber-600 text-white text-[11px] font-bold self-start sm:self-auto">
                      พร้อมตัดหนี้ PO
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* STEP 3: Choose Return Items (Defective Claim Stock vs Normal Stock) */}
          <div className="space-y-3 pt-1">
            <label className="text-xs font-bold text-slate-800 block">
              3. เลือกสินค้าที่จะส่งคืน (จากสต็อกของเคลม หรือ สินค้าปกติในคลัง):
            </label>

            <Tabs value={activeItemTab} onValueChange={(v) => setActiveItemTab(v as typeof activeItemTab)} className="w-full">
              <TabsList className="grid grid-cols-2 h-11 bg-slate-100 p-1 rounded-2xl">
                <TabsTrigger
                  value="defective"
                  className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:text-rose-700 data-[state=active]:shadow-xs gap-1.5"
                >
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>สต็อกของเคลม ({supplierGroups.totals.groups} รายการ / {formatQty(supplierGroups.totals.pieces)} ชิ้น)</span>
                </TabsTrigger>
                <TabsTrigger
                  value="overstock"
                  className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:text-sky-700 data-[state=active]:shadow-xs gap-1.5"
                >
                  <Package className="w-4 h-4 text-sky-600" />
                  <span>สินค้าปกติในคลัง (ขายไม่ออก / คืนสต็อก)</span>
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: DEFECTIVE CLAIM STOCK (GROUPED BY PRODUCT) */}
              <TabsContent value="defective" className="pt-2 space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    value={claimSearch}
                    onChange={(e) => setClaimSearch(e.target.value)}
                    placeholder="ค้นหาสินค้าเคลม (ชื่อสินค้า, SKU, เลขที่เคลม, บิลขาย)..."
                    className="pl-8 h-9 text-xs rounded-xl"
                  />
                </div>
                {claimGroupsError && (
                  <div className="p-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">{claimGroupsError}</div>
                )}
                {groupedSupplierClaims.length === 0 && groupedOtherClaims.length === 0 ? (
                  <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-400">
                    ไม่มีสินค้าชำรุดในสต็อกของเคลมที่รอส่งคืนบริษัทในระบบ
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupedSupplierClaims.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto space-y-2 pr-1 border border-slate-200 rounded-2xl p-2.5 bg-slate-50/50">
                        {groupedSupplierClaims.map((group) => {
                          const currentItem = returnItems.find(
                            (i) => (i.productId && i.productId === group.productId) || (i.sku && i.sku === group.sku)
                          );
                          const isSelected = !!currentItem;

                          return isSelected && currentItem ? (
                            <div
                              key={group.groupKey}
                              className="p-3.5 rounded-2xl border-2 border-rose-400 bg-rose-50/50 shadow-xs ring-1 ring-rose-300 transition-all space-y-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div
                                  className="flex items-start gap-2.5 cursor-pointer flex-1"
                                  onClick={() => toggleGroupedClaimItem(group)}
                                >
                                  <CheckSquare className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
                                  <div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p className="text-xs font-bold text-slate-900">{group.productName}</p>
                                      <Badge className="bg-rose-600 text-white text-[9px] py-0 font-bold">
                                        เลือกส่งคืนแล้ว
                                      </Badge>
                                      <span className="text-[11px] text-slate-500 font-medium">
                                        (มีในสต็อกทั้งหมด {group.totalQuantity} {group.unitName})
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                                      <span>SKU: {group.sku}</span>
                                      <span>•</span>
                                      <span className="text-rose-600 font-medium truncate max-w-xs">
                                        อาการ: {group.defectReasons.join(', ') || 'ชำรุด'}
                                      </span>
                                      {group.claimCount > 1 && (
                                        <>
                                          <span>•</span>
                                          <span className="text-slate-400">จาก {group.claimCount} บิลเคลม</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => toggleGroupedClaimItem(group)}
                                  className="text-xs text-slate-400 hover:text-rose-600 font-bold"
                                >
                                  นำออก
                                </button>
                              </div>

                              {/* Editable Quantity & Unit Cost */}
                              <div className="bg-white p-3 rounded-xl border border-rose-200 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end text-xs">
                                <div>
                                  <div className="flex justify-between items-center mb-1">
                                    <label className="text-[11px] font-bold text-slate-700">
                                      จำนวนที่จะส่งคืน / ลดหนี้:
                                    </label>
                                    {currentItem.quantity !== group.totalQuantity && (
                                      <button
                                        type="button"
                                        onClick={() => updateGroupReturnQty(group, group.totalQuantity)}
                                        className="text-[10px] font-bold text-rose-600 hover:underline"
                                      >
                                        คืนทั้งหมด ({group.totalQuantity})
                                      </button>
                                    )}
                                  </div>
                                  <div className="relative">
                                    <Input
                                      type="number"
                                      min={qtyStep(allowDecimalQty)}
                                      step={qtyStep(allowDecimalQty)}
                                      inputMode={qtyInputMode(allowDecimalQty)}
                                      max={group.totalQuantity}
                                      value={currentItem.quantity}
                                      onChange={(e) => updateGroupReturnQty(group, parseQty(e.target.value, allowDecimalQty) || (allowDecimalQty ? 0 : 1))}
                                      className="h-9 text-xs font-mono font-black text-center bg-slate-50 border-slate-300"
                                    />
                                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                                      {group.unitName}
                                    </span>
                                  </div>
                                </div>

                                <div>
                                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                                    ราคาทุนต่อหน่วยที่จะขอลดหนี้ (฿):
                                  </label>
                                  <div className="relative">
                                    <Input
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={currentItem.unitCost}
                                      onChange={(e) => updateGroupReturnCost(group, parseFloat(e.target.value) || 0)}
                                      className="h-9 text-xs font-mono font-black text-right bg-slate-50 border-slate-300 pr-8"
                                    />
                                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                                      ฿
                                    </span>
                                  </div>
                                </div>

                                <div className="bg-rose-50/70 p-2 px-3 rounded-lg border border-rose-200 text-right">
                                  <span className="text-[10px] text-rose-800 font-bold block">
                                    รวมยอดลดหนี้รายการนี้:
                                  </span>
                                  <span className="text-base font-mono font-black text-rose-900">
                                    {formatCurrency(currentItem.quantity * currentItem.unitCost)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div
                              key={group.groupKey}
                              className="p-3 rounded-2xl border border-slate-200 bg-white hover:border-rose-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer"
                              onClick={() => toggleGroupedClaimItem(group)}
                            >
                              <div className="flex items-start gap-2.5">
                                <Square className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                                <div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-xs font-bold text-slate-900">{group.productName}</p>
                                    <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[9px] py-0 font-semibold">
                                      มีของชำรุด {group.totalQuantity} {group.unitName}
                                    </Badge>
                                    {group.claimCount > 1 && (
                                      <Badge variant="outline" className="text-[9px] py-0 text-slate-500 bg-slate-50">
                                        รวมจาก {group.claimCount} ใบเคลม
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                                    <span>SKU: {group.sku}</span>
                                    <span>•</span>
                                    <span className="text-rose-600 font-medium truncate max-w-xs">
                                      อาการ: {group.defectReasons.join(', ') || 'ชำรุด'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-between sm:justify-end gap-3 pl-6 sm:pl-0">
                                <div className="text-right">
                                  <span className="text-xs font-mono font-bold block text-slate-900">
                                    ในสต็อก: {group.totalQuantity} {group.unitName}
                                  </span>
                                  <span className="text-[11px] text-slate-500 font-mono">
                                    ทุนเดิม @{formatCurrency(group.costPrice || 50)}
                                  </span>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs font-bold rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                                >
                                  + เลือกลดหนี้
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                        {supplierGroups.data.length < supplierGroups.meta.total && (
                          <Button type="button" size="sm" variant="outline" onClick={() => loadMoreGroups('supplier')} className="w-full h-8 text-xs font-bold rounded-xl">
                            แสดงเพิ่ม ({supplierGroups.data.length} จาก {supplierGroups.meta.total} รายการสินค้า)
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 text-center bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-500">
                        ไม่พบสินค้าชำรุดที่ระบุผู้จำหน่ายรายนี้โดยตรง
                      </div>
                    )}

                    {/* Expandable section for other unreturned defective claims */}
                    {otherGroups.meta.total > 0 && (
                      <div className="pt-2 border-t border-slate-200 space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setShowOtherClaims(!showOtherClaims)}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 transition-colors p-1"
                        >
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showOtherClaims ? 'rotate-180' : ''}`} />
                          <span>
                            {showOtherClaims
                              ? 'ซ่อนสินค้าชำรุดรายการอื่นในสต็อก'
                              : `แสดงสินค้าชำรุดรายการอื่นในสต็อกของเคลม (${otherGroups.meta.total} รายการสินค้า)`}
                          </span>
                        </button>

                        {showOtherClaims && (
                          <div className="max-h-60 overflow-y-auto space-y-2 pr-1 border border-indigo-100 rounded-2xl p-2.5 bg-indigo-50/30">
                            <p className="text-[11px] text-indigo-800 font-medium pb-1 px-1">
                              💡 สามารถคลิกเลือกรายการด้านล่างเพื่อดึงมาส่งคืนและลดหนี้กับบริษัทนี้ได้:
                            </p>
                            {groupedOtherClaims.map((group) => {
                              const currentItem = returnItems.find(
                                (i) => (i.productId && i.productId === group.productId) || (i.sku && i.sku === group.sku)
                              );
                              const isSelected = !!currentItem;

                              return isSelected && currentItem ? (
                                <div
                                  key={group.groupKey}
                                  className="p-3.5 rounded-2xl border-2 border-indigo-400 bg-indigo-50/60 shadow-xs ring-1 ring-indigo-300 transition-all space-y-3"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div
                                      className="flex items-start gap-2.5 cursor-pointer flex-1"
                                      onClick={() => toggleGroupedClaimItem(group)}
                                    >
                                      <CheckSquare className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                                      <div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <p className="text-xs font-bold text-slate-900">{group.productName}</p>
                                          <Badge className="bg-indigo-600 text-white text-[9px] py-0 font-bold">
                                            เลือกส่งคืนแล้ว
                                          </Badge>
                                          {group.supplierName && (
                                            <Badge variant="outline" className="text-[9px] py-0 text-slate-500 bg-white">
                                              {group.supplierName}
                                            </Badge>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                                          <span>SKU: {group.sku}</span>
                                          <span>•</span>
                                          <span className="text-rose-600 font-medium truncate max-w-xs">
                                            อาการ: {group.defectReasons.join(', ') || 'ชำรุด'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => toggleGroupedClaimItem(group)}
                                      className="text-xs text-slate-400 hover:text-indigo-600 font-bold"
                                    >
                                      นำออก
                                    </button>
                                  </div>

                                  <div className="bg-white p-3 rounded-xl border border-indigo-200 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end text-xs">
                                    <div>
                                      <div className="flex justify-between items-center mb-1">
                                        <label className="text-[11px] font-bold text-slate-700">
                                          จำนวนที่จะส่งคืน:
                                        </label>
                                        {currentItem.quantity !== group.totalQuantity && (
                                          <button
                                            type="button"
                                            onClick={() => updateGroupReturnQty(group, group.totalQuantity)}
                                            className="text-[10px] font-bold text-indigo-600 hover:underline"
                                          >
                                            คืนทั้งหมด ({group.totalQuantity})
                                          </button>
                                        )}
                                      </div>
                                      <div className="relative">
                                        <Input
                                          type="number"
                                          min={qtyStep(allowDecimalQty)}
                                          step={qtyStep(allowDecimalQty)}
                                          inputMode={qtyInputMode(allowDecimalQty)}
                                          max={group.totalQuantity}
                                          value={currentItem.quantity}
                                          onChange={(e) => updateGroupReturnQty(group, parseQty(e.target.value, allowDecimalQty) || (allowDecimalQty ? 0 : 1))}
                                          className="h-9 text-xs font-mono font-black text-center bg-slate-50 border-slate-300"
                                        />
                                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                                          {group.unitName}
                                        </span>
                                      </div>
                                    </div>

                                    <div>
                                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                                        ราคาทุนต่อหน่วย (฿):
                                      </label>
                                      <div className="relative">
                                        <Input
                                          type="number"
                                          min="0"
                                          step="any"
                                          value={currentItem.unitCost}
                                          onChange={(e) => updateGroupReturnCost(group, parseFloat(e.target.value) || 0)}
                                          className="h-9 text-xs font-mono font-black text-right bg-slate-50 border-slate-300 pr-8"
                                        />
                                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
                                          ฿
                                        </span>
                                      </div>
                                    </div>

                                    <div className="bg-indigo-50/70 p-2 px-3 rounded-lg border border-indigo-200 text-right">
                                      <span className="text-[10px] text-indigo-800 font-bold block">
                                        รวมยอดลดหนี้:
                                      </span>
                                      <span className="text-base font-mono font-black text-indigo-900">
                                        {formatCurrency(currentItem.quantity * currentItem.unitCost)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  key={group.groupKey}
                                  className="p-3 rounded-2xl border border-slate-200 bg-white hover:border-indigo-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer"
                                  onClick={() => toggleGroupedClaimItem(group)}
                                >
                                  <div className="flex items-start gap-2.5">
                                    <Square className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                                    <div>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <p className="text-xs font-bold text-slate-900">{group.productName}</p>
                                        <Badge className="bg-slate-100 text-slate-800 border-slate-200 text-[9px] py-0 font-semibold">
                                          ชำรุด {group.totalQuantity} {group.unitName}
                                        </Badge>
                                        {group.supplierName && (
                                          <Badge variant="outline" className="text-[9px] py-0 text-slate-500 bg-white">
                                            {group.supplierName}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                                        <span>SKU: {group.sku}</span>
                                        <span>•</span>
                                        <span className="text-rose-600 font-medium truncate max-w-xs">
                                          อาการ: {group.defectReasons.join(', ') || 'ชำรุด'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between sm:justify-end gap-3 pl-6 sm:pl-0">
                                    <div className="text-right">
                                      <span className="text-xs font-mono font-bold block text-slate-900">
                                        ในสต็อก: {group.totalQuantity} {group.unitName}
                                      </span>
                                      <span className="text-[11px] text-slate-500 font-mono">
                                        ทุน @{formatCurrency(group.costPrice || 50)}
                                      </span>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs font-bold rounded-lg border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                    >
                                      + เลือกลดหนี้
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                            {otherGroups.data.length < otherGroups.meta.total && (
                              <Button type="button" size="sm" variant="outline" onClick={() => loadMoreGroups('other')} className="w-full h-8 text-xs font-bold rounded-xl">
                                แสดงเพิ่ม ({otherGroups.data.length} จาก {otherGroups.meta.total} รายการสินค้า)
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* TAB 2: NORMAL / OVERSTOCK GOODS IN STORE */}
              <TabsContent value="overstock" className="pt-2 space-y-3">
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">
                      ค้นหาสินค้าของผู้จำหน่ายรายนี้ ({currentSupplier?.name}):
                    </label>
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        type="text"
                        placeholder="พิมพ์ชื่อสินค้า หรือ SKU เพื่อค้นหา..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="pl-9 h-10 text-xs bg-white"
                      />
                    </div>

                    {/* Product Search Results Dropdown */}
                    {productSearch && (
                      <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl bg-white divide-y shadow-md">
                        {filteredSupplierProducts.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-400">
                            ไม่พบสินค้าของผู้จำหน่ายรายนี้ที่ตรงกับการค้นหา
                          </div>
                        ) : (
                          filteredSupplierProducts.slice(0, 10).map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setSelectedProduct(p);
                                setOverstockCost(String(p.costPrice || p.basePrice || 0));
                                setProductSearch('');
                              }}
                              className="w-full p-2 text-left hover:bg-sky-50 flex justify-between items-center text-xs"
                            >
                              <div>
                                <p className="font-bold text-slate-800">{p.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono">SKU: {p.sku} | สต็อกคงเหลือ: {p.stock || 0} ชิ้น</p>
                              </div>
                              <span className="font-bold text-sky-700 font-mono">
                                ทุน: {formatCurrency(p.costPrice || p.basePrice || 0)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Selected Product Form */}
                  {selectedProduct && (
                    <div className="bg-sky-50/60 p-3 rounded-xl border border-sky-200 space-y-2.5">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-xs font-bold text-slate-900">{selectedProduct.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            SKU: {selectedProduct.sku} | สต็อกปัจจุบัน: {selectedProduct.stock || 0} ชิ้น
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedProduct(null)}
                          className="text-xs text-slate-400 hover:text-red-500 font-bold"
                        >
                          ยกเลิก
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <label className="text-[11px] font-bold text-slate-600 block mb-1">
                            จำนวนที่คืน (ชิ้น):
                          </label>
                          <Input
                            type="number"
                            min={qtyStep(allowDecimalQty)}
                            step={qtyStep(allowDecimalQty)}
                            inputMode={qtyInputMode(allowDecimalQty)}
                            max={selectedProduct.stock || 9999}
                            value={overstockQty}
                            onChange={(e) => setOverstockQty(e.target.value)}
                            className="h-9 bg-white font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-slate-600 block mb-1">
                            ราคาทุนต่อชิ้น (฿):
                          </label>
                          <Input
                            type="number"
                            step="any"
                            value={overstockCost}
                            onChange={(e) => setOverstockCost(e.target.value)}
                            className="h-9 bg-white font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-slate-600 block mb-1">
                            เหตุผลการคืน:
                          </label>
                          <Input
                            type="text"
                            value={overstockReason}
                            onChange={(e) => setOverstockReason(e.target.value)}
                            className="h-9 bg-white text-[11px]"
                          />
                        </div>
                      </div>

                      <Button
                        type="button"
                        onClick={handleAddOverstockItem}
                        size="sm"
                        className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold h-8 text-xs rounded-lg"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        เพิ่มสินค้าปกติลงในรายการส่งคืน
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* TABLE OF CHOSEN RETURN ITEMS */}
          <div className="space-y-2 pt-2 border-t border-slate-200">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <span>รายการสินค้าที่เลือกส่งคืน ({returnItems.length} รายการ):</span>
              </span>
              {returnItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setReturnItems([])}
                  className="text-[11px] text-rose-600 hover:underline font-semibold"
                >
                  ล้างทั้งหมด
                </button>
              )}
            </div>

            {returnItems.length === 0 ? (
              <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-2xl text-xs text-slate-400">
                ยังไม่มีรายการสินค้าที่เลือก กรุณาเลือกสินค้าจากสต็อกของเคลม (หมวด 1) หรือสินค้าปกติ (หมวด 2) ด้านบน
              </div>
            ) : (
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold">
                    <tr>
                      <th className="p-2.5 text-center w-14">ประเภท</th>
                      <th className="p-2.5 text-left">สินค้า / SKU</th>
                      <th className="p-2.5 text-left">เหตุผลที่ส่งคืน</th>
                      <th className="p-2.5 text-center w-24">จำนวน</th>
                      <th className="p-2.5 text-right w-28">ราคาทุน</th>
                      <th className="p-2.5 text-right w-28">รวมทุน (฿)</th>
                      <th className="p-2.5 text-center w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {returnItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="p-2.5 text-center">
                          {item.itemType === 'DEFECTIVE' ? (
                            <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 text-[10px] font-bold border-rose-300">
                              ชำรุด
                            </Badge>
                          ) : (
                            <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100 text-[10px] font-bold border-sky-300">
                              ปกติ
                            </Badge>
                          )}
                        </td>
                        <td className="p-2.5">
                          <p className="font-bold text-slate-800">{item.productName}</p>
                          <p className="text-[10px] text-slate-400 font-mono">SKU: {item.sku}</p>
                          {item.claimId && (
                            <p className="text-[10px] text-indigo-600 font-medium">ใบเคลม: #{item.claimId}</p>
                          )}
                        </td>
                        <td className="p-2.5 text-slate-600 text-[11px]">
                          {item.itemType === 'DEFECTIVE' ? item.defectReason : item.returnReason}
                        </td>
                        <td className="p-2.5 text-center">
                          <Input
                            type="number"
                            min={qtyStep(allowDecimalQty)}
                            step={qtyStep(allowDecimalQty)}
                            inputMode={qtyInputMode(allowDecimalQty)}
                            value={item.quantity}
                            onChange={(e) => handleUpdateItemQty(idx, parseQty(e.target.value, allowDecimalQty) || (allowDecimalQty ? 0.01 : 1))}
                            className="h-7 w-16 text-center font-mono font-bold text-xs mx-auto"
                          />
                        </td>
                        <td className="p-2.5 text-right">
                          <Input
                            type="number"
                            step="any"
                            value={item.unitCost}
                            onChange={(e) => handleUpdateItemCost(idx, parseFloat(e.target.value) || 0)}
                            className="h-7 w-20 text-right font-mono text-xs ml-auto"
                          />
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(item.unitCost * item.quantity)}
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="text-slate-400 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* NOTES & SUMMARY & EDITABLE DEDUCTION AMOUNT */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">หมายเหตุเพิ่มเติม:</label>
              <Input
                type="text"
                placeholder="ระบุข้อความอ้างอิง เช่น หักส่วนลดท้ายบิล..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />

              {selectedPO && (
                <p className="pt-2 text-[11px] text-slate-500">
                  ใบลดหนี้จะถูกนำไปหักกับ {selectedPO.poNumber} ตอนทำใบสำคัญจ่ายที่หน้า “เจ้าหนี้การค้า &amp; จ่ายเงิน” เพื่อให้ยอดหนี้ตรงกับฐานข้อมูล
                </p>
              )}
            </div>

            {/* Reconciliation Card with Editable Deduction Amount */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>ยอดรวมสินค้าชำรุด (หมวด 1):</span>
                <span className="font-mono font-bold text-rose-700">{formatCurrency(defectiveTotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>ยอดรวมสินค้าปกติ (หมวด 2):</span>
                <span className="font-mono font-bold text-sky-700">{formatCurrency(overstockTotal)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-xs text-slate-600">
                <span>รวมราคาทุนสินค้าทั้งหมด:</span>
                <span className="font-mono font-bold text-slate-800">{formatCurrency(grandTotalCost)}</span>
              </div>

              {/* Editable Custom Deduction Amount */}
              <div className="bg-white p-3 rounded-xl border border-indigo-200 mt-1.5 space-y-1.5 shadow-2xs">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-bold text-indigo-950 flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    <span>ยอดเงินที่ใช้ลดหนี้จริง (฿):</span>
                  </label>
                  {isCustomEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomEdited(false);
                        setCustomDeductAmountStr(String(grandTotalCost));
                      }}
                      className="text-[11px] text-indigo-600 hover:underline font-bold flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>รีเซ็ตตามยอดทุน</span>
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={customDeductAmountStr}
                    onChange={(e) => {
                      setIsCustomEdited(true);
                      setCustomDeductAmountStr(e.target.value);
                    }}
                    className="h-10 text-base font-mono font-black text-slate-900 bg-slate-50 border-slate-300 pr-12 text-right rounded-lg"
                    placeholder="0.00"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    บาท
                  </span>
                </div>
                <p className="text-[10.5px] text-slate-500 italic leading-tight">
                  * สามารถปรับแก้ตัวเลขได้ตามจริง (เช่น มีส่วนลดท้ายบิลเวลาบริษัทเรียกเก็บเงิน หรือตกลงยอดพิเศษ)
                </p>
              </div>

              {selectedPO && (
                <div className="border-t border-dashed border-amber-300 pt-2 text-[11px] text-amber-900 font-semibold space-y-0.5">
                  <div className="flex justify-between">
                    <span>หนี้เดิมของ {selectedPO.poNumber}:</span>
                    <span className="font-mono">{formatCurrency(selectedPO.remainingPayable)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-xs">
                    <span>ยอดหนี้สุทธิหลังหัก (เมื่อทำใบสำคัญจ่าย):</span>
                    <span className="font-mono text-emerald-700">
                      {formatCurrency(Math.max(0, selectedPO.remainingPayable - finalEffectiveCredit))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="pt-3 border-t border-slate-100 flex justify-between items-center shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl font-bold text-slate-700"
          >
            ยกเลิก
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || returnItems.length === 0}
            className="rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-md"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {editingNote
                ? `บันทึกการแก้ไขเอกสาร (ยอดลดหนี้ ฿${finalEffectiveCredit.toLocaleString()})`
                : `ยืนยันและออกเอกสารส่งคืน (ลดหนี้ ฿${finalEffectiveCredit.toLocaleString()})`}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
