'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  verifyClaimEligibility, 
  processClaim, 
  ClaimVerificationQuery,
  loadAllClaimRecords 
} from '@/lib/claim-service';
import { ClaimEligibleItem, ClaimResolutionType, ClaimRecord, Product, ProductUnit } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useCartStore } from '@/lib/store/cart-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { useProductStore } from '@/lib/store/product-store';
import { loadCustomers } from '@/lib/customer-service';
import { BankAccount, loadBankAccounts } from '@/lib/bank-account-storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ShieldAlert,
  Search,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Banknote,
  Percent,
  Truck,
  ArrowRight,
  Package,
  Calendar,
  User,
  Phone,
  FileText,
  ScanLine,
  RefreshCw,
  Clock,
  Sparkles,
  QrCode,
  CreditCard,
  Layers
} from 'lucide-react';
import { toast } from 'sonner';

interface ProductClaimModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClaimCompleted?: (claim: ClaimRecord) => void;
  isBackoffice?: boolean;
}

export function ProductClaimModal({
  open,
  onOpenChange,
  onClaimCompleted,
  isBackoffice = false,
}: ProductClaimModalProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [eligibleItems, setEligibleItems] = useState<ClaimEligibleItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ClaimEligibleItem | null>(null);

  // Form State
  const [claimQty, setClaimQty] = useState(1);
  const [selectedClaimUnit, setSelectedClaimUnit] = useState<{
    id: string;
    unitName: string;
    factor: number;
    price: number;
    barcode?: string;
  } | null>(null);
  const [defectReason, setDefectReason] = useState('');
  const [resolutionType, setResolutionType] = useState<ClaimResolutionType>('REPLACE_ITEM');
  const [customRefundAmount, setCustomRefundAmount] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [refundAccountId, setRefundAccountId] = useState<string>('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Replacement Product Customization (คนละตัว / คนละลาย / คนละสี / คนละบาร์โค้ด)
  const [replacementMode, setReplacementMode] = useState<'SAME_MODEL' | 'CUSTOM_MODEL'>('SAME_MODEL');
  const [replacementSearch, setReplacementSearch] = useState('');
  const [selectedReplacementItem, setSelectedReplacementItem] = useState<{
    product: Product;
    unit: ProductUnit;
  } | null>(null);
  const [showReplacementDropdown, setShowReplacementDropdown] = useState(false);

  const cart = useCartStore();
  const { user } = useAuthStore();
  const { products, fetchProducts } = useProductStore();

  // Search only when keyword is entered
  const handleSearch = () => {
    const trimmed = searchKeyword.trim();
    if (!trimmed) {
      setEligibleItems([]);
      return;
    }
    const results = verifyClaimEligibility({
      searchKeyword: trimmed,
    });
    setEligibleItems(results);
  };

  useEffect(() => {
    if (open) {
      const trimmed = searchKeyword.trim();
      if (trimmed) {
        handleSearch();
      } else {
        setEligibleItems([]);
      }
      setReplacementMode('SAME_MODEL');
      setSelectedReplacementItem(null);
      setSelectedClaimUnit(null);
      setReplacementSearch('');
      setShowReplacementDropdown(false);
      const accounts = loadBankAccounts();
      setBankAccounts(accounts);
      setRefundAccountId(accounts.find((account) => account.isDefault)?.id || accounts[0]?.id || '');
      // In backoffice mode, force resolution to either REPLACE_ITEM or SUPPLIER_RMA
      if (isBackoffice) {
        setResolutionType('REPLACE_ITEM');
      }
    } else {
      setSearchKeyword('');
      setEligibleItems([]);
      setSelectedItem(null);
      setSelectedClaimUnit(null);
      setClaimQty(1);
      setDefectReason('');
      setResolutionType('REPLACE_ITEM');
      setRefundAccountId('');
      setNote('');
      setReplacementMode('SAME_MODEL');
      setSelectedReplacementItem(null);
      setReplacementSearch('');
      setShowReplacementDropdown(false);
    }
  }, [open, searchKeyword, isBackoffice]);

  // When an item is selected, initialize selectedClaimUnit and reset claim qty to 1
  const handleSelectItem = (item: ClaimEligibleItem) => {
    const totalAvail = item.availableBaseClaimQuantity !== undefined ? item.availableBaseClaimQuantity : item.availableClaimQuantity;
    if (totalAvail <= 0) {
      toast.error('สินค้ารายการนี้เคลมครบตามจำนวนที่ซื้อแล้ว (โควต้าคงเหลือ: 0)');
      return;
    }
    setSelectedItem(item);
    const itemFactor = Number(item.conversionFactor || 1);
    const allowedUnits = (item.availableUnits || []).filter((u) => Number(u.factor || 1) <= itemFactor);
    const defUnit = allowedUnits[0] || {
      id: `u-${item.unitName}`,
      unitName: item.unitName,
      factor: itemFactor,
      price: item.unitPrice,
    };
    setSelectedClaimUnit(defUnit);
    setClaimQty(1);
    setCustomRefundAmount(defUnit.price.toString());
    setReplacementMode('SAME_MODEL');
    setSelectedReplacementItem(null);
    setReplacementSearch('');
  };

  // Matching replacement products when typing or scanning barcode
  const matchingReplacementProducts = useMemo(() => {
    if (!replacementSearch.trim()) return [];
    const q = replacementSearch.toLowerCase().trim();
    const matches: Array<{ product: Product; unit: ProductUnit }> = [];

    products.forEach((p) => {
      (p.units || []).forEach((u) => {
        const nameMatch = (p.name || '').toLowerCase().includes(q);
        const skuMatch = (p.sku || '').toLowerCase().includes(q);
        const barcodeMatch = (u.barcode || '').toLowerCase().includes(q);
        const unitNameMatch = (u.unitName || '').toLowerCase().includes(q);

        if (nameMatch || skuMatch || barcodeMatch || unitNameMatch) {
          matches.push({ product: p, unit: u });
        }
      });
    });

    return matches.slice(0, 10);
  }, [products, replacementSearch]);

  const handleSelectReplacementItem = (p: Product, u: ProductUnit) => {
    setSelectedReplacementItem({ product: p, unit: u });
    setReplacementSearch('');
    setShowReplacementDropdown(false);
  };

  const currentClaimUnit = selectedClaimUnit || {
    id: `u-${selectedItem?.unitName || 'ชิ้น'}`,
    unitName: selectedItem?.unitName || 'ชิ้น',
    factor: selectedItem?.conversionFactor || 1,
    price: selectedItem?.unitPrice || 0,
  };

  const remainingBaseQuota = selectedItem
    ? (selectedItem.availableBaseClaimQuantity !== undefined
        ? selectedItem.availableBaseClaimQuantity
        : selectedItem.availableClaimQuantity * (selectedItem.conversionFactor || 1))
    : 0;

  const maxClaimQty = Math.max(1, Math.floor(remainingBaseQuota / currentClaimUnit.factor));

  // Submit Claim
  const handleSubmitClaim = async () => {
    if (!selectedItem) {
      toast.error('กรุณาเลือกรายการสินค้าที่ต้องการเคลม');
      return;
    }

    if (!defectReason.trim()) {
      toast.error('กรุณาระบุอาการเสียหรือสาเหตุที่เคลม');
      return;
    }

    if (claimQty <= 0 || claimQty > maxClaimQty) {
      toast.error(`จำนวนเคลมต้องไม่เกินโควต้าคงเหลือ (${maxClaimQty} ${currentClaimUnit.unitName})`);
      return;
    }

    if (resolutionType === 'REPLACE_ITEM' && replacementMode === 'CUSTOM_MODEL' && !selectedReplacementItem) {
      toast.error('กรุณาสแกนบาร์โค้ดหรือเลือกสินค้าตัวที่นำไปเปลี่ยนให้ลูกค้า');
      return;
    }

    if (resolutionType === 'REFUND_TRANSFER' && !refundAccountId) {
      toast.error('กรุณาเลือกบัญชีการเงินที่ใช้คืนเงินโอน');
      return;
    }

    setIsSubmitting(true);
    try {
      const claimVal = claimQty * currentClaimUnit.price;
      const refundAmt = Number(customRefundAmount) || claimVal;
      const refundAccount = bankAccounts.find((account) => account.id === refundAccountId);

      const isCustomRepl = resolutionType === 'REPLACE_ITEM' && replacementMode === 'CUSTOM_MODEL' && selectedReplacementItem;
      const replPId = isCustomRepl ? selectedReplacementItem.product.id : selectedItem.productId;
      const replName = isCustomRepl 
        ? `${selectedReplacementItem.product.name} (${selectedReplacementItem.unit.unitName})` 
        : `${selectedItem.productName} (${currentClaimUnit.unitName})`;
      const replSku = isCustomRepl 
        ? (selectedReplacementItem.unit.barcode || selectedReplacementItem.product.sku) 
        : selectedItem.sku;
      const replUnit = isCustomRepl 
        ? selectedReplacementItem.unit.unitName 
        : currentClaimUnit.unitName;
      const replFactor = isCustomRepl 
        ? (selectedReplacementItem.unit.factor || 1) 
        : currentClaimUnit.factor;

      const claimRecord = processClaim({
        item: selectedItem,
        quantity: claimQty,
        chosenUnitName: currentClaimUnit.unitName,
        chosenUnitFactor: currentClaimUnit.factor,
        chosenUnitPrice: currentClaimUnit.price,
        defectReason: defectReason.trim(),
        resolutionType: resolutionType,
        cashierName: user?.name || (isBackoffice ? 'เจ้าหน้าที่คลังหลังบ้าน' : 'พนักงานขาย POS'),
        note: note.trim(),
        refundAmount: refundAmt,
        refundAccountId: resolutionType === 'REFUND_TRANSFER' ? refundAccount?.id : undefined,
        refundAccountLabel: resolutionType === 'REFUND_TRANSFER' && refundAccount
          ? `${refundAccount.bankName} - ${refundAccount.accountName}`
          : undefined,
        refundAccountNumber: resolutionType === 'REFUND_TRANSFER' ? refundAccount?.accountNumber : undefined,
        discountAmount: claimVal,
        replacementProductId: replPId,
        replacementProductName: replName,
        replacementSku: replSku,
        replacementUnitName: replUnit,
        replacementConversionFactor: replFactor,
      });

      // If resolution is STORE_DISCOUNT -> Attach claim discount to current POS cart and auto-select member customer!
      if (resolutionType === 'STORE_DISCOUNT' && !isBackoffice) {
        cart.setAttachedClaim(claimRecord);

        // Auto-match and select member customer in cart
        let finalCustId = selectedItem.customerId || null;
        let finalCustName = selectedItem.customerName || null;
        try {
          const allCusts = loadCustomers();
          const matchedCust = allCusts.find((c) =>
            (selectedItem.customerId && c.id === selectedItem.customerId) ||
            (selectedItem.customerPhone && c.phone === selectedItem.customerPhone) ||
            (selectedItem.customerName && selectedItem.customerName !== 'ลูกค้าทั่วไป' && c.name.trim().toLowerCase() === selectedItem.customerName.trim().toLowerCase())
          );
          if (matchedCust) {
            finalCustId = matchedCust.id;
            finalCustName = matchedCust.name;
          }
        } catch (e) {
          console.warn('Could not load customers for auto-selection', e);
        }

        if (finalCustId || (finalCustName && finalCustName !== 'ลูกค้าทั่วไป')) {
          cart.setCustomer(finalCustId, finalCustName);
        }

        toast.success(
          `🎟️ นำส่วนลดเคลม ${formatCurrency(claimVal)} เข้าบิลขาย และเลือกลูกค้า "${finalCustName || 'ลูกค้าทั่วไป'}" แล้ว (จะเสร็จสมบูรณ์และพิมพ์รวมในใบเสร็จเมื่อชำระเงิน)`
        );
        fetchProducts();
        onOpenChange(false);
        // Do not open separate claim print modal; will print combined with receipt on payment!
        return;
      } else if (resolutionType === 'REPLACE_ITEM') {
        toast.success(`🔄 บันทึกเปลี่ยนสินค้าตัวใหม่ (${replName}) และตัดสต็อกเรียบร้อยแล้ว`);
      } else {
        toast.success(`✅ บันทึกการรับเคลมสินค้า #${claimRecord.id} เรียบร้อยแล้ว`);
      }

      fetchProducts(); // Refresh products stock
      onOpenChange(false);
      if (onClaimCompleted) {
        onClaimCompleted(claimRecord);
      }
    } catch (err) {
      console.error('Failed to process claim:', err);
      toast.error('เกิดข้อผิดพลาดในการบันทึกการรับเคลม');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="w-[85vw] max-w-6xl h-[75vh] max-h-[75vh] bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col overflow-hidden"
      >
        <DialogHeader className="pb-3 border-b border-slate-100 shrink-0">
          <DialogTitle className="text-xl font-extrabold flex items-center justify-between pr-6">
            <div className="flex items-center gap-2.5 text-slate-900">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <span>
                {isBackoffice ? 'ระบบรับเคลมสินค้าหลังบ้าน (Backoffice Claim & RMA)' : 'ระบบรับเคลมสินค้า & ตรวจสอบประวัติการซื้อ (Warranty Claims)'}
              </span>
            </div>
            <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs font-bold font-sans">
              ป้องกันการเคลมซ้ำ / เคลมมั่ว
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 py-3.5 space-y-4 text-xs flex flex-col min-h-0">
          {/* STEP 1: Search & Purchase Matching Box */}
          <div className={`bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col space-y-3 ${selectedItem ? 'shrink-0' : 'flex-1 min-h-0'}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
              <label className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                <Search className="w-4 h-4 text-indigo-600" />
                <span>1. ค้นหาประวัติการซื้อ (เลขออเดอร์, เบอร์โทรลูกค้า, ชื่อลูกค้า, หรือบาร์โค้ดสินค้า):</span>
              </label>
              <span className="text-[11px] text-slate-500">
                {searchKeyword.trim() ? `พบ ${eligibleItems.length} รายการที่ตรงกับเงื่อนไข` : 'กรุณาพิมพ์เพื่อค้นหา'}
              </span>
            </div>

            <div className="relative shrink-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="พิมพ์ค้นหา เช่น ORD-2026..., เบอร์ 081..., ชื่อลูกค้า หรือสแกนบาร์โค้ด..."
                className="pl-9 h-11 bg-white border-slate-300 rounded-xl text-xs sm:text-sm font-semibold shadow-inner focus:border-indigo-500"
                autoFocus
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => setSearchKeyword('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
                >
                  ล้าง
                </button>
              )}
            </div>

            {/* Matching Items Table */}
            <div className={`border border-slate-200 rounded-xl overflow-hidden bg-white overflow-y-auto shadow-2xs ${selectedItem ? 'max-h-[220px]' : 'flex-1 min-h-[300px]'}`}>
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">เลขออเดอร์ / วันที่</th>
                    <th className="py-2.5 px-3">ลูกค้า</th>
                    <th className="py-2.5 px-3">สินค้าที่ซื้อ</th>
                    <th className="py-2.5 px-2 text-center">ซื้อ</th>
                    <th className="py-2.5 px-2 text-center">เคลมแล้ว</th>
                    <th className="py-2.5 px-3 text-center">โควต้าเคลมได้</th>
                    <th className="py-2.5 px-3 text-right">ราคา/หน่วย</th>
                    <th className="py-2.5 px-3 text-center">เลือก</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!searchKeyword.trim() ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-slate-400 text-xs">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-2xs">
                            <Search className="w-6 h-6" />
                          </div>
                          <span className="font-bold text-slate-700 text-sm">
                            พิมพ์คำค้นหาเพื่อตรวจสอบประวัติการซื้อ
                          </span>
                          <p className="text-[11px] text-slate-400 max-w-md leading-relaxed">
                            กรุณากรอก <b>เลขออเดอร์ (ORD-...), เบอร์โทรศัพท์ลูกค้า, ชื่อลูกค้า, หรือสแกนบาร์โค้ดสินค้า</b> เพื่อค้นหาประวัติบิลและคำนวณโควต้าที่สามารถเคลมได้
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : eligibleItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                        <span className="font-bold text-slate-700 text-sm block">ไม่พบประวัติการซื้อที่ตรงกับ &quot;{searchKeyword}&quot;</span>
                        <span className="text-[11px] text-slate-400 block mt-1">
                          (หากลูกค้าไม่ได้ซื้อจากร้าน หรือเคลมครบตามจำนวนแล้ว จะไม่ปรากฏในตาราง)
                        </span>
                      </td>
                    </tr>
                  ) : (
                    eligibleItems.map((item, idx) => {
                      const isSelected =
                        selectedItem?.orderId === item.orderId &&
                        selectedItem?.productId === item.productId &&
                        selectedItem?.isReplacementWarranty === item.isReplacementWarranty;
                      const isQuotaExhausted = item.availableClaimQuantity <= 0;

                      return (
                        <tr
                          key={`${item.orderId}-${item.productId}-${idx}`}
                          onClick={() => !isQuotaExhausted && handleSelectItem(item)}
                          className={`transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-50/90 font-semibold'
                              : isQuotaExhausted
                              ? 'bg-slate-50/80 opacity-50 cursor-not-allowed'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-mono">
                            <div className="font-bold text-indigo-700">{item.orderNumber}</div>
                            <div className="text-[10px] text-slate-400">{formatDate(item.orderDate)}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-800 flex items-center gap-1">
                              <User className="w-3 h-3 text-slate-400" />
                              <span>{item.customerName}</span>
                            </div>
                            {item.customerPhone && (
                              <div className="text-[10px] text-slate-400 font-mono">{item.customerPhone}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-900 line-clamp-1">{item.productName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{item.sku}</div>
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono font-bold text-slate-700">
                            {item.boughtQuantity}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono text-slate-500">
                            {item.alreadyClaimedQuantity > 0 ? (
                              <span className="text-amber-700 font-bold">{item.alreadyClaimedQuantity}</span>
                            ) : (
                              '0'
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {isQuotaExhausted ? (
                              <Badge className="bg-slate-200 text-slate-600 text-[10px] font-bold">
                                หมดโควต้า (0)
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10.5px] font-extrabold px-2">
                                เคลมได้ {item.availableClaimQuantity} {item.unitName}
                              </Badge>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {formatCurrency(item.unitPrice)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              disabled={isQuotaExhausted}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectItem(item);
                              }}
                              className={`h-7 px-2.5 rounded-lg text-xs font-bold transition-all ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-2xs'
                                  : isQuotaExhausted
                                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
                              }`}
                            >
                              {isSelected ? '✓ เลือกแล้ว' : 'เลือกรายการนี้'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* STEP 2: Selected Item & Claim Configuration */}
          {selectedItem && (
            <div className="bg-white border-2 border-indigo-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm animate-in fade-in-50">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
                <div>
                  <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wide block">
                    2. กำหนดรายละเอียดการเคลม
                  </span>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <span>{selectedItem.productName}</span>
                    <Badge variant="outline" className="text-xs font-mono border-slate-300">
                      {selectedItem.sku}
                    </Badge>
                  </h3>
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-slate-500 block">โควต้าที่ยังเคลมได้</span>
                  <span className="font-mono text-base font-black text-emerald-700">
                    {selectedItem.availableClaimQuantity} {selectedItem.unitName}
                  </span>
                  {(selectedItem.conversionFactor || 1) > 1 && (
                    <span className="text-[10.5px] text-slate-500 font-mono block">
                      (คงเหลือรวม {remainingBaseQuota} ชิ้น)
                    </span>
                  )}
                </div>
              </div>

              {/* Unit Selection (เฉพาะกรณีที่ลูกค้าไม่ได้ซื้อในหน่วยเล็กสุด) */}
              {selectedItem.availableUnits &&
                selectedItem.availableUnits.filter((u) => Number(u.factor || 1) <= Number(selectedItem.conversionFactor || 1)).length > 1 &&
                Number(selectedItem.conversionFactor || 1) > 1 && (
                <div className="bg-indigo-50/70 border-2 border-indigo-200/90 rounded-2xl p-3 sm:p-4 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <label className="font-black text-indigo-950 text-xs flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-indigo-600" />
                      <span>เลือกหน่วยที่ต้องการเคลมในครั้งนี้:</span>
                      <span className="text-[10.5px] font-normal text-indigo-700">
                        (บิลที่ซื้อมาเป็นหน่วย <b>{selectedItem.unitName}</b>)
                      </span>
                    </label>
                    <span className="text-[11px] font-bold text-indigo-800 font-mono">
                      โควต้ารวมหน่วยย่อย: <span className="font-black text-emerald-700">{remainingBaseQuota}</span> ชิ้น
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedItem.availableUnits
                      .filter((u) => Number(u.factor || 1) <= Number(selectedItem.conversionFactor || 1))
                      .map((u) => {
                      const isSelected = currentClaimUnit.unitName === u.unitName;
                      const maxInUnit = Math.floor(remainingBaseQuota / u.factor);
                      return (
                        <button
                          key={u.id || u.unitName}
                          type="button"
                          onClick={() => {
                            setSelectedClaimUnit(u);
                            setClaimQty(1);
                            setCustomRefundAmount(u.price.toString());
                          }}
                          disabled={maxInUnit <= 0}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold border-2 transition-all cursor-pointer flex items-center gap-2 ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm ring-2 ring-indigo-300'
                              : maxInUnit <= 0
                              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                              : 'bg-white text-slate-800 border-slate-200 hover:border-indigo-300'
                          }`}
                        >
                          <span className="text-xs font-black">{u.unitName}</span>
                          {u.factor > 1 && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${
                                isSelected ? 'bg-indigo-700/80 text-indigo-100' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              1 {u.unitName} = {u.factor} ชิ้น
                            </span>
                          )}
                          <span className={`text-[11px] font-mono ${isSelected ? 'text-indigo-200' : 'text-slate-500'}`}>
                            ({formatCurrency(u.price)})
                          </span>
                          <Badge
                            className={`text-[10px] font-mono font-black ml-1 ${
                              isSelected
                                ? 'bg-white text-indigo-800 border-transparent'
                                : 'bg-emerald-100 text-emerald-900 border-emerald-200'
                            }`}
                          >
                            เคลมได้ {maxInUnit} {u.unitName}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Resolution Options */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-extrabold text-slate-800 text-xs block">
                    เลือกผลการดำเนินการ / รูปแบบการเคลม (Resolution):
                  </label>
                  {isBackoffice && (
                    <span className="text-[11px] text-slate-500">
                      * หลังบ้านรองรับเฉพาะเปลี่ยนสินค้าใหม่ หรือส่งเคลมซัพพลายเออร์ (ไม่กระทบเงินกะ POS)
                    </span>
                  )}
                </div>

                <div className={`grid gap-2.5 ${isBackoffice ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
                  {/* 1. Replace Item */}
                  <button
                    type="button"
                    onClick={() => setResolutionType('REPLACE_ITEM')}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-1 cursor-pointer ${
                      resolutionType === 'REPLACE_ITEM'
                        ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 ring-2 ring-indigo-400 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                        <RotateCcw className="w-4 h-4" />
                      </div>
                      {resolutionType === 'REPLACE_ITEM' && (
                        <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                      )}
                    </div>
                    <div>
                      <span className="font-black text-xs block">เปลี่ยนสินค้าตัวใหม่</span>
                      <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                        ตัดสต็อกตัวใหม่ที่หยิบให้ + ตั้งสิทธิ์ประกันตัวใหม่
                      </span>
                    </div>
                  </button>

                  {/* 2. Store Discount Voucher (POS ONLY) */}
                  {!isBackoffice && (
                    <button
                      type="button"
                      onClick={() => setResolutionType('STORE_DISCOUNT')}
                      className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-1 cursor-pointer ${
                        resolutionType === 'STORE_DISCOUNT'
                          ? 'border-emerald-600 bg-emerald-50/80 text-emerald-950 ring-2 ring-emerald-400 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                          <Percent className="w-4 h-4" />
                        </div>
                        {resolutionType === 'STORE_DISCOUNT' && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        )}
                      </div>
                      <div>
                        <span className="font-black text-xs block">เปลี่ยนเป็นส่วนลดบิลนี้</span>
                        <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                          นำยอดเงินไปหักในตะกร้าหน้าขายทันที
                        </span>
                      </div>
                    </button>
                  )}

                  {/* 3. Refund Cash (POS ONLY) */}
                  {!isBackoffice && (
                    <button
                      type="button"
                      onClick={() => setResolutionType('REFUND_CASH')}
                      className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-1 cursor-pointer ${
                        resolutionType === 'REFUND_CASH'
                          ? 'border-rose-600 bg-rose-50/80 text-rose-950 ring-2 ring-rose-400 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-7 h-7 rounded-lg bg-rose-600 text-white flex items-center justify-center">
                          <Banknote className="w-4 h-4" />
                        </div>
                        {resolutionType === 'REFUND_CASH' && (
                          <CheckCircle2 className="w-4 h-4 text-rose-600" />
                        )}
                      </div>
                      <div>
                        <span className="font-black text-xs block">คืนเงินสด</span>
                        <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                          คืนเงินเต็มจำนวนตามราคาที่ซื้อ
                        </span>
                      </div>
                    </button>
                  )}

                  {/* 4. Refund Transfer (POS ONLY) */}
                  {!isBackoffice && (
                    <button
                      type="button"
                      onClick={() => setResolutionType('REFUND_TRANSFER')}
                      className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-1 cursor-pointer ${
                        resolutionType === 'REFUND_TRANSFER'
                          ? 'border-sky-600 bg-sky-50/80 text-sky-950 ring-2 ring-sky-400 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-7 h-7 rounded-lg bg-sky-600 text-white flex items-center justify-center">
                          <CreditCard className="w-4 h-4" />
                        </div>
                        {resolutionType === 'REFUND_TRANSFER' && (
                          <CheckCircle2 className="w-4 h-4 text-sky-600" />
                        )}
                      </div>
                      <div>
                        <span className="font-black text-xs block">คืนเงินโอน</span>
                        <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                          บันทึกเป็นคืนเงินผ่านบัญชี/พร้อมเพย์
                        </span>
                      </div>
                    </button>
                  )}

                  {/* 5. Supplier RMA */}
                  <button
                    type="button"
                    onClick={() => setResolutionType('SUPPLIER_RMA')}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-1 cursor-pointer ${
                      resolutionType === 'SUPPLIER_RMA'
                        ? 'border-amber-600 bg-amber-50/80 text-amber-950 ring-2 ring-amber-400 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-7 h-7 rounded-lg bg-amber-600 text-white flex items-center justify-center">
                        <Truck className="w-4 h-4" />
                      </div>
                      {resolutionType === 'SUPPLIER_RMA' && (
                        <CheckCircle2 className="w-4 h-4 text-amber-600" />
                      )}
                    </div>
                    <div>
                      <span className="font-black text-xs block">ส่งเคลมซัพพลายเออร์</span>
                      <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                        รับของเข้าสต็อกเคลมเพื่อส่งโรงงาน
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* ─── REPLACEMENT PRODUCT SELECTOR (FOR REPLACE_ITEM) ─── */}
              {resolutionType === 'REPLACE_ITEM' && (
                <div className="bg-indigo-50/60 border-2 border-indigo-200 rounded-2xl p-3.5 sm:p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <label className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-indigo-600" />
                      <span>เลือกสินค้าตัวใหม่ที่จะเปลี่ยนให้ลูกค้า:</span>
                    </label>
                    <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 text-xs shadow-2xs">
                      <button
                        type="button"
                        onClick={() => {
                          setReplacementMode('SAME_MODEL');
                          setSelectedReplacementItem(null);
                          setReplacementSearch('');
                        }}
                        className={`px-3 py-1 rounded-lg font-bold transition-all ${
                          replacementMode === 'SAME_MODEL'
                            ? 'bg-indigo-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        🔄 สินค้ารุ่นเดิม
                      </button>
                      <button
                        type="button"
                        onClick={() => setReplacementMode('CUSTOM_MODEL')}
                        className={`px-3 py-1 rounded-lg font-bold transition-all ${
                          replacementMode === 'CUSTOM_MODEL'
                            ? 'bg-indigo-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        🔍 คนละตัว / คนละสี / คนละลาย
                      </button>
                    </div>
                  </div>

                  {replacementMode === 'SAME_MODEL' ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-3 rounded-xl border border-indigo-100 gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <span className="font-bold text-slate-900 text-xs">
                            {selectedItem.productName} ({currentClaimUnit.unitName})
                          </span>
                          <div className="text-[10.5px] text-slate-500 font-mono">
                            SKU: {selectedItem.sku} | ราคา {formatCurrency(currentClaimUnit.price)}
                          </div>
                        </div>
                      </div>
                      <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-[11px] font-bold">
                        ตัดสต็อกสินค้ารุ่นเดิม {claimQty} {currentClaimUnit.unitName} {currentClaimUnit.factor > 1 ? `(${claimQty * currentClaimUnit.factor} ชิ้น)` : ''}
                      </Badge>
                    </div>
                  ) : (
                    <div className="space-y-2 relative">
                      {/* Search & Barcode Scan Input */}
                      <div className="relative">
                        <ScanLine className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-600" />
                        <Input
                          type="text"
                          value={replacementSearch}
                          onChange={(e) => {
                            setReplacementSearch(e.target.value);
                            setShowReplacementDropdown(true);
                          }}
                          onFocus={() => setShowReplacementDropdown(true)}
                          placeholder="ยิงบาร์โค้ด หรือพิมพ์ชื่อสินค้า / SKU ตัวใหม่ที่หยิบเปลี่ยนให้ลูกค้า..."
                          className="pl-9 h-11 bg-white border-indigo-300 rounded-xl text-xs font-semibold shadow-inner focus:border-indigo-600"
                        />
                        {replacementSearch && (
                          <button
                            type="button"
                            onClick={() => {
                              setReplacementSearch('');
                              setShowReplacementDropdown(false);
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
                          >
                            ล้าง
                          </button>
                        )}
                      </div>

                      {/* Dropdown Results */}
                      {showReplacementDropdown && replacementSearch.trim() && (
                        <div className="absolute top-12 left-0 right-0 border border-indigo-200 rounded-xl bg-white shadow-xl max-h-56 overflow-y-auto divide-y divide-slate-100 z-30">
                          {matchingReplacementProducts.length === 0 ? (
                            <div className="p-3 text-center text-slate-400 text-xs">
                              ไม่พบสินค้าที่ตรงกับคำค้นหา
                            </div>
                          ) : (
                            matchingReplacementProducts.map(({ product: p, unit: u }) => {
                              const isSamePrice = u.price === selectedItem.unitPrice;
                              return (
                                <div
                                  key={`${p.id}-${u.id}`}
                                  onClick={() => handleSelectReplacementItem(p, u)}
                                  className="p-2.5 hover:bg-indigo-50/80 cursor-pointer flex items-center justify-between transition-colors text-xs"
                                >
                                  <div>
                                    <div className="font-bold text-slate-900">{p.name} ({u.unitName})</div>
                                    <div className="text-[10px] text-slate-500 font-mono">
                                      บาร์โค้ด: {u.barcode || '-'} | SKU: {p.sku} | สต็อกคงเหลือ: {p.stock ?? '-'} {u.unitName}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-mono font-bold text-slate-900">{formatCurrency(u.price)}</div>
                                    {isSamePrice ? (
                                      <span className="text-[10px] text-emerald-600 font-bold">✓ ราคาเท่ากัน</span>
                                    ) : (
                                      <span className="text-[10px] text-amber-600 font-bold">
                                        {u.price > selectedItem.unitPrice ? `+${formatCurrency(u.price - selectedItem.unitPrice)}` : `-${formatCurrency(selectedItem.unitPrice - u.price)}`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}

                      {/* Display Chosen Replacement Product */}
                      {selectedReplacementItem ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-emerald-50 border-2 border-emerald-300 p-3 rounded-xl gap-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                            <div>
                              <span className="font-black text-slate-900 text-xs">
                                {selectedReplacementItem.product.name} ({selectedReplacementItem.unit.unitName})
                              </span>
                              <div className="text-[10.5px] text-slate-600 font-mono">
                                บาร์โค้ด: {selectedReplacementItem.unit.barcode || '-'} | SKU: {selectedReplacementItem.product.sku} | ราคา {formatCurrency(selectedReplacementItem.unit.price)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className="bg-emerald-200 text-emerald-900 border-emerald-300 font-bold text-[10.5px]">
                              ตัดสต็อกตัวนี้ {claimQty} {selectedReplacementItem.unit.unitName}
                            </Badge>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedReplacementItem(null);
                                setReplacementSearch('');
                              }}
                              className="text-xs text-rose-600 font-bold hover:underline"
                            >
                              เปลี่ยนตัวอื่น
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200 flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>กรุณายิงบาร์โค้ดหรือเลือกสินค้าตัวที่นำไปเปลี่ยนให้ลูกค้า เพื่อให้ระบบตัดสต็อกตัวจริงได้อย่างถูกต้อง</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Quantity, Defect Reason & Notes Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Quantity */}
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    จำนวนที่เคลม ({currentClaimUnit.unitName}) *
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setClaimQty((q) => Math.max(1, q - 1))}
                      className="w-10 h-10 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 font-black text-slate-800"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={maxClaimQty}
                      value={claimQty}
                      onChange={(e) => setClaimQty(Math.min(maxClaimQty, Math.max(1, Number(e.target.value))))}
                      className="w-16 h-10 text-center font-mono font-black text-base border border-slate-300 rounded-xl bg-white shadow-inner"
                    />
                    <button
                      type="button"
                      onClick={() => setClaimQty((q) => Math.min(maxClaimQty, q + 1))}
                      className="w-10 h-10 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 font-black text-slate-800"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[10.5px] text-slate-500 mt-1 block">
                    เคลมได้สูงสุด {maxClaimQty} {currentClaimUnit.unitName}
                  </span>
                </div>

                {/* Defect Reason */}
                <div className="sm:col-span-2">
                  <label className="font-bold text-slate-700 block mb-1">
                    ระบุอาการเสีย / สาเหตุที่เคลม *
                  </label>
                  <Input
                    type="text"
                    value={defectReason}
                    onChange={(e) => setDefectReason(e.target.value)}
                    placeholder="เช่น เปิดไม่ติด, แตกหักจากกล่อง, ใช้งานไม่ได้, ช็อต..."
                    className="h-10 bg-white border-slate-300 rounded-xl text-xs font-semibold shadow-inner focus:border-indigo-500"
                  />
                </div>
              </div>

              {resolutionType === 'REFUND_TRANSFER' && (
                <div className="bg-sky-50/80 border border-sky-200 p-3 rounded-xl space-y-2">
                  <label className="font-bold text-sky-950 block text-xs">
                    บัญชีการเงินที่ใช้คืนเงินโอน *
                  </label>
                  {bankAccounts.length > 0 ? (
                    <>
                      <select
                        value={refundAccountId}
                        onChange={(e) => setRefundAccountId(e.target.value)}
                        className="w-full h-10 rounded-xl border border-sky-200 bg-white px-3 text-xs font-bold text-slate-900 outline-none focus:border-sky-500"
                      >
                        {bankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.bankName} - {account.accountName} ({account.accountNumber})
                            {account.isDefault ? ' - บัญชีหลัก' : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10.5px] text-sky-700">
                        ระบบจะบันทึกบัญชีนี้ลงในใบเคลม เพื่อใช้ต่อกับรายจ่าย/กระทบยอดบัญชีภายหลัง
                      </p>
                    </>
                  ) : (
                    <p className="text-xs font-bold text-rose-700 bg-white border border-rose-200 rounded-xl p-2">
                      ยังไม่มีบัญชีการเงิน กรุณาเพิ่มบัญชีในเมนูบัญชีการเงินก่อนทำรายการคืนเงินโอน
                    </p>
                  )}
                </div>
              )}

              {/* Note / Remarks */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">หมายเหตุเพิ่มเติม (ถ้ามี):</label>
                <Input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เช่น ลูกค้าขอเปลี่ยนเป็นคนละสี, นัดรับของ..."
                  className="h-9 bg-slate-50 border-slate-300 rounded-xl text-xs"
                />
              </div>

              {/* Summary Value Banner */}
              <div className="bg-slate-100/90 border border-slate-200 p-3 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-500 block">มูลค่าการเคลมรวม:</span>
                  <span className="font-mono text-xl font-black text-indigo-700">
                    {formatCurrency(claimQty * currentClaimUnit.price)}
                  </span>
                </div>
                <div className="text-right text-[11px] text-slate-600">
                  <span>ผู้รับเคลม: <b className="text-slate-900">{user?.name || (isBackoffice ? 'เจ้าหน้าที่คลังหลังบ้าน' : 'พนักงาน POS')}</b></span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-3.5 border-t border-slate-100 flex items-center justify-between shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 px-5 border-slate-300 text-slate-700 font-bold rounded-xl"
          >
            ยกเลิก
          </Button>

          <Button
            type="button"
            disabled={!selectedItem || isSubmitting}
            onClick={handleSubmitClaim}
            className="h-11 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md gap-2"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>กำลังบันทึก...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>ยืนยันการรับเคลมสินค้า</span>
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
