'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { normVatType, type PoVatType } from '@shared/po-calc';
import { apiFetch } from '@/lib/api';
import { CreateSupplierReturnModal } from '@/components/supplier-returns/CreateSupplierReturnModal';
import { submitPurchaseReceipt } from '@/lib/purchase-receipt-sync';
import { Button } from '@/components/ui/button';
import { Plus, PackageOpen } from 'lucide-react';
import { toast } from 'sonner';

import { useProductStore } from '@/lib/store/product-store';
import { addQty, parseQty, subQty, useAllowDecimalQty } from '@/lib/qty';

import PurchaseOrderPdfModal, { PurchaseOrderData } from '@/components/pos/PurchaseOrderPdfModal';
import {
  lineVatRate, loadProductImages,
  type PoCartItem, type PoProductLike, type PoReceiveItem, type PoSupplier, type PreviewTarget, type PurchaseOrder,
} from './_components/po-shared';
import { PoCreateView, type PoCreateInit } from './_components/PoCreateView';
import { ProductImagePreviewDialog } from './_components/ProductImagePreviewDialog';
import { PoListTable } from './_components/PoListTable';
import { PoReceiveDialog, PoUnderReceiveDialog } from './_components/PoReceiveDialogs';
import { PoDetailDialog } from './_components/PoDetailDialog';
import { PoIssueDialog, PoStatusChangeDialog, PoCancelDialog } from './_components/PoActionDialogs';

/** The server's product list (loaded once into the product store). */
async function loadAllProducts(): Promise<PoProductLike[]> {
  let prods = useProductStore.getState().products;
  if (!prods || prods.length === 0) {
    await useProductStore.getState().fetchProducts();
    prods = useProductStore.getState().products;
  }
  if (!prods || prods.length === 0) {
    const err = useProductStore.getState().error;
    if (err) toast.error('โหลดสินค้าจากเซิร์ฟเวอร์ไม่ได้: ' + err);
    return [];
  }
  return prods || [];
}

export default function PurchaseOrdersPage() {
  const allowDecimalQty = useAllowDecimalQty();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [viewMode, setViewMode] = useState<'list' | 'create'>('list');
  // what the create / edit screen starts from; the screen keeps its own state while open
  const [createInit, setCreateInit] = useState<PoCreateInit | null>(null);
  const [suppliers, setSuppliers] = useState<PoSupplier[]>([]);
  const [searchScope, setSearchScope] = useState<'supplier' | 'all'>('supplier');
  const [catalogSearch, setCatalogSearch] = useState('');

  // Image preview state
  const [previewProduct, setPreviewProduct] = useState<PreviewTarget | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);

  // Detail Dialog
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  // Return received goods to the supplier (creates a credit note, deducted when paying the supplier)
  const [returnPo, setReturnPo] = useState<PurchaseOrder | null>(null);
  const [currentPo, setCurrentPo] = useState<PurchaseOrder | null>(null);

  // Professional PDF / Print Dialog
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [pdfPoData, setPdfPoData] = useState<PurchaseOrderData | null>(null);

  // Cancel State
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [targetCancelPo, setTargetCancelPo] = useState<PurchaseOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('ผู้จำหน่ายแจ้งสินค้าหมด/ยกเลิก');
  const [cancelCustomReason, setCancelCustomReason] = useState('');

  const openPdfModal = (poData: PurchaseOrderData, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPdfPoData(poData);
    setIsPdfModalOpen(true);
  };

  // Issue Confirmation State
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [targetIssuePo, setTargetIssuePo] = useState<PurchaseOrder | null>(null);

  // Status Change and Rollback State
  const [isStatusChangeModalOpen, setIsStatusChangeModalOpen] = useState(false);
  const [targetStatusChangePo, setTargetStatusChangePo] = useState<PurchaseOrder | null>(null);
  const [newSelectedStatus, setNewSelectedStatus] = useState<string>('DRAFT');
  const [statusChangeNote, setStatusChangeNote] = useState<string>('');

  // Receive Dialog
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [receiveItems, setReceiveItems] = useState<PoReceiveItem[]>([]);
  const [receiveSupplierInvoiceNo, setReceiveSupplierInvoiceNo] = useState<string>('');
  const [receiveSupplierInvoiceDate, setReceiveSupplierInvoiceDate] = useState<string>('');

  // Under-Receive Confirmation State (เมื่อรับสินค้าไม่ครบตามใบสั่งซื้อ)
  const [isUnderReceiveModalOpen, setIsUnderReceiveModalOpen] = useState(false);
  const [underReceiveAction, setUnderReceiveAction] = useState<'ADJUST_AND_COMPLETE' | 'PARTIAL'>('ADJUST_AND_COMPLETE');

  /** Load the list (state is only set after the request finished). */
  const loadPOs = useCallback(async () => {
    let list: PurchaseOrder[] = [];
    try {
      const data = await apiFetch("/purchase-orders?limit=1000");
      list = Array.isArray(data) ? data : data.data;
      if (!Array.isArray(list)) throw new Error("ข้อมูลใบสั่งซื้อไม่ถูกต้อง");
      setLoadError(null);
    } catch (error) {
      list = [];
      setLoadError(error instanceof Error ? error.message : "โหลดใบสั่งซื้อจากฐานข้อมูลไม่ได้");
    }

    setPurchaseOrders(list);
    setLoading(false);
  }, []);

  const fetchPOs = useCallback(async () => {
    setLoading(true);
    await loadPOs();
  }, [loadPOs]);

  useEffect(() => {
    const refresh = () => { void fetchPOs(); };
    window.addEventListener('pos-data-synced', refresh);
    return () => window.removeEventListener('pos-data-synced', refresh);
  }, [fetchPOs]);


  useEffect(() => {
    // initial load (loading already starts as true, state is set after the request);
    // also warms up the product list for the order table
    const run = async () => { await loadPOs(); };
    void run();
    void loadAllProducts();
  }, [loadPOs]);

  const openCreateDialog = async () => {
    let supps: PoSupplier[] = [];
    try {
      const data = await apiFetch("/suppliers");
      if (Array.isArray(data)) supps = data;
    } catch (error) {
      toast.error('โหลดรายชื่อผู้จำหน่ายจากเซิร์ฟเวอร์ไม่ได้: ' + ((error as Error | undefined)?.message || 'ติดต่อเซิร์ฟเวอร์ไม่ได้'));
      return;
    }

    const prods = await loadAllProducts();
    setSuppliers(supps);
    setCreateInit({
      editingPo: null,
      suppliers: supps,
      supplierProducts: prods,
      createStep: 'supplier',
      selectedSupplier: null,
      cartItems: [],
      billDiscountType: 'baht',
      billDiscountValue: 0,
      vatType: 'none',
    });
    setViewMode('create');
  };

  const openEditDialog = async (po: PurchaseOrder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (po.status === 'COMPLETED') {
      toast.error("ไม่สามารถแก้ไขใบสั่งซื้อที่รับสินค้าครบแล้วได้");
      return;
    }
    if (po.status === 'CANCELLED') {
      toast.error("ไม่สามารถแก้ไขใบสั่งซื้อที่ยกเลิกแล้วได้");
      return;
    }

    let supps: PoSupplier[] = [];
    try {
      const data = await apiFetch("/suppliers");
      if (Array.isArray(data)) supps = data;
    } catch (error) {
      toast.error('โหลดรายชื่อผู้จำหน่ายจากเซิร์ฟเวอร์ไม่ได้: ' + ((error as Error | undefined)?.message || 'ติดต่อเซิร์ฟเวอร์ไม่ได้'));
      return;
    }
    setSuppliers(supps);

    const supp: PoSupplier = po.supplier || supps.find((s) => s.id === (po.supplierId || po.supplier?.id)) || {
      id: po.supplierId || '',
      name: po.supplierName || 'ผู้จำหน่าย',
      contactName: '-',
      phone: '-',
      email: '-',
      address: '-',
      creditTerms: 30,
    };

    const prods = await loadAllProducts();

    // Map existing PO items to cart items
    const mappedCartItems: PoCartItem[] = (po.items || []).map((i) => {
      const uName = i.unitName || i.unit || i.baseUnit || 'ชิ้น';
      return {
        id: i.id,
        cartKey: `${i.productId || i.id}_${uName}`,
        productId: (i.productId || i.id) as string,
        name: i.name || i.product?.name || 'สินค้า',
        sku: i.sku || i.product?.sku || '-',
        stock: i.stock || 0,
        baseUnit: i.baseUnit || i.unit || 'ชิ้น',
        unitName: uName,
        multiplier: Number(i.multiplier) || 1,
        unitCost: Number(i.unitCost) || Number(i.cost) || Number(i.price) || 0,
        quantity: Number(i.quantity) || Number(i.qty) || 1,
        receivedQuantity: Number(i.receivedQuantity) || 0,
        discountType: (i.discountType as 'baht' | 'percent') || 'baht',
        discountValue: Number(i.discountValue) || 0,
        // per-line VAT from the server; very old local POs had one VAT setting for the whole bill
        vatType: normVatType(i.vatType ?? po.vatType) as PoVatType,
        vatRate: i.vatType && normVatType(i.vatType) !== 'NONE' ? lineVatRate(i.vatRate) : 7,
        imageUrl: i.imageUrl || null,
      };
    });

    const first = mappedCartItems[0]?.vatType;
    setCreateInit({
      editingPo: po,
      suppliers: supps,
      supplierProducts: prods,
      createStep: 'items',
      selectedSupplier: supp,
      cartItems: mappedCartItems,
      billDiscountType: ((po.billDiscountType ?? po.discountType) as 'baht' | 'percent') || 'baht',
      billDiscountValue: Number(po.billDiscountValue ?? po.discountValue) || 0,
      vatType: first === 'INCLUDED' ? 'include' : first === 'EXCLUDED' ? 'exclude' : 'none',
    });
    setViewMode('create');
    setIsDetailOpen(false);
    setIsPdfModalOpen(false);
  };

  const openCancelDialog = (po: PurchaseOrder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (po.status === 'COMPLETED') {
      toast.error("ไม่สามารถยกเลิกใบสั่งซื้อที่รับสินค้าครบแล้วได้");
      return;
    }
    if (po.status === 'CANCELLED') {
      toast.info("ใบสั่งซื้อนี้ถูกยกเลิกไปแล้ว");
      return;
    }
    setTargetCancelPo(po);
    setCancelReason('ผู้จำหน่ายแจ้งสินค้าหมด/ยกเลิก');
    setCancelCustomReason('');
    setIsCancelModalOpen(true);
  };

  const handleConfirmCancelPO = async () => {
    if (!targetCancelPo) return;
    const finalReason = cancelReason === 'other' ? (cancelCustomReason.trim() || 'ยกเลิกโดยผู้ใช้งาน') : cancelReason;

    try {
      await apiFetch(`/purchase-orders/${targetCancelPo.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: finalReason }),
      });
    } catch {
      toast.error("ยกเลิกใบสั่งซื้อไม่สำเร็จ");
      return;
    }

    await fetchPOs();

    toast.success(`ยกเลิกใบสั่งซื้อ ${targetCancelPo.poNumber} เรียบร้อยแล้ว`);
    setIsCancelModalOpen(false);
    if (currentPo?.id === targetCancelPo.id) {
      setCurrentPo({ ...currentPo, status: 'CANCELLED' as const, cancelReason: finalReason });
    }
    if (pdfPoData?.id === targetCancelPo.id) {
      setPdfPoData({ ...(pdfPoData as PurchaseOrderData), status: 'CANCELLED' as const });
    }
    setTargetCancelPo(null);
  };

  const openImagePreview = (product: PreviewTarget, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const imgs = loadProductImages((product.id || product.productId) as string);
    if (imgs.length === 0 && product.imageUrl) imgs.push(product.imageUrl);
    setPreviewImages(imgs);
    setSelectedImageIdx(0);
    setPreviewProduct(product);
  };

  const openIssueConfirmDialog = (po: PurchaseOrder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTargetIssuePo(po);
    setIsIssueModalOpen(true);
  };

  const handleConfirmIssue = async () => {
    if (!targetIssuePo) return;
    const id = targetIssuePo.id;
    try {
      await apiFetch(`/purchase-orders/${id}/issue`, { method: "POST" });
    } catch (error) {
      toast.error(`ออกใบสั่งซื้อไม่สำเร็จ: ${(error as Error | undefined)?.message || 'เชื่อมต่อฐานข้อมูลไม่ได้'}`);
      return;
    }
    void fetchPOs();

    toast.success(`ออกใบสั่งซื้อ ${targetIssuePo.poNumber} สำเร็จ สถานะเปลี่ยนเป็น ISSUED`);
    if (isDetailOpen && currentPo?.id === id) {
      setCurrentPo({ ...currentPo, status: "ISSUED", issuedAt: new Date().toISOString() });
    }
    setIsIssueModalOpen(false);
    setTargetIssuePo(null);
  };

  const openStatusChangeDialog = (po: PurchaseOrder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTargetStatusChangePo(po);
    setNewSelectedStatus(po.status);
    setStatusChangeNote('');
    setIsStatusChangeModalOpen(true);
  };

  const handleConfirmStatusChange = async () => {
    if (!targetStatusChangePo) return;
    const oldStatus = targetStatusChangePo.status;
    const newStatus = newSelectedStatus;

    if (oldStatus === newStatus) {
      setIsStatusChangeModalOpen(false);
      return;
    }

    // Status changes go through the backend only. Receiving has its own dialog (GRN); rolling back
    // goods that were already received is not supported (it would need a supplier return document).
    try {
      if (newStatus === 'ISSUED' && oldStatus === 'DRAFT') {
        await apiFetch(`/purchase-orders/${targetStatusChangePo.id}/issue`, { method: "POST" });
      } else if (newStatus === 'CANCELLED') {
        await apiFetch(`/purchase-orders/${targetStatusChangePo.id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reason: statusChangeNote.trim() || 'เปลี่ยนสถานะเป็นยกเลิก' }),
        });
      } else {
        toast.error('เปลี่ยนสถานะนี้ไม่ได้: รับสินค้าใช้ปุ่ม "รับสินค้า (GRN)" ส่วนสินค้าที่รับแล้วต้องทำเอกสารส่งคืนบริษัท');
        return;
      }
    } catch (error) {
      toast.error(`เปลี่ยนสถานะไม่สำเร็จ: ${(error as Error | undefined)?.message || 'เชื่อมต่อฐานข้อมูลไม่ได้'}`);
      return;
    }
    await fetchPOs();
    if (isDetailOpen && currentPo?.id === targetStatusChangePo.id) {
      setIsDetailOpen(false);
    }
    toast.success(`เปลี่ยนสถานะใบสั่งซื้อ ${targetStatusChangePo.poNumber} เป็น ${newStatus} สำเร็จ`);

    setIsStatusChangeModalOpen(false);
    setTargetStatusChangePo(null);
  };

  const handleViewDetail = async (id: string, mode: 'detail' | 'pdf' = 'detail') => {
    // 1. Database first so paid / remaining / received quantities are current
    let poData: PurchaseOrder | null | undefined = null;
    try {
      const resp = await apiFetch(`/purchase-orders/${id}`);
      if (resp && typeof resp === 'object' && !Array.isArray(resp) && (resp.id || resp.poNumber)) {
        poData = resp;
      }
    } catch {}

    // 2. The list this page loaded from the server
    if (!poData) {
      poData = purchaseOrders.find((p) => p.id === id || p.poNumber === id);
    }

    if (poData) {
      // Hydrate supplier info if missing
      if (!poData.supplier || !poData.supplier.name) {
        const allSuppliers = suppliers;
        const supp = allSuppliers.find((s) => s.id === (poData!.supplierId || poData!.supplier?.id));
        if (supp) {
          poData = { ...poData, supplier: supp, supplierName: supp.name };
        }
      }
      setCurrentPo(poData);
      if (mode === 'pdf') {
        setPdfPoData(poData);
        setIsPdfModalOpen(true);
      } else {
        setIsDetailOpen(true);
      }
    } else {
      toast.error("ไม่พบข้อมูลใบสั่งซื้อ");
    }
  };

  const openReceiveDialog = (po: PurchaseOrder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (po.status === 'COMPLETED') {
      toast.info("ใบสั่งซื้อนี้รับสินค้าครบถ้วนแล้ว");
      return;
    }
    if (po.status === 'CANCELLED') {
      toast.error("ไม่สามารถรับสินค้าจากใบสั่งซื้อที่ยกเลิกแล้วได้");
      return;
    }

    setCurrentPo(po);

    // Get current inventory products (from the server) to display live stock
    const allProds = useProductStore.getState().products || [];

    const items: PoReceiveItem[] = (po.items || []).map((item) => {
      const prod = allProds.find((p) => (p.id === item.productId || p.sku === item.productId || p.sku === item.sku));
      const currentStock = Number(prod?.stock !== undefined && prod?.stock !== null ? prod.stock : (item.stock || 0));
      const ordered = Number(item.quantity) || 1;
      const received = Number(item.receivedQty ?? item.receivedQuantity) || 0;
      const remaining = Math.max(0, subQty(ordered, received));
      const mult = Number(item.multiplier) || 1;

      return {
        id: item.id,
        productId: item.productId,
        name: item.name || item.product?.name || prod?.name || 'สินค้า',
        sku: item.sku || prod?.sku || '-',
        unitName: item.unitName || item.unit || item.baseUnit || prod?.unit || 'ชิ้น',
        multiplier: mult,
        orderedQty: ordered,
        receivedQty: received,
        remainingQty: remaining,
        toReceive: remaining, // default to remaining
        currentStock,
        unitCost: item.unitCost,
        imageUrl: item.imageUrl || prod?.imageUrl || null,
      };
    });

    setReceiveItems(items);
    setReceiveSupplierInvoiceNo(po.supplierInvoiceNo || po.invoiceNo || '');
    setReceiveSupplierInvoiceDate(po.supplierInvoiceDate || po.invoiceDate || new Date().toISOString().slice(0, 10));
    setIsReceiveOpen(true);
  };

  const handleTriggerReceivePO = () => {
    if (!currentPo) return;

    const totalToReceive = addQty(...receiveItems.map((i) => Number(i.toReceive) || 0));
    if (totalToReceive <= 0) {
      toast.error("กรุณาระบุจำนวนสินค้าที่ต้องการรับเข้าสต็อกอย่างน้อย 1 รายการ");
      return;
    }

    // Check if there are items under-received (total received < ordered)
    const hasIncompleteItems = receiveItems.some((i) => {
      const totalRec = addQty(Number(i.receivedQty) || 0, Number(i.toReceive) || 0);
      return totalRec < Number(i.orderedQty);
    });

    if (hasIncompleteItems) {
      setUnderReceiveAction('ADJUST_AND_COMPLETE');
      setIsUnderReceiveModalOpen(true);
    } else {
      executeReceivePO(false);
    }
  };

  const receiveBusy = useRef(false);
  const executeReceivePO = async (adjustAndComplete: boolean) => {
    if (!currentPo || receiveBusy.current) return;
    receiveBusy.current = true;
    try {
      const result = await submitPurchaseReceipt(currentPo.id, {
        adjustAndComplete,
        supplierInvoiceNo: receiveSupplierInvoiceNo.trim(),
        items: receiveItems.map((item) => ({
          purchaseOrderItemId: item.id,
          receivedQty: parseQty(item.toReceive, allowDecimalQty) || 0,
          unitCost: Number(item.unitCost),
        })).filter((item) => item.receivedQty > 0),
      });
      setCurrentPo(result);
      setPdfPoData(result);
      toast.success('ฐานข้อมูลยืนยันรับสินค้าและปรับสต็อกเรียบร้อยแล้ว');
      setIsUnderReceiveModalOpen(false);
      setIsReceiveOpen(false);
      await fetchPOs();
      void useProductStore.getState().fetchProducts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกรับสินค้าไม่สำเร็จ กรุณาตรวจสอบรายการ');
    } finally { receiveBusy.current = false; }
  };

  const filteredPOs = purchaseOrders.filter(po => 
    statusFilter === "ALL" ? true : po.status === statusFilter
  );


  const imagePreview = (
    <ProductImagePreviewDialog
      previewProduct={previewProduct}
      setPreviewProduct={setPreviewProduct}
      previewImages={previewImages}
      selectedImageIdx={selectedImageIdx}
      setSelectedImageIdx={setSelectedImageIdx}
    />
  );

  if (viewMode === 'create' && createInit) {
    return (
      <PoCreateView
        init={createInit}
        searchScope={searchScope}
        setSearchScope={setSearchScope}
        catalogSearch={catalogSearch}
        setCatalogSearch={setCatalogSearch}
        allowDecimalQty={allowDecimalQty}
        loadAllProducts={loadAllProducts}
        fetchPOs={fetchPOs}
        openImagePreview={openImagePreview}
        onCancel={() => { setCreateInit(null); setViewMode('list'); }}
        onSaved={(po) => {
          setCreateInit(null);
          setViewMode('list');
          setCurrentPo(po);
          setPdfPoData(po);
          setIsPdfModalOpen(true);
        }}
      >
        {imagePreview}
      </PoCreateView>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <PackageOpen className="w-6 h-6 text-sky-500" /> เอกสารใบสั่งซื้อสินค้า (Purchase Orders)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">จัดการเอกสารใบสั่งซื้อสินค้า ตรวจรับของเข้าคลัง และเปิดใบ PO ถึงผู้จำหน่าย</p>
        </div>
        <Button
          className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-10 px-5 text-xs shadow-sm rounded-xl"
          onClick={openCreateDialog}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          เปิดใบสั่งซื้อใหม่
        </Button>
      </div>

      <PoListTable
        purchaseOrders={purchaseOrders}
        filteredPOs={filteredPOs}
        loading={loading}
        loadError={loadError}
        setStatusFilter={setStatusFilter}
        fetchPOs={fetchPOs}
        handleViewDetail={handleViewDetail}
        openEditDialog={openEditDialog}
        openIssueConfirmDialog={openIssueConfirmDialog}
        openReceiveDialog={openReceiveDialog}
        openStatusChangeDialog={openStatusChangeDialog}
        openCancelDialog={openCancelDialog}
      />

      {/* Receive Dialog (GRN) */}
      <PoReceiveDialog
        isReceiveOpen={isReceiveOpen}
        setIsReceiveOpen={setIsReceiveOpen}
        currentPo={currentPo}
        receiveItems={receiveItems}
        setReceiveItems={setReceiveItems}
        receiveSupplierInvoiceNo={receiveSupplierInvoiceNo}
        setReceiveSupplierInvoiceNo={setReceiveSupplierInvoiceNo}
        receiveSupplierInvoiceDate={receiveSupplierInvoiceDate}
        setReceiveSupplierInvoiceDate={setReceiveSupplierInvoiceDate}
        allowDecimalQty={allowDecimalQty}
        openImagePreview={openImagePreview}
        handleTriggerReceivePO={handleTriggerReceivePO}
      />

      <CreateSupplierReturnModal
        open={!!returnPo}
        onOpenChange={(o) => { if (!o) setReturnPo(null); }}
        initialSupplierId={returnPo?.supplierId || returnPo?.supplier?.id}
        initialPoId={returnPo?.id}
        onSuccess={(note) => {
          toast.success(`สร้างใบส่งคืน ${note.id} แล้ว ตัดสต็อกและนำยอดไปหักตอนจ่ายเจ้าหนี้ได้`);
          setReturnPo(null);
          void fetchPOs();
        }}
      />

      {/* PO Detail Dialog */}
      <PoDetailDialog
        isDetailOpen={isDetailOpen}
        setIsDetailOpen={setIsDetailOpen}
        currentPo={currentPo}
        openImagePreview={openImagePreview}
        openIssueConfirmDialog={openIssueConfirmDialog}
        openReceiveDialog={openReceiveDialog}
        openEditDialog={openEditDialog}
        openStatusChangeDialog={openStatusChangeDialog}
        openCancelDialog={openCancelDialog}
        openPdfModal={openPdfModal}
        setReturnPo={setReturnPo}
      />

      {/* Issue PO Confirmation Dialog */}
      <PoIssueDialog
        isIssueModalOpen={isIssueModalOpen}
        setIsIssueModalOpen={setIsIssueModalOpen}
        targetIssuePo={targetIssuePo}
        handleConfirmIssue={handleConfirmIssue}
      />

      {/* Change / Rollback Status Modal */}
      <PoStatusChangeDialog
        isStatusChangeModalOpen={isStatusChangeModalOpen}
        setIsStatusChangeModalOpen={setIsStatusChangeModalOpen}
        targetStatusChangePo={targetStatusChangePo}
        newSelectedStatus={newSelectedStatus}
        setNewSelectedStatus={setNewSelectedStatus}
        statusChangeNote={statusChangeNote}
        setStatusChangeNote={setStatusChangeNote}
        handleConfirmStatusChange={handleConfirmStatusChange}
      />

      {/* Cancel PO Confirmation Dialog */}
      <PoCancelDialog
        isCancelModalOpen={isCancelModalOpen}
        setIsCancelModalOpen={setIsCancelModalOpen}
        targetCancelPo={targetCancelPo}
        cancelReason={cancelReason}
        setCancelReason={setCancelReason}
        cancelCustomReason={cancelCustomReason}
        setCancelCustomReason={setCancelCustomReason}
        handleConfirmCancelPO={handleConfirmCancelPO}
      />

      {/* Under-Receive / Shortfall Confirmation Modal */}
      <PoUnderReceiveDialog
        isUnderReceiveModalOpen={isUnderReceiveModalOpen}
        setIsUnderReceiveModalOpen={setIsUnderReceiveModalOpen}
        currentPo={currentPo}
        receiveItems={receiveItems}
        underReceiveAction={underReceiveAction}
        setUnderReceiveAction={setUnderReceiveAction}
        executeReceivePO={executeReceivePO}
      />

      {/* Professional Purchase Order PDF / Print Modal */}
      <PurchaseOrderPdfModal
        open={isPdfModalOpen}
        onOpenChange={setIsPdfModalOpen}
        po={pdfPoData}
      />

    </div>
  );
}
