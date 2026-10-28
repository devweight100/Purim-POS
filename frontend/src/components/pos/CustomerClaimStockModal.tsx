'use client';

import React, { useState, useEffect } from 'react';
import {
  Package,
  ShieldCheck,
  Search,
  X,
  CheckCircle2,
  RefreshCw,
  ShoppingCart,
  Percent,
  Banknote,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Building2,
  Phone,
  User,
} from 'lucide-react';
import { useCartStore } from '../../lib/store/cart-store';
import { useProductStore } from '../../lib/store/product-store';
import {
  getCustomerProductStock,
  CustomerProductStock,
  CustomerStockSummary,
} from '../../lib/customer-claim-stock-service';
import { processClaim, ProcessClaimParams } from '../../lib/claim-service';
import { PendingClaimItem } from '../../lib/types';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

interface CustomerClaimStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCustomerSelect?: () => void;
}

interface SelectedClaimEntry {
  product: CustomerProductStock;
  claimQty: number;
  reason: string;
}

export const CustomerClaimStockModal: React.FC<CustomerClaimStockModalProps> = ({
  isOpen,
  onClose,
  onOpenCustomerSelect,
}) => {
  const {
    customerId,
    customerName,
    setCustomer,
    addItem,
    setItemClaim,
    addPendingClaim,
  } = useCartStore();
  const products = useProductStore((s) => s.products);

  const [loading, setLoading] = useState(false);
  const [stockSummary, setStockSummary] = useState<CustomerStockSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProductIds, setExpandedProductIds] = useState<Record<string, boolean>>({});

  // Multi-item claim selection: map productId -> SelectedClaimEntry
  const [selectedClaims, setSelectedClaims] = useState<Record<string, SelectedClaimEntry>>({});

  // Refund sub-modal or mode
  const [refundMode, setRefundMode] = useState<'NONE' | 'CASH' | 'TRANSFER'>('NONE');
  const [isProcessing, setIsProcessing] = useState(false);

  const loadStock = async () => {
    if (!customerId && !customerName && !searchQuery.trim()) {
      setStockSummary(null);
      return;
    }
    setLoading(true);
    try {
      const summary = await getCustomerProductStock({
        customerId: customerId || undefined,
        customerName: customerName || (searchQuery.trim() ? searchQuery.trim() : undefined),
        customerPhone: searchQuery.trim().match(/^[0-9]+$/) ? searchQuery.trim() : undefined,
      });
      setStockSummary(summary);
    } catch (err) {
      console.error('Failed to load customer stock:', err);
      toast.error('ไม่สามารถโหลดประวัติคลังสินค้าของลูกค้าได้');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setSearchQuery('');
    setSelectedClaims({});
    setRefundMode('NONE');
    setExpandedProductIds({});
  };

  useEffect(() => {
    if (isOpen) {
      loadStock();
      setSelectedClaims({});
      setRefundMode('NONE');
    } else {
      resetForm();
    }
  }, [isOpen, customerId, customerName]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  const toggleExpand = (pId: string) => {
    setExpandedProductIds((prev) => ({ ...prev, [pId]: !prev[pId] }));
  };

  const handleToggleSelect = (item: CustomerProductStock) => {
    if (item.availableClaimQuantity <= 0) {
      toast.error('สินค้านี้ไม่มีสิทธิ์เคลมคงเหลือ');
      return;
    }

    setSelectedClaims((prev) => {
      const next = { ...prev };
      if (next[item.productId]) {
        delete next[item.productId];
      } else {
        next[item.productId] = {
          product: item,
          claimQty: 1,
          reason: 'สินค้าชำรุด/มีปัญหาจากการใช้งาน',
        };
      }
      return next;
    });
  };

  const handleUpdateClaimQty = (productId: string, qty: number, maxQty: number) => {
    const validQty = Math.max(1, Math.min(qty, maxQty));
    setSelectedClaims((prev) => {
      if (!prev[productId]) return prev;
      return {
        ...prev,
        [productId]: { ...prev[productId], claimQty: validQty },
      };
    });
  };

  const handleUpdateReason = (productId: string, reason: string) => {
    setSelectedClaims((prev) => {
      if (!prev[productId]) return prev;
      return {
        ...prev,
        [productId]: { ...prev[productId], reason },
      };
    });
  };

  const selectedList = Object.values(selectedClaims);
  const totalSelectedCount = selectedList.reduce((sum, s) => sum + s.claimQty, 0);
  const totalSelectedValue = selectedList.reduce(
    (sum, s) => sum + s.claimQty * s.product.baseUnitPrice,
    0
  );

  // ─── 1. RESOLUTION: Add to Cart as Replacement (ฟรี) ───
  const handleAddToCartReplacement = () => {
    if (selectedList.length === 0) return;

    for (const entry of selectedList) {
      const { product, claimQty, reason } = entry;
      const targetProd = products.find((p) => p.id === product.productId || p.sku === product.sku);

      if (!targetProd) {
        toast.error(`ไม่พบข้อมูลสินค้า ${product.productName} ในระบบ`);
        continue;
      }

      // 1. Add to cart with claim quantity
      const defaultUnit = targetProd.units?.[0];
      // If item not in cart, addItem adds 1. We can set claim quantity directly.
      addItem(targetProd, defaultUnit);
      setItemClaim(
        product.productId,
        claimQty,
        reason,
        defaultUnit?.id,
        product.orders[0]?.orderId
      );
    }

    toast.success(
      `เพิ่มรายการเปลี่ยนสินค้าเคลม ${selectedList.length} รายการ ลงตะกร้าแล้ว (เคลมฟรี)`
    );
    handleClose();
  };

  // ─── 2. RESOLUTION: Bill Discount (ส่วนลดในบิล - DO NOT DEDUCT BEFORE CHECKOUT) ───
  const handleApplyBillDiscount = () => {
    if (selectedList.length === 0) return;

    for (const entry of selectedList) {
      const { product, claimQty, reason } = entry;
      const latestOrder = product.orders.find((o) => o.availableClaimQuantity > 0) || product.orders[0];

      const pendingClaim: PendingClaimItem = {
        id: `draft-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        orderId: latestOrder?.orderId || '',
        orderNumber: latestOrder?.orderNumber || '-',
        orderDate: latestOrder?.orderDate || new Date().toISOString(),
        customerId: customerId || null,
        customerName: customerName || stockSummary?.customerName || 'ลูกค้าทั่วไป',
        customerPhone: stockSummary?.customerPhone || null,
        productId: product.productId,
        productName: product.productName,
        sku: product.sku,
        unitName: product.unitName,
        quantity: claimQty,
        unitPrice: product.baseUnitPrice,
        totalClaimValue: claimQty * product.baseUnitPrice,
        defectReason: reason,
        resolutionType: 'STORE_DISCOUNT',
        discountAmount: claimQty * product.baseUnitPrice,
      };

      addPendingClaim(pendingClaim);
    }

    toast.success(
      `นำรายการเคลมมาใช้เป็นส่วนลดในบิลแล้ว รวม ฿${totalSelectedValue.toLocaleString()} (จะตัดสิทธิ์เคลมเมื่อชำระเงินเสร็จสิ้นเท่านั้น)`
    );
    handleClose();
  };

  // ─── 3. RESOLUTION: Immediate Cash / Transfer Refund ───
  const handleConfirmRefund = async () => {
    if (selectedList.length === 0 || refundMode === 'NONE') return;

    setIsProcessing(true);
    try {
      const resType = refundMode === 'CASH' ? 'REFUND_CASH' : 'REFUND_TRANSFER';

      for (const entry of selectedList) {
        const { product, claimQty, reason } = entry;
        const latestOrder = product.orders.find((o) => o.availableClaimQuantity > 0) || product.orders[0];

        const eligibleItem = {
          orderId: latestOrder?.orderId || '',
          orderNumber: latestOrder?.orderNumber || '-',
          orderDate: latestOrder?.orderDate || new Date().toISOString(),
          customerId: customerId || null,
          customerName: customerName || stockSummary?.customerName || 'ลูกค้าทั่วไป',
          customerPhone: stockSummary?.customerPhone || null,
          productId: product.productId,
          productName: product.productName,
          sku: product.sku,
          unitName: product.unitName,
          boughtQuantity: product.totalBoughtQuantity,
          alreadyClaimedQuantity: product.totalClaimedQuantity,
          availableClaimQuantity: product.availableClaimQuantity,
          unitPrice: product.baseUnitPrice,
          isReplacementWarranty: false,
        };

        const params: ProcessClaimParams = {
          item: eligibleItem,
          quantity: claimQty,
          defectReason: reason,
          resolutionType: resType,
          cashierName: 'พนักงานขาย',
          refundAmount: claimQty * product.baseUnitPrice,
        };

        await processClaim(params);
      }

      toast.success(
        `ทำรายการคืนเงิน (${refundMode === 'CASH' ? 'เงินสด' : 'โอนเงิน'}) รวม ฿${totalSelectedValue.toLocaleString()} เรียบร้อยแล้ว`
      );
      setSelectedClaims({});
      setRefundMode('NONE');
      await loadStock();
    } catch (err) {
      console.error('Failed to process refund claims:', err);
      toast.error('เกิดข้อผิดพลาดในการบันทึกการคืนเงิน');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-800">
                  คลังสินค้าลูกค้า & สิทธิ์เคลม (Customer Stock)
                </h3>
                <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-semibold">
                  ตรวจสิทธิ์จากประวัติซื้อ
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                ดูประวัติสินค้าที่ลูกค้าเคยซื้อ และเลือกเคลมได้หลายรายการพร้อมกัน
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Customer Bar & Search */}
        <div className="p-4 bg-slate-50/50 border-b border-slate-200 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 shadow-sm">
              <User className="w-3.5 h-3.5 text-indigo-600" />
              <span>ลูกค้า:</span>
              <span className="text-indigo-950 font-bold">
                {customerName || stockSummary?.customerName || 'ยังไม่ได้ระบุลูกค้า'}
              </span>
            </div>
            {onOpenCustomerSelect && (
              <button
                type="button"
                onClick={onOpenCustomerSelect}
                className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl border border-indigo-100 transition"
              >
                เลือกลูกค้าอื่น
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadStock()}
                placeholder="ค้นหาชื่อลูกค้า / เบอร์โทร / เลขบิล..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="button"
              onClick={loadStock}
              className="p-2 text-slate-600 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition"
              title="ค้นหา/รีเฟรช"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-indigo-600 opacity-80" />
              กำลังประมวลผลคลังสินค้าและสิทธิ์เคลมของลูกค้า...
            </div>
          ) : !stockSummary || stockSummary.items.length === 0 ? (
            <div className="py-16 text-center text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <div className="font-semibold text-slate-700">ไม่พบประวัติสินค้าที่เคยซื้อ</div>
              <div className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                ลูกค้าท่านนี้ยังไม่มีประวัติการซื้อในระบบ หรือยังไม่ได้เลือกลูกค้า
                โปรดเลือกลูกค้าเพื่อดูสินค้าที่สามารถเคลมได้
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs text-slate-500 px-1">
                <span>
                  พบสินค้าที่เคยซื้อทั้งหมด{' '}
                  <strong className="text-slate-800">{stockSummary.items.length}</strong> รายการ
                  (สิทธิ์เคลมคงเหลือรวม{' '}
                  <strong className="text-emerald-600">{stockSummary.totalAvailableItems}</strong> ชิ้น)
                </span>
                <span className="text-slate-400">
                  คลิกที่รายการเพื่อเลือกเคลม (สามารถเลือกพร้อมกันได้หลายชิ้น)
                </span>
              </div>

              {stockSummary.items.map((item) => {
                const isSelected = Boolean(selectedClaims[item.productId]);
                const isExpanded = Boolean(expandedProductIds[item.productId]);
                const selectedEntry = selectedClaims[item.productId];
                const hasQuota = item.availableClaimQuantity > 0;

                return (
                  <div
                    key={item.productId}
                    className={`rounded-2xl border transition-all duration-150 ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/20 ring-1 ring-indigo-500/20'
                        : hasQuota
                        ? 'border-slate-200 bg-white hover:border-slate-300'
                        : 'border-slate-200 bg-slate-50/60 opacity-60'
                    }`}
                  >
                    {/* Item Main Row */}
                    <div className="p-4 flex items-center gap-3.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!hasQuota}
                        onChange={() => handleToggleSelect(item)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                      />

                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => hasQuota && handleToggleSelect(item)}>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-sm truncate">
                            {item.productName}
                          </span>
                          {item.sku && (
                            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                              {item.sku}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
                          <span>ราคา: ฿{item.baseUnitPrice.toLocaleString()} / {item.unitName}</span>
                          <span>ซื้อทั้งหมด: {item.totalBoughtQuantity} {item.unitName}</span>
                          <span>เคลมไปแล้ว: {item.totalClaimedQuantity} {item.unitName}</span>
                        </div>
                      </div>

                      {/* Quota Badge */}
                      <div className="text-right">
                        <div
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${
                            hasQuota
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>
                            {hasQuota
                              ? `เหลือสิทธิ์ ${item.availableClaimQuantity} ${item.unitName}`
                              : 'สิทธิ์เคลมหมดแล้ว'}
                          </span>
                        </div>
                      </div>

                      {/* Expand History Button */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(item.productId)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
                        title="ดูประวัติบิลที่ซื้อ"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* If selected: Inputs for claim quantity and reason */}
                    {isSelected && selectedEntry && (
                      <div className="px-4 pb-4 pt-1 bg-indigo-50/40 border-t border-indigo-100 flex flex-wrap gap-4 items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700">จำนวนที่เคลม:</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateClaimQty(
                                  item.productId,
                                  selectedEntry.claimQty - 1,
                                  item.availableClaimQuantity
                                )
                              }
                              className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold text-xs flex items-center justify-center hover:bg-slate-50"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="1"
                              max={item.availableClaimQuantity}
                              value={selectedEntry.claimQty}
                              onChange={(e) =>
                                handleUpdateClaimQty(
                                  item.productId,
                                  parseInt(e.target.value) || 1,
                                  item.availableClaimQuantity
                                )
                              }
                              className="w-12 h-7 text-center font-bold text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateClaimQty(
                                  item.productId,
                                  selectedEntry.claimQty + 1,
                                  item.availableClaimQuantity
                                )
                              }
                              className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold text-xs flex items-center justify-center hover:bg-slate-50"
                            >
                              +
                            </button>
                            <span className="text-xs text-slate-500 ml-1">{item.unitName}</span>
                          </div>
                        </div>

                        <div className="flex-1 min-w-[200px] flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                            อาการชำรุด:
                          </span>
                          <input
                            type="text"
                            value={selectedEntry.reason}
                            onChange={(e) => handleUpdateReason(item.productId, e.target.value)}
                            placeholder="ระบุสาเหตุการเคลม..."
                            className="flex-1 px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <div className="text-xs font-bold text-indigo-700">
                          มูลค่า: {formatCurrency(selectedEntry.claimQty * item.baseUnitPrice)}
                        </div>
                      </div>
                    )}

                    {/* Order History Breakdown Sub-table */}
                    {isExpanded && (
                      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs space-y-1.5">
                        <div className="font-semibold text-slate-600 mb-1">
                          ประวัติการสั่งซื้อสินค้านี้ ({item.orders.length} บิล):
                        </div>
                        {item.orders.map((ord, idx) => (
                          <div
                            key={idx}
                            className="flex justify-between items-center py-1 border-b border-slate-200/60 last:border-0 text-slate-600"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-slate-800">{ord.orderNumber}</span>
                              <span className="text-slate-400">
                                ({new Date(ord.orderDate).toLocaleDateString('th-TH')})
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span>ซื้อ: {ord.boughtQuantity} {ord.unitName}</span>
                              <span>เคลมแล้ว: {ord.alreadyClaimedQuantity} {ord.unitName}</span>
                              <span className="font-semibold text-emerald-600">
                                คงเหลือ: {ord.availableClaimQuantity} {ord.unitName}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Claims Actions Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200">
          {totalSelectedCount > 0 ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-700 font-semibold">
                  เลือกสินค้าเคลม{' '}
                  <span className="text-indigo-600 font-bold">{selectedList.length}</span> รายการ{' '}
                  (รวม <span className="text-indigo-600 font-bold">{totalSelectedCount}</span> ชิ้น)
                </span>
                <span className="text-slate-700 font-bold text-sm">
                  มูลค่าเคลมรวม:{' '}
                  <span className="text-indigo-600">{formatCurrency(totalSelectedValue)}</span>
                </span>
              </div>

              {/* 3 Action Buttons */}
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                {/* 1. In-Cart Replacement */}
                <button
                  type="button"
                  onClick={handleAddToCartReplacement}
                  className="px-4 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition flex items-center gap-1.5 shadow-sm"
                >
                  <ShoppingCart className="w-4 h-4 text-indigo-600" />
                  <span>1. เปลี่ยนสินค้า (ใส่ลงตะกร้าฟรี)</span>
                </button>

                {/* 2. Bill Discount */}
                <button
                  type="button"
                  onClick={handleApplyBillDiscount}
                  className="px-4 py-2 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition flex items-center gap-1.5 shadow-sm"
                >
                  <Percent className="w-4 h-4 text-amber-600" />
                  <span>2. ใช้เป็นส่วนลดในบิลนี้</span>
                </button>

                {/* 3. Refund */}
                <button
                  type="button"
                  onClick={() => setRefundMode('CASH')}
                  className="px-4 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition flex items-center gap-1.5 shadow-sm"
                >
                  <Banknote className="w-4 h-4 text-emerald-600" />
                  <span>3. คืนเงินลูกค้า</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center text-xs text-slate-500">
              <span>เลือกสินค้าที่มีสิทธิ์ด้านบนเพื่อดำเนินการเคลม</span>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          )}
        </div>

        {/* Refund Mode Confirmation Modal */}
        {refundMode !== 'NONE' && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 text-sm animate-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                  <Banknote className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 text-base">ยืนยันการคืนเงินลูกค้า</h4>
                  <p className="text-xs text-slate-500">
                    รายการเคลมนี้จะตัดสิทธิ์โควตาทันทีและบันทึกการคืนเงิน
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>จำนวนรายการเคลม:</span>
                  <span className="font-bold text-slate-800">{selectedList.length} รายการ</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>จำนวนชิ้นรวม:</span>
                  <span className="font-bold text-slate-800">{totalSelectedCount} ชิ้น</span>
                </div>
                <div className="flex justify-between text-emerald-600 font-bold text-sm pt-1 border-t border-slate-200">
                  <span>ยอดเงินที่ต้องคืนลูกค้า:</span>
                  <span>{formatCurrency(totalSelectedValue)}</span>
                </div>
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">รูปแบบการคืนเงิน:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRefundMode('CASH')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      refundMode === 'CASH'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    คืนเป็นเงินสด
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundMode('TRANSFER')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      refundMode === 'TRANSFER'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Building2 className="w-4 h-4" />
                    โอนเงินคืนลูกค้า
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setRefundMode('NONE')}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleConfirmRefund}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>ยืนยันการคืนเงิน ฿{totalSelectedValue.toLocaleString()}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
