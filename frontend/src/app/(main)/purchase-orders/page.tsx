'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Eye, CheckCircle, PackageOpen,
  Trash2, Search, ChevronLeft, Building2, Package,
  Image as ImageIcon, Keyboard, ArrowDown, ArrowUp, X, Sparkles, Printer,
  Pencil, Ban, AlertTriangle, Info, RotateCcw, ArrowLeftRight, CheckCircle2, History
} from 'lucide-react';
import { toast } from 'sonner';

import { useProductStore } from '@/lib/store/product-store';
import sampleProducts from '@/lib/sample-products.json';
import PurchaseOrderPdfModal, { PurchaseOrderData } from '@/components/pos/PurchaseOrderPdfModal';
import { recordPoReceiveStock, recordPoRollbackStock } from '@/lib/stock-service';
import { DeductReturnNoteModal } from '@/components/pos/DeductReturnNoteModal';

function loadProductImages(productId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`img_${productId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cover = parsed.find((i: any) => i.isCover)?.dataUrl;
        const others = parsed.filter((i: any) => !i.isCover).map((i: any) => i.dataUrl);
        return cover ? [cover, ...others] : parsed.map((i: any) => i.dataUrl);
      }
    }
  } catch {}
  return [];
}

function loadSuppliersFromStorage(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('custom_suppliers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [
    { id: "supp_1", name: "บริษัท ปุริม ซัพพลาย จำกัด", contactName: "คุณสมชาย", phone: "081-234-5678", email: "contact@purimsupply.com", address: "123 ถ.สุขุมวิท กรุงเทพฯ", creditTerms: 30 },
    { id: "supp_2", name: "บจก. สยามเทรดดิ้ง แอนด์ ดีสทริบิวชั่น", contactName: "คุณวิภา", phone: "089-876-5432", email: "sales@siamtrading.co.th", address: "456 ถ.รัชดาภิเษก กรุงเทพฯ", creditTerms: 15 },
    { id: "supp_3", name: "หจก. รวมสินค้าค้าส่ง", contactName: "คุณกิตติ", phone: "02-999-8888", email: "wholesale@ruamkhong.com", address: "789 ถ.พหลโยธิน กรุงเทพฯ", creditTerms: 45 },
  ];
}

function loadPOsFromStorage(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('custom_purchase_orders');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const supps = loadSuppliersFromStorage();
        return parsed.map((po: any) => {
          if (!po.supplier || !po.supplier.name) {
            const supp = supps.find((s: any) => s.id === (po.supplierId || po.supplier?.id));
            if (supp) {
              return { ...po, supplier: supp, supplierName: supp.name };
            }
          }
          return po;
        });
      }
    }
  } catch {}
  return [];
}

function savePOsToStorage(pos: any[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('custom_purchase_orders', JSON.stringify(pos));
  } catch {}
}

const isBoundToSupplier = (product: any, supplierId: string) => {
  if (!supplierId) return false;
  if (product.supplierId === supplierId) return true;
  if (Array.isArray(product.barcodes) && product.barcodes.some((b: any) => b.supplierId === supplierId)) return true;
  if (Array.isArray(product.supplierEntries) && product.supplierEntries.some((s: any) => s.supplierId === supplierId)) return true;
  return false;
};

function getProductUnits(product: any): { name: string; mult: number }[] {
  const baseUnit = product.unit || 'ชิ้น';
  const units = [{ name: baseUnit, mult: 1 }];
  if (typeof window !== 'undefined' && product?.id) {
    try {
      const raw = localStorage.getItem(`pkg_${product.id}`);
      if (raw) {
        const pkg: any[] = JSON.parse(raw);
        if (Array.isArray(pkg) && pkg.length > 0) {
          let currentMult = 1;
          pkg.forEach(u => {
            const q = parseFloat(u.qtyPerPrev) || 1;
            currentMult = currentMult * q;
            if (u.name) units.push({ name: u.name, mult: currentMult });
          });
        }
      }
    } catch {}
  }
  return units;
}

export default function PurchaseOrdersPage() {
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [viewMode, setViewMode] = useState<'list' | 'create'>('list');
  const [createStep, setCreateStep] = useState<'supplier' | 'items'>('supplier');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [searchSupplier, setSearchSupplier] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [supplierProducts, setSupplierProducts] = useState<any[]>([]);
  const [searchScope, setSearchScope] = useState<'supplier' | 'all'>('supplier');
  const [searchProduct, setSearchProduct] = useState('');
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [billDiscountType, setBillDiscountType] = useState<'baht' | 'percent'>('baht');
  const [billDiscountValue, setBillDiscountValue] = useState<number>(0);
  const [vatType, setVatType] = useState<'none' | 'include' | 'exclude'>('none');
  const [isSupplierCatalogOpen, setIsSupplierCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');

  // Keyboard navigation & Image preview state
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [previewProduct, setPreviewProduct] = useState<any | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);

  // Detail Dialog
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [currentPo, setCurrentPo] = useState<any>(null);

  // Professional PDF / Print Dialog
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [pdfPoData, setPdfPoData] = useState<PurchaseOrderData | null>(null);

  // Edit and Cancel State
  const [editingPo, setEditingPo] = useState<any | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [targetCancelPo, setTargetCancelPo] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('ผู้จำหน่ายแจ้งสินค้าหมด/ยกเลิก');
  const [cancelCustomReason, setCancelCustomReason] = useState('');

  const openPdfModal = (poData: any, e?: any) => {
    if (e) e.stopPropagation();
    setPdfPoData(poData);
    setIsPdfModalOpen(true);
  };

  // Issue Confirmation State
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [targetIssuePo, setTargetIssuePo] = useState<any | null>(null);

  // Status Change and Rollback State
  const [isStatusChangeModalOpen, setIsStatusChangeModalOpen] = useState(false);
  const [targetStatusChangePo, setTargetStatusChangePo] = useState<any | null>(null);
  const [newSelectedStatus, setNewSelectedStatus] = useState<string>('DRAFT');
  const [rollbackStock, setRollbackStock] = useState<boolean>(true);
  const [statusChangeNote, setStatusChangeNote] = useState<string>('');

  // Receive Dialog
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [receiveItems, setReceiveItems] = useState<any[]>([]);

  // Under-Receive Confirmation State (เมื่อรับสินค้าไม่ครบตามใบสั่งซื้อ)
  const [isUnderReceiveModalOpen, setIsUnderReceiveModalOpen] = useState(false);
  const [underReceiveAction, setUnderReceiveAction] = useState<'ADJUST_AND_COMPLETE' | 'PARTIAL'>('ADJUST_AND_COMPLETE');

  // Supplier Claim Return Deduction Modal State
  const [isDeductReturnModalOpen, setIsDeductReturnModalOpen] = useState(false);
  const [targetPoForDeduct, setTargetPoForDeduct] = useState<any | null>(null);

  const fetchPOs = async () => {
    setLoading(true);
    let list: any[] = [];
    try {
      const data = await apiFetch("/purchase-orders");
      if (Array.isArray(data) && data.length > 0) list = data;
    } catch (error) {}

    if (list.length === 0) {
      list = loadPOsFromStorage();
    } else {
      savePOsToStorage(list);
    }

    setPurchaseOrders(list);
    setLoading(false);
  };

  const loadAllProducts = async () => {
    let prods = useProductStore.getState().products;
    if (!prods || prods.length === 0) {
      await useProductStore.getState().fetchProducts();
      prods = useProductStore.getState().products;
    }
    if (!prods || prods.length === 0) {
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('custom_products');
          if (raw) prods = JSON.parse(raw);
        } catch {}
      }
    }
    if (!prods || prods.length === 0) {
      prods = (sampleProducts as any[]) || [];
    }
    return prods || [];
  };

  useEffect(() => {
    fetchPOs();
    loadAllProducts().then(prods => setSupplierProducts(prods));
  }, []);

  const openCreateDialog = async () => {
    let supps: any[] = [];
    try {
      const data = await apiFetch("/suppliers");
      if (Array.isArray(data) && data.length > 0) supps = data;
    } catch (error) {}

    if (supps.length === 0) {
      supps = loadSuppliersFromStorage();
    }

    const prods = await loadAllProducts();
    setSupplierProducts(prods);
    setEditingPo(null);
    setSuppliers(supps);
    setCreateStep('supplier');
    setSelectedSupplier(null);
    setCartItems([]);
    setBillDiscountType('baht');
    setBillDiscountValue(0);
    setVatType('none');
    setIsSupplierCatalogOpen(false);
    setSearchSupplier('');
    setSearchProduct('');
    setHighlightIndex(0);
    setViewMode('create');
  };

  const openEditDialog = async (po: any, e?: any) => {
    if (e) e.stopPropagation();
    if (po.status === 'COMPLETED') {
      toast.error("ไม่สามารถแก้ไขใบสั่งซื้อที่รับสินค้าครบแล้วได้");
      return;
    }
    if (po.status === 'CANCELLED') {
      toast.error("ไม่สามารถแก้ไขใบสั่งซื้อที่ยกเลิกแล้วได้");
      return;
    }

    let supps: any[] = [];
    try {
      const data = await apiFetch("/suppliers");
      if (Array.isArray(data) && data.length > 0) supps = data;
    } catch (error) {}
    if (supps.length === 0) {
      supps = loadSuppliersFromStorage();
    }
    setSuppliers(supps);

    const supp = po.supplier || supps.find((s: any) => s.id === (po.supplierId || po.supplier?.id)) || {
      id: po.supplierId || 'supp_1',
      name: po.supplierName || 'ผู้จำหน่าย',
      contactName: '-',
      phone: '-',
      email: '-',
      address: '-',
      creditTerms: 30,
    };
    setSelectedSupplier(supp);

    const prods = await loadAllProducts();
    setSupplierProducts(prods);

    // Map existing PO items to cart items
    const mappedCartItems = (po.items || []).map((i: any) => {
      const uName = i.unitName || i.unit || i.baseUnit || 'ชิ้น';
      return {
        id: i.id,
        cartKey: `${i.productId || i.id}_${uName}`,
        productId: i.productId || i.id,
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
        imageUrl: i.imageUrl || null,
      };
    });

    setEditingPo(po);
    setCartItems(mappedCartItems);
    setBillDiscountType((po.discountType as 'baht' | 'percent') || 'baht');
    setBillDiscountValue(Number(po.discountValue) || 0);
    setVatType((po.vatType as 'none' | 'include' | 'exclude') || 'none');
    setSearchProduct('');
    setHighlightIndex(0);
    setCreateStep('items');
    setViewMode('create');
    setIsDetailOpen(false);
    setIsPdfModalOpen(false);
  };

  const openCancelDialog = (po: any, e?: any) => {
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

    const existingPOs = loadPOsFromStorage();
    const updatedPOs = existingPOs.map((p) => {
      if (p.id === targetCancelPo.id) {
        return {
          ...p,
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString(),
          cancelReason: finalReason,
        };
      }
      return p;
    });

    savePOsToStorage(updatedPOs);
    setPurchaseOrders(updatedPOs);

    try {
      await apiFetch(`/purchase-orders/${targetCancelPo.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: finalReason }),
      });
    } catch (error) {}

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

  const handleSelectSupplier = async (supplier: any) => {
    setSelectedSupplier(supplier);
    const prods = await loadAllProducts();
    setSupplierProducts(prods);
    setSearchProduct('');
    setHighlightIndex(0);
    setCreateStep('items');
    setTimeout(() => searchInputRef.current?.focus(), 150);
  };

  const openImagePreview = (product: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const imgs = loadProductImages(product.id || product.productId);
    if (imgs.length === 0 && product.imageUrl) imgs.push(product.imageUrl);
    setPreviewImages(imgs);
    setSelectedImageIdx(0);
    setPreviewProduct(product);
  };

  const createCartItemFromProduct = (product: any, quantity = 1) => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    stock: product.stock,
    unitCost: product.unitCost || product.basePrice || 0,
    quantity,
    discountType: 'baht' as 'baht' | 'percent',
    discountValue: 0,
    imageUrl: product.imageUrl || null,
  });

  const getCartItem = (productId: string) => cartItems.find(item => item.productId === productId);

  const updateProductQuantity = (product: any, quantity: number) => {
    const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    setCartItems(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (safeQuantity === 0) {
        return prev.filter(item => item.productId !== product.id);
      }
      if (existing) {
        return prev.map(item =>
          item.productId === product.id ? { ...item, quantity: safeQuantity } : item
        );
      }
      return [...prev, createCartItemFromProduct(product, safeQuantity)];
    });
  };

  const updateProductUnitCost = (product: any, cost: number) => {
    const safeCost = Math.max(0, Number(cost) || 0);
    setCartItems(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id ? { ...item, unitCost: safeCost } : item
        );
      }
      return [...prev, { ...createCartItemFromProduct(product), unitCost: safeCost }];
    });
  };

  const updateProductDiscount = (product: any, key: 'discountType' | 'discountValue', value: 'baht' | 'percent' | number) => {
    setCartItems(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id ? { ...item, [key]: value } : item
        );
      }
      return [...prev, { ...createCartItemFromProduct(product), [key]: value }];
    });
  };

  const removeCartItem = (productId: string) => {
    setCartItems(prev => prev.filter(item => item.productId !== productId));
  };

  const handleCreatePO = async () => {
    if (!selectedSupplier || cartItems.length === 0) {
      toast.error("กรุณาเลือกผู้จำหน่ายและเพิ่มสินค้าอย่างน้อย 1 รายการ");
      return;
    }

    const totalBeforeDiscount = cartItems.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unitCost;
      const discount = item.discountType === 'percent' 
        ? lineTotal * (item.discountValue / 100)
        : item.discountValue;
      return sum + Math.max(0, lineTotal - discount);
    }, 0);

    const billDiscount = billDiscountType === 'percent'
      ? totalBeforeDiscount * (billDiscountValue / 100)
      : billDiscountValue;
    
    const amountAfterBillDiscount = Math.max(0, totalBeforeDiscount - billDiscount);

    let calculatedVat = 0;
    let netAmount = amountAfterBillDiscount;
    let finalTotal = amountAfterBillDiscount;

    if (vatType === 'include') {
      calculatedVat = amountAfterBillDiscount * 7 / 107;
      netAmount = amountAfterBillDiscount - calculatedVat;
      finalTotal = amountAfterBillDiscount;
    } else if (vatType === 'exclude') {
      calculatedVat = amountAfterBillDiscount * 0.07;
      netAmount = amountAfterBillDiscount;
      finalTotal = amountAfterBillDiscount + calculatedVat;
    } else {
      calculatedVat = 0;
      netAmount = amountAfterBillDiscount;
      finalTotal = amountAfterBillDiscount;
    }

    if (editingPo) {
      const updatedPO = {
        ...editingPo,
        supplierId: selectedSupplier.id,
        supplier: selectedSupplier,
        supplierName: selectedSupplier.name,
        totalAmount: finalTotal,
        subtotal: totalBeforeDiscount,
        discountType: billDiscountType,
        discountValue: billDiscountValue,
        vatType,
        vatAmount: calculatedVat,
        netAmount,
        updatedAt: new Date().toISOString(),
        items: cartItems.map((i: any) => ({
          id: i.id || "poi_" + Math.random().toString(36).substring(2, 7),
          productId: i.productId,
          name: i.name,
          sku: i.sku,
          quantity: Number(i.quantity) || 1,
          receivedQuantity: Number(i.receivedQuantity) || 0,
          unitCost: Number(i.unitCost) || 0,
          unitName: i.unitName || i.baseUnit || 'ชิ้น',
          multiplier: i.multiplier || 1,
          discountType: i.discountType || 'baht',
          discountValue: Number(i.discountValue) || 0,
        })),
      };

      const existingPOs = loadPOsFromStorage();
      const updatedPOs = existingPOs.map((p) => p.id === editingPo.id ? updatedPO : p);
      savePOsToStorage(updatedPOs);
      setPurchaseOrders(updatedPOs);

      try {
        await apiFetch(`/purchase-orders/${editingPo.id}`, {
          method: "PUT",
          body: JSON.stringify(updatedPO),
        });
      } catch (error) {}

      toast.success(`บันทึกการแก้ไขใบสั่งซื้อ ${editingPo.poNumber} สำเร็จ`);
      setEditingPo(null);
      setViewMode('list');
      setCurrentPo(updatedPO);
      setPdfPoData(updatedPO);
      setIsPdfModalOpen(true);
      return;
    }

    const poNumber = "PO" + Date.now().toString().slice(-6);

    const newPO = {
      id: "po_" + Date.now(),
      poNumber,
      supplierId: selectedSupplier.id,
      supplier: selectedSupplier,
      supplierName: selectedSupplier.name,
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      totalAmount: finalTotal,
      subtotal: totalBeforeDiscount,
      discountType: billDiscountType,
      discountValue: billDiscountValue,
      vatType,
      vatAmount: calculatedVat,
      netAmount,
      items: cartItems.map((i: any) => ({
        id: "poi_" + Math.random().toString(36).substring(2, 7),
        productId: i.productId,
        name: i.name,
        sku: i.sku,
        quantity: Number(i.quantity) || 1,
        receivedQuantity: 0,
        unitCost: Number(i.unitCost) || 0,
        unitName: i.unitName || i.baseUnit || 'ชิ้น',
        multiplier: i.multiplier || 1,
        discountType: i.discountType || 'baht',
        discountValue: Number(i.discountValue) || 0,
      })),
    };

    const existingPOs = loadPOsFromStorage();
    const updatedPOs = [newPO, ...existingPOs];
    savePOsToStorage(updatedPOs);
    setPurchaseOrders(updatedPOs);

    try {
      await apiFetch("/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: selectedSupplier.id,
          items: cartItems.map((i: any) => ({
            productId: i.productId,
            quantity: Number(i.quantity),
            unitCost: Number(i.unitCost)
          }))
        })
      });
    } catch (error) {}

    toast.success("สร้างใบสั่งซื้อสำเร็จ");
    setViewMode('list');
    setCurrentPo(newPO);
    setPdfPoData(newPO);
    setIsPdfModalOpen(true);
  };

  const openIssueConfirmDialog = (po: any, e?: any) => {
    if (e) e.stopPropagation();
    setTargetIssuePo(po);
    setIsIssueModalOpen(true);
  };

  const handleConfirmIssue = async () => {
    if (!targetIssuePo) return;
    const id = targetIssuePo.id;
    const existingPOs = loadPOsFromStorage();
    const updatedPOs = existingPOs.map(po => po.id === id ? { ...po, status: "ISSUED", issuedAt: new Date().toISOString() } : po);
    savePOsToStorage(updatedPOs);
    setPurchaseOrders(updatedPOs);

    try {
      await apiFetch(`/purchase-orders/${id}/issue`, { method: "POST" });
    } catch (error) {}

    toast.success(`ออกใบสั่งซื้อ ${targetIssuePo.poNumber} สำเร็จ สถานะเปลี่ยนเป็น ISSUED`);
    if (isDetailOpen && currentPo?.id === id) {
      setCurrentPo({ ...currentPo, status: "ISSUED", issuedAt: new Date().toISOString() });
    }
    setIsIssueModalOpen(false);
    setTargetIssuePo(null);
  };

  const openStatusChangeDialog = (po: any, e?: any) => {
    if (e) e.stopPropagation();
    setTargetStatusChangePo(po);
    setNewSelectedStatus(po.status);
    setRollbackStock(true);
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

    // Check if moving from a received status (COMPLETED, PARTIALLY_RECEIVED) backwards to non-received (DRAFT, ISSUED, CANCELLED)
    const isRollingBackFromReceived = (oldStatus === 'COMPLETED' || oldStatus === 'PARTIALLY_RECEIVED') &&
      (newStatus === 'DRAFT' || newStatus === 'ISSUED' || newStatus === 'CANCELLED');

    let rollbackProductsCount = 0;
    if (isRollingBackFromReceived && rollbackStock) {
      // Deduct previously received stock from inventory
      if (typeof window !== 'undefined') {
        try {
          let storedProds: any[] = [];
          const raw = localStorage.getItem('custom_products');
          if (raw) storedProds = JSON.parse(raw);
          else storedProds = useProductStore.getState().products;

          if (Array.isArray(storedProds) && storedProds.length > 0) {
            const updatedProds = storedProds.map((prod: any) => {
              const pId = prod.id || prod.sku;
              const poItem = (targetStatusChangePo.items || []).find((item: any) => (
                item.productId === pId || item.productId === prod.id || item.productId === prod.sku || item.sku === prod.sku
              ));
              if (poItem && Number(poItem.receivedQuantity) > 0) {
                const mult = Number(poItem.multiplier) || 1;
                const deductBaseQty = Number(poItem.receivedQuantity) * mult;
                const curStock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
                rollbackProductsCount++;
                return {
                  ...prod,
                  stock: Math.max(0, curStock - deductBaseQty),
                };
              }
              return prod;
            });

            localStorage.setItem('custom_products', JSON.stringify(updatedProds));
            useProductStore.getState().fetchProducts();
            recordPoRollbackStock(targetStatusChangePo.items || [], targetStatusChangePo.poNumber);
          }
        } catch (err) {
          console.error('Failed to rollback inventory stock:', err);
        }
      }
    }

    // Update PO in storage
    const existingPOs = loadPOsFromStorage();
    const updatedPOs = existingPOs.map((po: any) => {
      if (po.id === targetStatusChangePo.id) {
        let updatedItems = po.items || [];
        if (newStatus === 'DRAFT' || newStatus === 'ISSUED' || newStatus === 'CANCELLED') {
          if (rollbackStock) {
            updatedItems = updatedItems.map((i: any) => ({ ...i, receivedQuantity: 0 }));
          }
        } else if (newStatus === 'COMPLETED') {
          updatedItems = updatedItems.map((i: any) => ({ ...i, receivedQuantity: i.quantity }));
        }

        const historyEntry = {
          from: oldStatus,
          to: newStatus,
          changedAt: new Date().toISOString(),
          note: statusChangeNote.trim() || 'เปลี่ยนสถานะผ่านระบบจัดการสถานะ',
          rolledBackStock: isRollingBackFromReceived && rollbackStock,
        };

        return {
          ...po,
          status: newStatus,
          items: updatedItems,
          statusHistory: [...(po.statusHistory || []), historyEntry],
          updatedAt: new Date().toISOString(),
        };
      }
      return po;
    });

    savePOsToStorage(updatedPOs);
    setPurchaseOrders(updatedPOs);

    const updatedCurrentPo = updatedPOs.find(p => p.id === targetStatusChangePo.id);
    if (isDetailOpen && currentPo?.id === targetStatusChangePo.id && updatedCurrentPo) {
      setCurrentPo(updatedCurrentPo);
      setPdfPoData(updatedCurrentPo);
    }

    try {
      await apiFetch(`/purchase-orders/${targetStatusChangePo.id}`, {
        method: "PUT",
        body: JSON.stringify(updatedCurrentPo),
      });
    } catch (error) {}

    toast.success(
      rollbackProductsCount > 0
        ? `เปลี่ยนสถานะเป็น ${newStatus} สำเร็จ และคืนยอดสต็อกสินค้า ${rollbackProductsCount} รายการ`
        : `เปลี่ยนสถานะใบสั่งซื้อ ${targetStatusChangePo.poNumber} เป็น ${newStatus} สำเร็จ`
    );

    setIsStatusChangeModalOpen(false);
    setTargetStatusChangePo(null);
  };

  const handleViewDetail = async (id: string) => {
    // 1. Look up in local storage / current state first
    const stored = loadPOsFromStorage();
    let poData: any = stored.find((p: any) => p.id === id || p.poNumber === id) || 
                      purchaseOrders.find((p: any) => p.id === id || p.poNumber === id);

    // 2. If not found in local, attempt API
    if (!poData) {
      try {
        const resp = await apiFetch(`/purchase-orders/${id}`);
        if (resp && typeof resp === 'object' && !Array.isArray(resp) && (resp.id || resp.poNumber)) {
          poData = resp;
        }
      } catch (error) {}
    }

    if (poData) {
      // Hydrate supplier info if missing
      if (!poData.supplier || !poData.supplier.name) {
        const allSuppliers = suppliers.length > 0 ? suppliers : loadSuppliersFromStorage();
        const supp = allSuppliers.find((s: any) => s.id === (poData.supplierId || poData.supplier?.id));
        if (supp) {
          poData = { ...poData, supplier: supp, supplierName: supp.name };
        }
      }
      setCurrentPo(poData);
      setPdfPoData(poData);
      setIsPdfModalOpen(true);
    } else {
      toast.error("ไม่พบข้อมูลใบสั่งซื้อ");
    }
  };

  const openReceiveDialog = (po: any, e?: any) => {
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

    // Get current inventory products to display live stock
    let allProds: any[] = [];
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('custom_products');
        if (raw) allProds = JSON.parse(raw);
      } catch {}
    }
    if (!allProds || allProds.length === 0) {
      allProds = useProductStore.getState().products;
    }

    const items = (po.items || []).map((item: any) => {
      const prod = allProds.find((p: any) => (p.id === item.productId || p.sku === item.productId || p.sku === item.sku));
      const currentStock = Number(prod?.stock !== undefined && prod?.stock !== null ? prod.stock : (item.stock || 0));
      const ordered = Number(item.quantity) || 1;
      const received = Number(item.receivedQuantity) || 0;
      const remaining = Math.max(0, ordered - received);
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
    setIsReceiveOpen(true);
  };

  const handleTriggerReceivePO = () => {
    if (!currentPo) return;

    const totalToReceive = receiveItems.reduce((s, i) => s + (Number(i.toReceive) || 0), 0);
    if (totalToReceive <= 0) {
      toast.error("กรุณาระบุจำนวนสินค้าที่ต้องการรับเข้าสต็อกอย่างน้อย 1 รายการ");
      return;
    }

    // Check if there are items under-received (total received < ordered)
    const hasIncompleteItems = receiveItems.some((i: any) => {
      const totalRec = (Number(i.receivedQty) || 0) + (Number(i.toReceive) || 0);
      return totalRec < Number(i.orderedQty);
    });

    if (hasIncompleteItems) {
      setUnderReceiveAction('ADJUST_AND_COMPLETE');
      setIsUnderReceiveModalOpen(true);
    } else {
      executeReceivePO(false);
    }
  };

  const executeReceivePO = async (adjustAndComplete: boolean) => {
    if (!currentPo) return;

    // 1. Update stock in custom_products localStorage and store
    let updatedProductsCount = 0;
    if (typeof window !== 'undefined') {
      try {
        let storedProds: any[] = [];
        const raw = localStorage.getItem('custom_products');
        if (raw) {
          storedProds = JSON.parse(raw);
        } else {
          storedProds = useProductStore.getState().products;
        }

        if (Array.isArray(storedProds) && storedProds.length > 0) {
          const updatedProds = storedProds.map((prod: any) => {
            const pId = prod.id || prod.sku;
            const rec = receiveItems.find((r: any) => (
              r.productId === pId || r.productId === prod.id || r.productId === prod.sku || r.sku === prod.sku
            ));
            if (rec && Number(rec.toReceive) > 0) {
              const addQty = Number(rec.toReceive) * (Number(rec.multiplier) || 1);
              const curStock = Number(prod.stock !== undefined && prod.stock !== null ? prod.stock : 0);
              updatedProductsCount++;
              return {
                ...prod,
                stock: curStock + addQty,
              };
            }
            return prod;
          });

          localStorage.setItem('custom_products', JSON.stringify(updatedProds));
          useProductStore.getState().fetchProducts();
          recordPoReceiveStock(receiveItems, currentPo.poNumber);
        }
      } catch (err) {
        console.error('Failed to update product stock on receive:', err);
      }
    }

    // 2. Update PO status, items, receivedQuantity and amounts
    const existingPOs = loadPOsFromStorage();
    let newPoStatus = "PARTIALLY_RECEIVED";
    let updatedTargetPo: any = null;

    const updatedPOs = existingPOs.map(po => {
      if (po.id === currentPo.id) {
        let updatedItems = (po.items || []).map((item: any) => {
          const rec = receiveItems.find(r => r.id === item.id || r.productId === item.productId);
          const addQty = rec ? Number(rec.toReceive) || 0 : 0;
          const newReceivedQty = (Number(item.receivedQuantity) || 0) + addQty;

          if (adjustAndComplete) {
            const unitCost = Number(item.unitCost) || 0;
            return {
              ...item,
              quantity: newReceivedQty,
              receivedQuantity: newReceivedQty,
              subtotal: newReceivedQty * unitCost,
            };
          } else {
            return {
              ...item,
              receivedQuantity: newReceivedQty,
            };
          }
        });

        if (adjustAndComplete) {
          newPoStatus = "COMPLETED";
          const newSubtotal = updatedItems.reduce((s: number, i: any) => s + (Number(i.subtotal) || 0), 0);
          let newDiscountAmount = 0;
          if (po.discountType === 'percent' || po.discountPercent) {
            const pct = Number(po.discountPercent) || 0;
            newDiscountAmount = (newSubtotal * pct) / 100;
          } else {
            newDiscountAmount = Math.min(Number(po.discountAmount) || 0, newSubtotal);
          }

          const netBeforeVat = Math.max(0, newSubtotal - newDiscountAmount);
          const vatType = po.vatType || 'none';
          let newVatAmount = 0;
          let newTotalAmount = netBeforeVat;

          if (vatType === 'include') {
            newVatAmount = netBeforeVat - (netBeforeVat / 1.07);
            newTotalAmount = netBeforeVat;
          } else if (vatType === 'exclude') {
            newVatAmount = netBeforeVat * 0.07;
            newTotalAmount = netBeforeVat + newVatAmount;
          } else {
            newVatAmount = 0;
            newTotalAmount = netBeforeVat;
          }

          const historyEntry = {
            from: po.status,
            to: 'COMPLETED',
            changedAt: new Date().toISOString(),
            note: 'รับสินค้าไม่ครบ และทำการปรับลดยอดในใบ PO ให้ตรงกับจำนวนรับจริงเพื่อปิดเอกสารและตัดยอดจ่ายเงิน',
          };

          updatedTargetPo = {
            ...po,
            status: 'COMPLETED',
            items: updatedItems,
            subtotal: newSubtotal,
            discountAmount: newDiscountAmount,
            vatAmount: newVatAmount,
            totalAmount: newTotalAmount,
            netAmount: newTotalAmount,
            receivedAt: new Date().toISOString(),
            statusHistory: [...(po.statusHistory || []), historyEntry],
          };
          return updatedTargetPo;
        } else {
          const isAllReceived = updatedItems.every((i: any) => (Number(i.receivedQuantity) || 0) >= Number(i.quantity));
          newPoStatus = isAllReceived ? "COMPLETED" : "PARTIALLY_RECEIVED";
          updatedTargetPo = {
            ...po,
            status: newPoStatus,
            items: updatedItems,
            receivedAt: new Date().toISOString(),
          };
          return updatedTargetPo;
        }
      }
      return po;
    });

    savePOsToStorage(updatedPOs);
    setPurchaseOrders(updatedPOs);

    if (updatedTargetPo) {
      setCurrentPo(updatedTargetPo);
      setPdfPoData(updatedTargetPo);
    }

    try {
      await apiFetch(`/purchase-orders/${currentPo.id}/receive`, {
        method: "POST",
        body: JSON.stringify({
          adjustAndComplete,
          items: receiveItems.map((i: any) => ({
            purchaseOrderItemId: i.id,
            productId: i.productId,
            receivedQty: Number(i.toReceive),
            unitCost: Number(i.unitCost)
          })).filter((i: any) => i.receivedQty > 0)
        })
      });
    } catch (error) {}

    if (adjustAndComplete) {
      toast.success(`ปรับยอดในใบสั่งซื้อ ${currentPo.poNumber} ให้เท่ากับจำนวนรับจริง และปิดเอกสาร COMPLETED เรียบร้อย (สต็อกเพิ่ม ${updatedProductsCount} รายการ)`);
    } else {
      toast.success(
        newPoStatus === "COMPLETED"
          ? `รับสินค้าครบถ้วนแล้ว! ใบสั่งซื้อเปลี่ยนเป็น COMPLETED และเพิ่มสต็อกเข้าคลังเรียบร้อย (${updatedProductsCount} รายการ)`
          : `บันทึกการรับสินค้าเรียบร้อย (รับบางส่วน) และเพิ่มสต็อกเข้าคลังแล้ว (${updatedProductsCount} รายการ)`
      );
    }

    setIsUnderReceiveModalOpen(false);
    setIsReceiveOpen(false);
    fetchPOs();
  };

  const filteredPOs = purchaseOrders.filter(po => 
    statusFilter === "ALL" ? true : po.status === statusFilter
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT': return <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200">DRAFT</Badge>;
      case 'ISSUED': return <Badge className="bg-sky-50 text-sky-700 hover:bg-sky-100">ISSUED</Badge>;
      case 'PARTIALLY_RECEIVED': return <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-100">PARTIAL</Badge>;
      case 'COMPLETED': return <Badge className="bg-green-50 text-green-700 hover:bg-green-100">COMPLETED</Badge>;
      case 'CANCELLED': return <Badge className="bg-red-50 text-red-600 hover:bg-red-100">CANCELLED</Badge>;
      default: return <Badge className="bg-slate-100 text-slate-800">{status}</Badge>;
    }
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchSupplier.toLowerCase()) || 
    (s.phone && s.phone.includes(searchSupplier))
  );

  const addCartItemWithUnit = (product: any, unitName: string, multiplier: number, deltaQty = 1) => {
    const targetUnit = unitName || product.unit || 'ชิ้น';
    const cartKey = `${product.id}_${targetUnit}`;
    const baseCost = product.unitCost || product.basePrice || 0;
    const unitCost = baseCost * multiplier;

    setCartItems(prev => {
      const existingIndex = prev.findIndex(item => (item.cartKey ? item.cartKey === cartKey : (item.productId === product.id && item.unitName === targetUnit)));
      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const newQty = existing.quantity + deltaQty;
        if (newQty <= 0) return prev.filter((_, idx) => idx !== existingIndex);
        const updated = [...prev];
        updated[existingIndex] = { ...existing, quantity: newQty };
        return updated;
      }
      const newItem = {
        cartKey,
        productId: product.id,
        name: product.name,
        sku: product.sku,
        stock: product.stock,
        baseUnit: product.unit || 'ชิ้น',
        unitName: targetUnit,
        multiplier: multiplier,
        unitCost: unitCost,
        quantity: deltaQty,
        discountType: 'baht' as 'baht' | 'percent',
        discountValue: 0,
        imageUrl: product.imageUrl || null,
      };
      return [...prev, newItem];
    });
    toast.success(`เพิ่ม "${product.name}" (${targetUnit}) ลงตารางเรียบร้อยแล้ว`);
  };

  const filteredSupplierProducts = useMemo(() => {
    let list = supplierProducts;
    if (searchScope === 'supplier' && selectedSupplier) {
      list = list.filter(p => isBoundToSupplier(p, selectedSupplier.id));
    }
    const q = searchProduct.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcodes && p.barcodes.some((b: any) => (b.barcode || '').includes(q)))
    );
  }, [supplierProducts, searchScope, selectedSupplier, searchProduct]);

  const filteredCatalogProducts = useMemo(() => {
    if (!selectedSupplier) return [];
    const bound = supplierProducts.filter(p => isBoundToSupplier(p, selectedSupplier.id));
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return bound;
    return bound.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcodes && p.barcodes.some((b: any) => (b.barcode || '').includes(q)))
    );
  }, [supplierProducts, selectedSupplier, catalogSearch]);

  // Keyboard navigation inside search dropdown
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const list = filteredSupplierProducts.slice(0, 8);
    if (list.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => (prev + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => (prev - 1 + list.length) % list.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedProd = list[highlightIndex] || list[0];
      if (selectedProd) {
        const units = getProductUnits(selectedProd);
        addCartItemWithUnit(selectedProd, units[0].name, units[0].mult, 1);
        setSearchProduct('');
        setHighlightIndex(0);
      }
    } else if (e.key === 'Escape') {
      setSearchProduct('');
    }
  };

  // Ref to always hold latest handleCreatePO function for shortcuts
  const handleCreatePORef = useRef(handleCreatePO);
  useEffect(() => {
    handleCreatePORef.current = handleCreatePO;
  });

  // Global keyboard shortcuts (Ctrl+Enter to save)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (viewMode === 'create' && createStep === 'items') {
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          handleCreatePORef.current?.();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [viewMode, createStep]);

  const getItemGross = (item: any) => item.quantity * item.unitCost;

  const getItemDiscountAmount = (item: any) => {
    const gross = getItemGross(item);
    const value = Math.max(0, Number(item.discountValue) || 0);
    const discount = item.discountType === 'percent' ? gross * Math.min(value, 100) / 100 : value;
    return Math.min(gross, discount);
  };

  const getItemTotal = (item: any) => Math.max(0, getItemGross(item) - getItemDiscountAmount(item));

  const subtotalBeforeDiscount = cartItems.reduce((sum, item) => sum + getItemGross(item), 0);
  const itemDiscountTotal = cartItems.reduce((sum, item) => sum + getItemDiscountAmount(item), 0);
  const subtotalAfterItemDiscount = Math.max(0, subtotalBeforeDiscount - itemDiscountTotal);
  const billDiscountAmount = Math.min(
    subtotalAfterItemDiscount,
    billDiscountType === 'percent'
      ? subtotalAfterItemDiscount * Math.min(Math.max(0, billDiscountValue), 100) / 100
      : Math.max(0, billDiscountValue || 0)
  );
  const amountAfterBillDiscount = Math.max(0, subtotalAfterItemDiscount - billDiscountAmount);

  let vatAmount = 0;
  let netBeforeVat = amountAfterBillDiscount;
  let cartTotal = amountAfterBillDiscount;

  if (vatType === 'include') {
    vatAmount = amountAfterBillDiscount * 7 / 107;
    netBeforeVat = amountAfterBillDiscount - vatAmount;
    cartTotal = amountAfterBillDiscount;
  } else if (vatType === 'exclude') {
    vatAmount = amountAfterBillDiscount * 0.07;
    netBeforeVat = amountAfterBillDiscount;
    cartTotal = amountAfterBillDiscount + vatAmount;
  } else {
    vatAmount = 0;
    netBeforeVat = amountAfterBillDiscount;
    cartTotal = amountAfterBillDiscount;
  }

  if (viewMode === 'create') {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] w-full max-w-full flex-col overflow-hidden bg-slate-50 lg:h-dvh">
        {createStep === 'supplier' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-6 h-6 text-primary" />
                  {editingPo ? `แก้ไขใบสั่งซื้อ (PO: ${editingPo.poNumber})` : 'เปิดใบสั่งซื้อ (PO) ใหม่'}
                  {editingPo && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold ml-2">
                      กำลังแก้ไข
                    </Badge>
                  )}
                </h1>
                <p className="text-slate-500 text-sm mt-1">
                  {editingPo ? 'ขั้นตอนที่ 1: เปลี่ยนผู้จำหน่าย (หรือกดปุ่มเพื่อข้ามไปขั้นตอนถัดไป)' : 'ขั้นตอนที่ 1: เลือกผู้จำหน่ายที่ต้องการสั่งซื้อสินค้า'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {editingPo && (
                  <Button variant="outline" onClick={() => setCreateStep('items')} className="border-slate-300 text-slate-700">
                    ข้ามไปตารางสินค้า →
                  </Button>
                )}
                <Button variant="ghost" onClick={() => { setEditingPo(null); setViewMode('list'); }} className="text-slate-500 hover:bg-slate-100">
                  ยกเลิก (Esc)
                </Button>
              </div>
            </div>
            <div className="bg-white px-4 py-4 border-b border-slate-200 shrink-0 sm:px-6">
              <div className="relative max-w-2xl mx-auto">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <Input 
                  placeholder="ค้นหาชื่อผู้จำหน่าย หรือ เบอร์โทร..." 
                  className="pl-12 bg-slate-50 border-slate-300 focus-visible:ring-sky-500 h-12 text-lg rounded-full"
                  value={searchSupplier}
                  onChange={(e) => setSearchSupplier(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
              <div className="mx-auto grid max-w-7xl grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 sm:gap-6">
                {filteredSuppliers.map((supplier) => (
                  <div 
                    key={supplier.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-sky-400 cursor-pointer transition-all flex flex-col items-center text-center group"
                    onClick={() => handleSelectSupplier(supplier)}
                  >
                    <div className="w-14 h-14 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-inner">
                      <Building2 className="w-7 h-7" />
                    </div>
                    <h3 className="font-semibold text-slate-900 text-lg mb-1">{supplier.name}</h3>
                    <p className="text-slate-500 text-sm">{supplier.phone || 'ไม่มีเบอร์ติดต่อ'}</p>
                    {supplier.creditTerms && (
                      <Badge variant="outline" className="mt-3 text-xs text-sky-700 border-sky-200 bg-sky-50">
                        เครดิต {supplier.creditTerms} วัน
                      </Badge>
                    )}
                  </div>
                ))}
                {filteredSuppliers.length === 0 && (
                  <div className="col-span-full py-12 text-center text-slate-500">
                    ไม่พบผู้จำหน่ายที่ค้นหา
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="z-10 flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                <Button variant="ghost" size="sm" onClick={() => setCreateStep('supplier')} className="text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                  <ChevronLeft className="w-4 h-4 mr-1" /> เปลี่ยนผู้จำหน่าย
                </Button>
                <div className="hidden h-4 w-px bg-slate-200 mx-1 sm:block"></div>
                <h2 className="flex min-w-0 items-center gap-2 font-semibold text-slate-900 text-lg">
                  <Building2 className="w-5 h-5 text-sky-500" />
                  <span className="truncate">{selectedSupplier?.name}</span>
                  {editingPo && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold ml-1.5 shrink-0">
                      กำลังแก้ไข ({editingPo.poNumber})
                    </Badge>
                  )}
                </h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setEditingPo(null); setViewMode('list'); }} className="text-slate-500 hover:bg-slate-100">
                {editingPo ? 'ยกเลิกการแก้ไข' : 'ยกเลิก'}
              </Button>
            </div>
            
            <div className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-slate-50">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 sm:p-4">
                <div className="mb-4 flex shrink-0 flex-col gap-3 px-1 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" /> ตารางสั่งของ
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">เลือกขอบเขตค้นหา สั่งสินค้าตามหน่วยบรรจุ แล้วกด [Enter] หรือคลิกเพิ่มสินค้าอย่างสะดวกรวดเร็ว</p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
                    {/* Radio Options */}
                    <div className="flex items-center gap-3 bg-white px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 shadow-sm shrink-0">
                      <span className="font-bold text-slate-500">ค้นหา:</span>
                      <label className="flex items-center gap-1.5 cursor-pointer hover:text-sky-600 font-semibold">
                        <input
                          type="radio"
                          name="searchScope"
                          value="supplier"
                          checked={searchScope === 'supplier'}
                          onChange={() => setSearchScope('supplier')}
                          className="accent-sky-600 h-3.5 w-3.5"
                        />
                        <span>เฉพาะผู้จำหน่ายนี้ ({selectedSupplier?.name || 'ซัพพลายเออร์'})</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer hover:text-sky-600 font-semibold">
                        <input
                          type="radio"
                          name="searchScope"
                          value="all"
                          checked={searchScope === 'all'}
                          onChange={() => setSearchScope('all')}
                          className="accent-sky-600 h-3.5 w-3.5"
                        />
                        <span>สินค้าทั้งหมดในระบบ</span>
                      </label>
                    </div>

                    <div className="relative w-full sm:w-80">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <Input
                        ref={searchInputRef}
                        placeholder="พิมพ์ค้นหาสินค้า (↑/↓ เลื่อน, Enter เลือก)..."
                        className="h-10 bg-white pl-9 pr-8 text-sm border-slate-300 focus-visible:ring-sky-500 shadow-sm"
                        value={searchProduct}
                        onChange={(e) => {
                          setSearchProduct(e.target.value);
                          setHighlightIndex(0);
                        }}
                        onKeyDown={handleSearchKeyDown}
                      />
                      {searchProduct.trim() && (
                        <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl max-h-96 overflow-y-auto">
                          {filteredSupplierProducts.slice(0, 10).length === 0 ? (
                            <div className="p-4 text-sm text-slate-500 text-center space-y-2">
                              <p>
                                {searchScope === 'supplier' 
                                  ? `ไม่พบสินค้าที่ผูกกับผู้จำหน่าย "${selectedSupplier?.name}" (ค้นหา: "${searchProduct}")` 
                                  : `ไม่พบสินค้าที่ค้นหา "${searchProduct}"`}
                              </p>
                              {searchScope === 'supplier' && (
                                <button
                                  type="button"
                                  onClick={() => setSearchScope('all')}
                                  className="inline-flex items-center gap-1 text-xs text-sky-600 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-lg hover:bg-sky-100 font-semibold transition-colors"
                                >
                                  สลับไปค้นหา "สินค้าทั้งหมดในระบบ"
                                </button>
                              )}
                            </div>
                          ) : (
                            filteredSupplierProducts.slice(0, 10).map((product: any, idx: number) => {
                              const isHighlighted = idx === highlightIndex;
                              const units = getProductUnits(product);

                              return (
                                <div
                                  key={product.id}
                                  className={`flex flex-col gap-2 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 transition-colors ${
                                    isHighlighted ? "bg-sky-50/90 border-sky-200" : "hover:bg-slate-50"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <button
                                        type="button"
                                        onClick={(e) => openImagePreview(product, e)}
                                        className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400 hover:text-sky-600 hover:border-sky-300 transition-colors"
                                        title="กดเพื่อดูรูปสินค้า"
                                      >
                                        <ImageIcon className="w-4 h-4" />
                                      </button>
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-bold text-slate-900">{product.name}</div>
                                        <div className="truncate text-xs text-slate-500 flex items-center gap-1.5">
                                          <span>{product.sku}</span>
                                          <span>·</span>
                                          <span>คงเหลือ:</span>
                                          {Number(product.stock ?? 0) < 0 ? (
                                            <span className="font-extrabold text-rose-600 bg-rose-50 px-1 rounded border border-rose-200">
                                              🔻 {product.stock} {product.unit || 'ชิ้น'}
                                            </span>
                                          ) : (
                                            <b className="text-slate-700">{product.stock ?? '-'} {product.unit || 'ชิ้น'}</b>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    {isHighlighted && (
                                      <span className="text-[10px] bg-sky-500 text-white font-bold px-1.5 py-0.5 rounded shrink-0">
                                        Enter ↵
                                      </span>
                                    )}
                                  </div>

                                  {/* Packaging Units Selector Pills */}
                                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    <span className="text-[11px] text-slate-400 font-medium mr-1">สั่งเพิ่มหน่วย:</span>
                                    {units.map((u, ui) => {
                                      const isAdded = cartItems.some(i => i.productId === product.id && (i.unitName === u.name || (!i.unitName && u.name === (product.unit || 'ชิ้น'))));
                                      return (
                                        <button
                                          key={ui}
                                          type="button"
                                          onClick={() => {
                                            addCartItemWithUnit(product, u.name, u.mult, 1);
                                            setSearchProduct('');
                                            setHighlightIndex(0);
                                          }}
                                          className={`text-xs font-semibold px-2.5 py-1 rounded-md border transition-all flex items-center gap-1 ${
                                            isAdded
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                              : 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-500 hover:text-white shadow-xs'
                                          }`}
                                        >
                                          <span>+1 {u.name}</span>
                                          {u.mult > 1 && <span className="text-[10px] opacity-75">(×{u.mult})</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      className="h-10 border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
                      onClick={() => setIsSupplierCatalogOpen(true)}
                    >
                      <Package className="mr-2 h-4 w-4 text-sky-500" />
                      ดูสินค้าจากผู้จำหน่ายทั้งหมด
                    </Button>
                  </div>
                </div>

                {/* Table */}
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="hidden grid-cols-[48px_minmax(0,1.6fr)_90px_96px_88px_150px_112px_44px] items-center gap-3 border-b border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
                    <div className="text-center">ลำดับ</div>
                    <div>สินค้า</div>
                    <div className="text-right">คงเหลือ</div>
                    <div className="text-right">ต้นทุน/หน่วย</div>
                    <div className="text-right">จำนวน</div>
                    <div>ส่วนลดรายการ</div>
                    <div className="text-right">รวมสุทธิ</div>
                    <div className="text-center">ลบ</div>
                  </div>

                  {cartItems.length === 0 ? (
                    <div className="flex min-h-72 flex-col items-center justify-center text-center text-slate-500 space-y-3">
                      <PackageOpen className="h-14 w-14 text-slate-300" />
                      <p className="font-semibold text-base text-slate-700">ยังไม่มีสินค้าในตารางสั่งของ</p>
                      <p className="text-sm text-slate-400">พิมพ์ค้นหาสินค้าด้านบนแล้วกด Enter หรือคลิก "ดูสินค้าจากผู้จำหน่ายทั้งหมด"</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {cartItems.map((item, index) => {
                        const product = supplierProducts.find(p => p.id === item.productId) || { ...item, id: item.productId };
                        const unitCost = item.unitCost;
                        const quantity = item.quantity;
                        const discountType = item.discountType;
                        const discountValue = item.discountValue;
                        const rowTotal = getItemTotal(item);

                        return (
                          <div
                            key={item.productId}
                            className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-sky-50/30 lg:grid-cols-[48px_minmax(0,1.6fr)_90px_96px_88px_150px_112px_44px] lg:items-center"
                          >
                            {/* Col 1: ลำดับ */}
                            <div className="hidden lg:block text-center font-semibold text-slate-400 text-sm">
                              {index + 1}
                            </div>

                            {/* Col 2: สินค้า + รูป */}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2.5">
                                <span className="lg:hidden text-xs font-bold text-slate-400">#{index + 1}</span>
                                <button
                                  type="button"
                                  onClick={(e) => openImagePreview(product, e)}
                                  className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400 hover:text-sky-600 hover:border-sky-300 transition-colors shadow-sm"
                                  title="กดเพื่อดูรูปภาพสินค้า"
                                >
                                  <ImageIcon className="w-4 h-4" />
                                </button>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                    <span>{product.name}</span>
                                    <Badge className="bg-sky-100 text-sky-800 border-sky-300 text-xs font-bold shrink-0">
                                      {item.unitName || item.baseUnit || 'ชิ้น'} {item.multiplier > 1 ? `(×${item.multiplier})` : ''}
                                    </Badge>
                                  </div>
                                  <div className="truncate text-xs text-slate-500 font-mono">{product.sku}</div>
                                </div>
                              </div>
                            </div>

                            {/* Col 3: คงเหลือ */}
                            <div className="flex items-center justify-between text-sm text-slate-600 lg:block lg:text-right">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">คงเหลือ</span>
                              <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                                {item.stock ?? product.stock ?? '-'}
                              </Badge>
                            </div>

                            {/* Col 4: ต้นทุน */}
                            <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs font-medium text-slate-500 lg:block">
                              <span className="lg:hidden">ต้นทุน</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={unitCost}
                                onChange={(e) => updateProductUnitCost(product, Number(e.target.value))}
                                className="h-9 bg-white text-right text-sm border-slate-300 focus-visible:ring-sky-500 font-semibold text-slate-900"
                              />
                            </label>

                            {/* Col 5: จำนวน */}
                            <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs font-medium text-slate-500 lg:block">
                              <span className="lg:hidden">จำนวน</span>
                              <Input
                                type="number"
                                min="1"
                                step="1"
                                value={quantity}
                                onChange={(e) => updateProductQuantity(product, Number(e.target.value))}
                                className="h-9 bg-white text-right text-sm border-slate-300 focus-visible:ring-sky-500 font-bold text-sky-600"
                              />
                            </label>

                            {/* Col 6: ส่วนลด */}
                            <div className="grid grid-cols-[84px_1fr] items-center gap-2 lg:block">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">ส่วนลด</span>
                              <div className="grid grid-cols-[1fr_54px] gap-1.5">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={discountValue}
                                  onChange={(e) => updateProductDiscount(product, 'discountValue', Number(e.target.value))}
                                  className="h-9 bg-white text-right text-sm border-slate-300"
                                />
                                <select
                                  value={discountType}
                                  onChange={(e) => updateProductDiscount(product, 'discountType', e.target.value as 'baht' | 'percent')}
                                  className="h-9 rounded-lg border border-slate-300 bg-white px-1.5 text-xs font-medium text-slate-700 outline-none focus:border-sky-500"
                                >
                                  <option value="baht">บาท</option>
                                  <option value="percent">%</option>
                                </select>
                              </div>
                            </div>

                            {/* Col 7: รวมสุทธิ */}
                            <div className="flex items-center justify-between text-base font-bold text-slate-900 lg:block lg:text-right">
                              <span className="text-xs font-medium text-slate-500 lg:hidden">รวม</span>
                              {formatCurrency(rowTotal)}
                            </div>

                            {/* Col 8: ปุ่มลบ */}
                            <div className="text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-400 hover:bg-red-50 hover:text-red-600"
                                onClick={() => removeCartItem(item.productId)}
                                title="ลบรายการนี้"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Summary Bar */}
              <div className="shrink-0 border-t border-slate-200 bg-white p-4 shadow-lg">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                    <Badge className="bg-sky-500 text-white font-bold px-3 py-1 text-sm">
                      เลือกสั่งรวม {cartItems.length} รายการ
                    </Badge>
                    <span>จำนวนชิ้นรวม: <b>{cartItems.reduce((s, i) => s + (i.quantity || 0), 0)}</b> ชิ้น</span>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">ยอดรวมก่อนส่วนลด</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(subtotalBeforeDiscount)}</span>
                    </div>
                    {itemDiscountTotal > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">ส่วนลดรายการ</span>
                        <span className="font-semibold text-red-600">-{formatCurrency(itemDiscountTotal)}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-[1fr_100px_68px] items-center gap-2 text-sm">
                      <span className="text-slate-500">ส่วนลดท้ายบิล</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={billDiscountValue}
                        onChange={(e) => setBillDiscountValue(Math.max(0, Number(e.target.value) || 0))}
                        className="h-9 bg-white text-right text-sm border-slate-300 font-semibold"
                      />
                      <select
                        value={billDiscountType}
                        onChange={(e) => setBillDiscountType(e.target.value as 'baht' | 'percent')}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-500"
                      >
                        <option value="baht">บาท</option>
                        <option value="percent">%</option>
                      </select>
                    </div>

                    {/* VAT Configuration Toggle */}
                    <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">ภาษีมูลค่าเพิ่ม (VAT):</span>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {vatType === 'none' ? 'ไม่คิด VAT (Non-VAT)' : vatType === 'include' ? 'ราคารวม VAT 7% แล้ว' : 'คิด VAT 7% เพิ่มจากยอด'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                        <button
                          type="button"
                          onClick={() => setVatType('none')}
                          className={`py-1.5 px-2 rounded-md font-semibold text-center transition-all ${
                            vatType === 'none'
                              ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                              : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          ไม่มี VAT (0%)
                        </button>
                        <button
                          type="button"
                          onClick={() => setVatType('include')}
                          className={`py-1.5 px-2 rounded-md font-semibold text-center transition-all ${
                            vatType === 'include'
                              ? 'bg-sky-600 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          รวม VAT (7%)
                        </button>
                        <button
                          type="button"
                          onClick={() => setVatType('exclude')}
                          className={`py-1.5 px-2 rounded-md font-semibold text-center transition-all ${
                            vatType === 'exclude'
                              ? 'bg-sky-600 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          แยก VAT (+7%)
                        </button>
                      </div>
                    </div>

                    {vatType === 'include' && (
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>มูลค่าก่อนภาษี</span>
                        <span className="font-medium text-slate-700">{formatCurrency(netBeforeVat)}</span>
                      </div>
                    )}
                    {vatType !== 'none' && (
                      <div className="flex items-center justify-between text-xs text-slate-700">
                        <span>ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
                        <span className="font-bold text-sky-700">
                          {vatType === 'exclude' ? `+${formatCurrency(vatAmount)}` : formatCurrency(vatAmount)}
                        </span>
                      </div>
                    )}

                    <div className="flex items-end justify-between border-t border-slate-200 pt-2">
                      <span className="text-base font-bold text-slate-800">ยอดรวมสุทธิ</span>
                      <span className="text-2xl font-bold text-sky-600">{formatCurrency(cartTotal)}</span>
                    </div>
                    <Button
                      className={`h-12 w-full text-base font-bold text-white shadow-md ${
                        editingPo 
                          ? 'bg-amber-600 hover:bg-amber-700' 
                          : 'bg-sky-500 hover:bg-sky-600'
                      }`}
                      disabled={cartItems.length === 0}
                      onClick={handleCreatePO}
                    >
                      {editingPo ? 'บันทึกการแก้ไขใบสั่งซื้อ (Ctrl + Enter)' : 'สร้างใบสั่งซื้อ (Ctrl + Enter)'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Keyboard Shortcut Hints Bar */}
              <div className="bg-slate-900 text-slate-200 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 shrink-0">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 font-semibold text-amber-400">
                    <Keyboard className="w-4 h-4" /> ทางลัดคีย์บอร์ด:
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">↑ / ↓</kbd> เลื่อนเลือกสินค้า
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Enter</kbd> เพิ่มสินค้าลงตาราง
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl + Enter</kbd> บันทึกใบ PO
                  </span>
                </div>
                <div className="text-slate-400">
                  กด <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Esc</kbd> เพื่อยกเลิก
                </div>
              </div>

              {/* Larger Supplier Catalog Dialog */}
              <Dialog open={isSupplierCatalogOpen} onOpenChange={setIsSupplierCatalogOpen}>
                <DialogContent className="max-h-[92dvh] max-w-[95vw] lg:max-w-6xl xl:max-w-7xl overflow-hidden bg-white p-0 text-slate-900 flex flex-col border-slate-200">
                  <DialogHeader className="border-b border-slate-200 px-6 py-4 flex flex-row items-center justify-between shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
                      <Package className="h-6 w-6 text-sky-500" />
                      รายการสินค้าจากผู้จำหน่าย: <span className="text-sky-600">{selectedSupplier?.name}</span>
                    </DialogTitle>
                  </DialogHeader>

                  <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
                    <div className="relative max-w-md">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <Input
                        placeholder="ค้นหาชื่อ หรือ SKU สินค้า..."
                        className="pl-9 bg-white border-slate-300 h-10 text-sm"
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-6">
                    <div className="hidden grid-cols-[48px_minmax(0,1.8fr)_110px_120px_130px_140px] items-center gap-4 rounded-t-xl border border-slate-200 bg-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
                      <div className="text-center">ลำดับ</div>
                      <div>สินค้า</div>
                      <div className="text-right">คงเหลือ</div>
                      <div className="text-right">ต้นทุน/หน่วย</div>
                      <div className="text-center">สถานะสั่งซื้อ</div>
                      <div className="text-right">จัดการ</div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200 lg:rounded-t-none lg:border-t-0 bg-white">
                      {filteredCatalogProducts.length === 0 ? (
                        <div className="flex min-h-64 flex-col items-center justify-center text-center text-slate-500 space-y-2 p-6">
                          <PackageOpen className="h-12 w-12 text-slate-300" />
                          <p className="font-bold text-base text-slate-800">ไม่พบสินค้าที่ผูกกับผู้จำหน่าย "{selectedSupplier?.name}"</p>
                          <p className="text-xs text-slate-400 max-w-md">
                            คำแนะนำ: ท่านสามารถผูกผู้จำหน่ายกับสินค้าได้ใน <b>หน้ารายละเอียดสินค้า (การจัดการสินค้า)</b> โดยระบุผู้จำหน่ายในช่องบาร์โค้ดหรือต้นทุนสินค้า
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {filteredCatalogProducts.map((product: any, idx: number) => {
                            const units = getProductUnits(product);
                            return (
                              <div
                                key={product.id}
                                className="grid grid-cols-1 gap-3 px-4 py-3.5 hover:bg-sky-50/40 transition-colors lg:grid-cols-[48px_minmax(0,1.8fr)_110px_120px_auto] lg:items-center"
                              >
                                <div className="hidden lg:block text-center font-semibold text-slate-400 text-sm">
                                  {idx + 1}
                                </div>

                                <div className="min-w-0">
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={(e) => openImagePreview(product, e)}
                                      className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400 hover:text-sky-600 hover:border-sky-300 transition-colors shadow-sm"
                                      title="กดเพื่อดูรูปสินค้า"
                                    >
                                      <ImageIcon className="w-5 h-5" />
                                    </button>
                                    <div className="min-w-0">
                                      <div className="truncate text-base font-semibold text-slate-900">{product.name}</div>
                                      <div className="truncate text-xs text-slate-500 font-mono">{product.sku}</div>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between text-sm font-semibold text-slate-700 lg:block lg:text-right">
                                  <span className="text-xs font-medium text-slate-500 lg:hidden">คงเหลือ</span>
                                  {Number(product.stock ?? 0) < 0 ? (
                                    <span className="inline-flex items-center gap-1 font-extrabold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                      🔻 {product.stock} {product.unit || 'ชิ้น'}
                                    </span>
                                  ) : (
                                    <span>{product.stock ?? '-'} {product.unit || 'ชิ้น'}</span>
                                  )}
                                </div>

                                <div className="flex items-center justify-between text-sm font-bold text-slate-900 lg:block lg:text-right">
                                  <span className="text-xs font-medium text-slate-500 lg:hidden">ต้นทุน</span>
                                  {formatCurrency(product.unitCost || product.basePrice || 0)}
                                </div>

                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  {units.map((u, ui) => {
                                    const existing = cartItems.find(i => i.productId === product.id && (i.unitName === u.name || (!i.unitName && u.name === (product.unit || 'ชิ้น'))));
                                    return (
                                      <Button
                                        key={ui}
                                        size="sm"
                                        className={`h-8 text-xs font-semibold px-2.5 ${
                                          existing
                                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                            : "bg-sky-500 text-white hover:bg-sky-600 shadow-xs"
                                        }`}
                                        onClick={() => addCartItemWithUnit(product, u.name, u.mult, 1)}
                                      >
                                        +1 {u.name} {u.mult > 1 ? `(×${u.mult})` : ''} {existing ? `[สั่งแล้ว ${existing.quantity}]` : ''}
                                      </Button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <DialogFooter className="border-t border-slate-200 px-6 py-4 bg-slate-50 shrink-0">
                    <Button onClick={() => setIsSupplierCatalogOpen(false)} className="bg-slate-900 text-white hover:bg-slate-800">
                      ปิดหน้าต่าง (Esc)
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        )}

        {/* Product Image Preview Modal */}
        <Dialog open={previewProduct !== null} onOpenChange={(open) => { if (!open) setPreviewProduct(null); }}>
          <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md p-6">
            <DialogHeader className="mb-2">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <ImageIcon className="w-5 h-5 text-primary" />
                รูปภาพสินค้า: <span className="text-sky-600">{previewProduct?.name}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              {previewImages.length > 0 ? (
                <div className="space-y-3">
                  <div className="aspect-square rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-50 flex items-center justify-center shadow-inner">
                    <img src={previewImages[selectedImageIdx] || previewImages[0]} alt={previewProduct?.name} className="w-full h-full object-cover" />
                  </div>
                  {previewImages.length > 1 && (
                    <div className="flex gap-2 justify-center">
                      {previewImages.map((img, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedImageIdx(idx)}
                          className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${selectedImageIdx === idx ? "border-primary ring-2 ring-primary/20" : "border-slate-200 opacity-60 hover:opacity-100"}`}
                        >
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-56 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Package className="w-12 h-12 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">ไม่มีรูปภาพสินค้าสำหรับรายการนี้</p>
                  <p className="text-xs text-slate-400">สามารถเพิ่มรูปได้ในหน้าแก้ไขสินค้า</p>
                </div>
              )}

              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                <span>รหัส SKU: <b className="font-mono text-slate-700">{previewProduct?.sku}</b></span>
                <span>คงเหลือ: <b className="text-slate-900">{previewProduct?.stock ?? '-'}</b></span>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setPreviewProduct(null)} className="w-full border-slate-300">
                ปิดหน้าต่าง (Esc)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
          <Tabs defaultValue="ALL" onValueChange={setStatusFilter}>
            <TabsList className="bg-slate-100 border border-slate-200">
              <TabsTrigger value="ALL" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">ทั้งหมด ({purchaseOrders.length})</TabsTrigger>
              <TabsTrigger value="DRAFT" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                DRAFT ({purchaseOrders.filter(p => p.status === 'DRAFT').length})
              </TabsTrigger>
              <TabsTrigger value="ISSUED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                ISSUED ({purchaseOrders.filter(p => p.status === 'ISSUED').length})
              </TabsTrigger>
              <TabsTrigger value="PARTIALLY_RECEIVED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                PARTIAL ({purchaseOrders.filter(p => p.status === 'PARTIALLY_RECEIVED').length})
              </TabsTrigger>
              <TabsTrigger value="COMPLETED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                COMPLETED ({purchaseOrders.filter(p => p.status === 'COMPLETED').length})
              </TabsTrigger>
              <TabsTrigger value="CANCELLED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                CANCELLED ({purchaseOrders.filter(p => p.status === 'CANCELLED').length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="text-slate-500 font-bold">เลข PO</TableHead>
                <TableHead className="text-slate-500 font-bold">ผู้จำหน่าย</TableHead>
                <TableHead className="text-slate-500 font-bold">วันที่สร้าง</TableHead>
                <TableHead className="text-slate-500 font-bold text-right">ยอดรวมสุทธิ</TableHead>
                <TableHead className="text-slate-500 font-bold text-center">สถานะ</TableHead>
                <TableHead className="text-slate-500 font-bold text-center">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-slate-500">
                    กำลังโหลดข้อมูล...
                  </TableCell>
                </TableRow>
              ) : filteredPOs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-slate-500">
                    ไม่พบข้อมูลใบสั่งซื้อ
                  </TableCell>
                </TableRow>
              ) : (
                filteredPOs.map((po) => (
                  <TableRow key={po.id} className="border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => handleViewDetail(po.id)}>
                    <TableCell className="font-bold text-slate-900">{po.poNumber}</TableCell>
                    <TableCell className="text-slate-700 font-medium">{po.supplier?.name || po.supplierName || "-"}</TableCell>
                    <TableCell className="text-slate-600">{formatDate(po.createdAt)}</TableCell>
                    <TableCell className="text-right text-slate-900 font-bold">
                      <div>{formatCurrency(po.totalAmount)}</div>
                      {po.deductedReturns && po.deductedReturns.length > 0 && (
                        <div className="text-[10.5px] text-emerald-700 font-normal mt-0.5">
                          <span className="bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded font-bold">
                            หักเคลม -{formatCurrency(po.deductedReturns.reduce((s: number, r: any) => s + Number(r.amount || 0), 0))}
                          </span>
                          <span className="font-black block text-slate-900 font-mono mt-0.5">
                            จ่ายจริง {formatCurrency(po.netAmountPayable ?? (po.totalAmount - po.deductedReturns.reduce((s: number, r: any) => s + Number(r.amount || 0), 0)))}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{getStatusBadge(po.status)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex gap-1.5 justify-center items-center">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-500 hover:text-sky-600 hover:bg-sky-50" 
                          title="ดู/พิมพ์ใบสั่งซื้อ PDF" 
                          onClick={(e) => { e.stopPropagation(); handleViewDetail(po.id); }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {po.status === 'DRAFT' && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50" 
                            title="แก้ไขใบสั่งซื้อ" 
                            onClick={(e) => openEditDialog(po, e)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {po.status === 'DRAFT' && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50" 
                            title="ออกใบสั่งซื้อ (Issue)" 
                            onClick={(e) => openIssueConfirmDialog(po, e)}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                        )}
                        {(po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED') && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50" 
                            title="รับสินค้าเข้าคลัง (GRN)" 
                            onClick={(e) => openReceiveDialog(po, e)}
                          >
                            <PackageOpen className="w-4 h-4" />
                          </Button>
                        )}
                        {/* Status Change / Rollback Action Button */}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50" 
                          title="เปลี่ยน / ย้อนสถานะใบสั่งซื้อ" 
                          onClick={(e) => openStatusChangeDialog(po, e)}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                        {po.status !== 'CANCELLED' && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-slate-500 hover:text-rose-600 hover:bg-rose-50" 
                            title="ยกเลิกใบสั่งซื้อ" 
                            onClick={(e) => openCancelDialog(po, e)}
                          >
                            <Ban className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Receive Dialog (GRN) */}
      <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[85vw] lg:w-[75vw] max-w-[75vw] h-[88vh] max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-8 py-5 bg-slate-50/80 shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <DialogTitle className="text-2xl font-bold flex items-center gap-2.5 text-slate-900">
                <PackageOpen className="w-7 h-7 text-amber-500" />
                ตรวจนับและรับสินค้าเข้าคลัง (PO: {currentPo?.poNumber})
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setReceiveItems(prev => prev.map(i => ({ ...i, toReceive: i.remainingQty })))}
                  className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-semibold h-8"
                >
                  ✓ รับครบทั้งหมด
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setReceiveItems(prev => prev.map(i => ({ ...i, toReceive: 0 })))}
                  className="text-xs border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold h-8"
                >
                  ล้างเป็น 0
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-8 py-6 pb-8 space-y-5">
            <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">ขั้นตอนการตรวจรับสินค้า (GRN):</span> ตรวจสอบจำนวนสินค้าจริงที่มาส่ง หากจำนวนไม่ตรงกับใบสั่งซื้อ สามารถปรับแก้ตัวเลขในช่อง <b>"รับเพิ่มครั้งนี้"</b> ได้ทันที เมื่อกดยืนยันระบบจะนำจำนวนที่ได้รับจริงไป <b>เพิ่มสต็อกสินค้าในคลังให้อัตโนมัติ</b>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="border-slate-200">
                    <TableHead className="w-10 text-center text-slate-500 font-bold">#</TableHead>
                    <TableHead className="text-slate-500 font-bold min-w-[200px]">สินค้า</TableHead>
                    <TableHead className="text-center text-slate-500 font-bold">หน่วย</TableHead>
                    <TableHead className="text-center text-slate-500 font-bold">สั่งซื้อ</TableHead>
                    <TableHead className="text-center text-slate-500 font-bold">รับแล้ว</TableHead>
                    <TableHead className="text-center text-slate-500 font-bold">ค้างรับ</TableHead>
                    <TableHead className="text-right text-slate-500 font-bold w-32">รับเพิ่มครั้งนี้</TableHead>
                    <TableHead className="text-right text-slate-500 font-bold min-w-[130px]">สต็อกในคลัง</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receiveItems.map((item, idx) => {
                    const toRec = Number(item.toReceive) || 0;
                    const mult = Number(item.multiplier) || 1;
                    const stockDelta = toRec * mult;
                    const currentStock = Number(item.currentStock || 0);
                    const newStock = currentStock + stockDelta;

                    return (
                      <TableRow key={idx} className="border-slate-100 hover:bg-slate-50/70">
                        <TableCell className="text-center text-slate-400 font-semibold text-xs">{idx + 1}</TableCell>
                        <TableCell className="text-slate-900 font-bold">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={(e) => openImagePreview(item, e)}
                              className="w-8 h-8 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-sky-600 shrink-0 shadow-2xs"
                              title="ดูรูปภาพสินค้า"
                            >
                              <ImageIcon className="w-4 h-4" />
                            </button>
                            <div className="min-w-0">
                              <div className="truncate text-sm">{item.name}</div>
                              <div className="text-xs text-slate-400 font-mono font-normal">{item.sku}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-xs font-semibold">
                            {item.unitName} {mult > 1 ? `(×${mult})` : ''}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center text-slate-700 font-semibold">{item.orderedQty}</TableCell>
                        <TableCell className="text-center text-emerald-600 font-bold">{item.receivedQty}</TableCell>
                        <TableCell className="text-center text-amber-700 font-bold">{item.remainingQty}</TableCell>
                        <TableCell className="text-right">
                          <Input 
                            type="number" 
                            min="0"
                            value={item.toReceive}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value) || 0);
                              const newItems = [...receiveItems];
                              newItems[idx].toReceive = val;
                              setReceiveItems(newItems);
                            }}
                            className="bg-white border-slate-300 h-9 text-right font-bold text-sky-600 focus-visible:ring-sky-500 w-full"
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <div className="flex flex-col items-end">
                            <span className="font-semibold text-slate-800">
                              {currentStock} → <b className="text-emerald-600 font-bold">{newStock}</b>
                            </span>
                            {stockDelta > 0 && (
                              <span className="text-[11px] font-bold text-emerald-600">
                                (+{stockDelta} ชิ้น)
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Status Preview Card */}
            {(() => {
              const isAllReceived = receiveItems.every((i) => ((i.receivedQty || 0) + (Number(i.toReceive) || 0)) >= i.orderedQty);
              const totalItemsReceiving = receiveItems.filter(i => Number(i.toReceive) > 0).length;
              const totalUnitsReceiving = receiveItems.reduce((s, i) => s + (Number(i.toReceive) || 0) * (Number(i.multiplier) || 1), 0);

              return (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="text-xs text-slate-600">
                      รายการที่จะรับเข้าครั้งนี้: <b className="text-slate-900">{totalItemsReceiving} รายการ</b> (เพิ่มเข้าสต็อกรวม <b className="text-emerald-600 font-bold">{totalUnitsReceiving} ชิ้น</b>)
                    </div>
                    <div>
                      {isAllReceived ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs font-bold px-2.5 py-1">
                          สถานะ PO จะเปลี่ยนเป็น: COMPLETED (รับครบถ้วน)
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold px-2.5 py-1">
                          สถานะ PO จะเปลี่ยนเป็น: PARTIALLY_RECEIVED (รับบางส่วน)
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <DialogFooter className="border-t border-slate-200 px-8 py-4.5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
            <Button variant="ghost" onClick={() => setIsReceiveOpen(false)} className="text-slate-600 hover:bg-slate-200/60 font-semibold">
              ยกเลิก
            </Button>
            <Button onClick={handleTriggerReceivePO} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-7 h-11 shadow-sm text-sm">
              <PackageOpen className="w-4 h-4 mr-2" /> ยืนยันรับสินค้าและปรับสต็อกเข้าคลัง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-4 text-xl font-bold text-slate-900">
              <span>รายละเอียดใบสั่งซื้อ {currentPo?.poNumber}</span>
              {currentPo && getStatusBadge(currentPo.status)}
            </DialogTitle>
          </DialogHeader>
          {currentPo && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500 block mb-1">ผู้จำหน่าย</span>
                  <span className="font-bold text-slate-900 text-base">{currentPo.supplier?.name || currentPo.supplierName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">วันที่สร้าง</span>
                  <span className="font-bold text-slate-900 text-base">{formatDate(currentPo.createdAt)}</span>
                </div>
              </div>
              
              <div>
                <h4 className="font-bold text-slate-900 mb-3 border-b border-slate-200 pb-2">รายการสินค้าสั่งซื้อ</h4>
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow className="border-slate-200">
                      <TableHead className="w-12 text-center text-slate-500 font-bold">ลำดับ</TableHead>
                      <TableHead className="text-slate-500 font-bold">สินค้า</TableHead>
                      <TableHead className="text-right text-slate-500 font-bold">สั่ง (ชิ้น)</TableHead>
                      <TableHead className="text-right text-slate-500 font-bold">รับแล้ว (ชิ้น)</TableHead>
                      <TableHead className="text-right text-slate-500 font-bold">ต้นทุน/หน่วย</TableHead>
                      <TableHead className="text-right text-slate-500 font-bold">รวมสุทธิ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentPo.items?.map((item: any, idx: number) => (
                      <TableRow key={idx} className="border-slate-100 hover:bg-slate-50">
                        <TableCell className="text-center text-slate-400 font-semibold">{idx + 1}</TableCell>
                        <TableCell className="text-slate-900 font-bold flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => openImagePreview(item, e)}
                            className="w-7 h-7 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-sky-600 shrink-0"
                            title="ดูรูปภาพสินค้า"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                          </button>
                          <span>{item.name || item.product?.name}</span>
                        </TableCell>
                        <TableCell className="text-right text-slate-700 font-semibold">{item.quantity}</TableCell>
                        <TableCell className="text-right text-emerald-600 font-bold">{item.receivedQuantity || 0}</TableCell>
                        <TableCell className="text-right text-slate-600">{formatCurrency(item.unitCost)}</TableCell>
                        <TableCell className="text-right text-slate-900 font-bold">{formatCurrency(item.quantity * item.unitCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-right mt-4 pt-4 border-t border-slate-200 flex justify-end">
                  <div className="w-80 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-left">
                    <div className="flex justify-between text-xs text-slate-600 font-medium">
                      <span>ยอดรวมบิลสั่งซื้อ:</span>
                      <span className="font-mono font-bold text-slate-800">{formatCurrency(currentPo.totalAmount)}</span>
                    </div>

                    {/* Deducted Returns Breakdown if any */}
                    {currentPo.deductedReturns && currentPo.deductedReturns.length > 0 && (
                      <div className="border-t border-slate-200 pt-1.5 space-y-1">
                        <span className="text-[11px] font-bold text-rose-700 block">หักลดหนี้สินค้าเคลมคืนบริษัท:</span>
                        {currentPo.deductedReturns.map((r: any, rIdx: number) => (
                          <div key={rIdx} className="flex justify-between text-xs text-rose-600 font-medium">
                            <span className="font-mono text-[11px]">-{r.returnNumber || r.returnNoteId}</span>
                            <span className="font-mono font-bold">-{formatCurrency(r.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="border-t border-slate-200 pt-2 flex justify-between font-black text-lg text-slate-900">
                      <span>ยอดชำระสุทธิ:</span>
                      <span className="text-emerald-700 font-mono font-black">
                        {formatCurrency(
                          Math.max(
                            0,
                            Number(currentPo.totalAmount || 0) -
                              (currentPo.deductedReturns || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0)
                          )
                        )}
                      </span>
                    </div>

                    {/* Button to deduct return note */}
                    {currentPo.status !== 'CANCELLED' && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setTargetPoForDeduct(currentPo);
                          setIsDeductReturnModalOpen(true);
                        }}
                        className="mt-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 rounded-xl shadow-xs gap-1.5"
                        title="นำใบลดหนี้สินค้าเคลม (RTN) มาหักลบกับบิลนี้"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>หักลบใบลดหนี้สินค้าเคลม</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex justify-between items-center w-full sm:justify-between border-t border-slate-100 pt-4">
             <div className="flex gap-2 flex-wrap items-center">
                {currentPo?.status === 'DRAFT' && (
                  <Button variant="outline" className="border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-bold" onClick={(e) => openIssueConfirmDialog(currentPo, e)}>
                    <CheckCircle className="w-4 h-4 mr-2" /> ออกใบสั่งซื้อ (Issue)
                  </Button>
                )}
                {(currentPo?.status === 'ISSUED' || currentPo?.status === 'PARTIALLY_RECEIVED') && (
                  <Button variant="outline" className="border-indigo-500 text-indigo-600 hover:bg-indigo-50 font-bold" onClick={(e) => { setIsDetailOpen(false); openReceiveDialog(currentPo, e); }}>
                    <PackageOpen className="w-4 h-4 mr-2" /> รับสินค้า (GRN)
                  </Button>
                )}
                {currentPo?.status === 'DRAFT' && (
                  <Button variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-50 font-bold" onClick={() => openEditDialog(currentPo)}>
                    <Pencil className="w-4 h-4 mr-2" /> แก้ไขใบสั่งซื้อ
                  </Button>
                )}
                {/* Status Change / Rollback Button in Detail Modal */}
                <Button variant="outline" className="border-indigo-400 text-indigo-700 hover:bg-indigo-50 font-bold" onClick={(e) => { setIsDetailOpen(false); openStatusChangeDialog(currentPo, e); }}>
                  <RotateCcw className="w-4 h-4 mr-2" /> เปลี่ยน / ย้อนสถานะ
                </Button>
                {currentPo?.status !== 'CANCELLED' && (
                  <Button variant="outline" className="border-rose-300 text-rose-600 hover:bg-rose-50 font-bold" onClick={() => { setIsDetailOpen(false); openCancelDialog(currentPo); }}>
                    <Ban className="w-4 h-4 mr-2" /> ยกเลิกใบสั่งซื้อ
                  </Button>
                )}
             </div>
             <Button variant="ghost" onClick={() => setIsDetailOpen(false)} className="text-slate-500 hover:text-slate-900 hover:bg-slate-100">ปิดหน้าต่าง</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue PO Confirmation Dialog */}
      <Dialog open={isIssueModalOpen} onOpenChange={setIsIssueModalOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-emerald-600">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              ยืนยันการออกใบสั่งซื้อ (Issue PO)
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-4 text-sm">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 space-y-2">
              <div className="font-bold text-sm text-emerald-800 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> ใบสั่งซื้อ: {targetIssuePo?.poNumber}
              </div>
              <div className="text-slate-600">
                ผู้จำหน่าย: <b>{targetIssuePo?.supplier?.name || targetIssuePo?.supplierName || '-'}</b>
              </div>
              <div className="text-slate-600">
                ยอดรวมทั้งสิ้น: <b className="text-emerald-700 font-bold text-sm">{formatCurrency(targetIssuePo?.totalAmount || 0)}</b>
              </div>
            </div>
            <p className="text-xs text-slate-600">
              เมื่อออกใบสั่งซื้อแล้ว สถานะจะเปลี่ยนจาก <b>DRAFT</b> เป็น <b>ISSUED</b> เพื่อเตรียมพร้อมส่งเอกสารให้ผู้จำหน่ายและตรวจรับสินค้าเข้าคลัง
            </p>
          </div>
          <DialogFooter className="flex justify-between items-center gap-2 border-t border-slate-100 pt-3">
            <Button variant="ghost" onClick={() => setIsIssueModalOpen(false)} className="text-slate-600 hover:bg-slate-100">
              ยกเลิก
            </Button>
            <Button
              onClick={handleConfirmIssue}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5"
            >
              <CheckCircle className="w-4 h-4 mr-1.5" /> ยืนยันออกใบสั่งซื้อ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change / Rollback Status Modal */}
      <Dialog open={isStatusChangeModalOpen} onOpenChange={setIsStatusChangeModalOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[580px] max-w-[580px] max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-8 py-5 bg-slate-50/80 shrink-0">
            <DialogTitle className="flex items-center gap-2.5 text-xl font-bold text-indigo-700">
              <RotateCcw className="w-6 h-6 text-indigo-600" />
              เปลี่ยน / ย้อนสถานะใบสั่งซื้อ ({targetStatusChangePo?.poNumber})
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-8 pt-6 pb-12 space-y-6">
            <div className="flex items-center justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
              <span className="text-slate-500 font-semibold">สถานะปัจจุบันของเอกสาร:</span>
              <span>{targetStatusChangePo && getStatusBadge(targetStatusChangePo.status)}</span>
            </div>

            <div className="space-y-2.5">
              <label className="text-xs font-bold text-slate-700 block">เลือกสถานะใหม่ที่ต้องการเปลี่ยน / ย้อนกลับ:</label>
              <div className="space-y-2.5 text-xs">
                {[
                  {
                    value: 'DRAFT',
                    label: 'DRAFT (ฉบับร่าง)',
                    desc: 'ดึงกลับมาเป็นฉบับร่างเพื่อแก้ไขรายการสินค้าและราคาใหม่',
                    color: 'text-slate-700',
                  },
                  {
                    value: 'ISSUED',
                    label: 'ISSUED (ออกเอกสารแล้ว)',
                    desc: 'ส่งเอกสารให้ผู้จำหน่ายแล้ว อยู่ในขั้นตอนรอรับสินค้า',
                    color: 'text-sky-700',
                  },
                  {
                    value: 'PARTIALLY_RECEIVED',
                    label: 'PARTIALLY_RECEIVED (รับบางส่วน)',
                    desc: 'สินค้ามาส่งแล้วบางรายการ/บางจำนวน ยังรับไม่ครบ',
                    color: 'text-amber-700',
                  },
                  {
                    value: 'COMPLETED',
                    label: 'COMPLETED (รับครบถ้วนสมบูรณ์)',
                    desc: 'สินค้าตรวจรับครบทุกรายการแล้ว และเสร็จสิ้นกระบวนการสั่งซื้อ',
                    color: 'text-emerald-700',
                  },
                  {
                    value: 'CANCELLED',
                    label: 'CANCELLED (ยกเลิกเอกสาร)',
                    desc: 'ยกเลิกใบสั่งซื้อนี้ ไม่สามารถรับของเข้าคลังได้',
                    color: 'text-rose-700',
                  },
                ].map((st) => (
                  <label
                    key={st.value}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                      newSelectedStatus === st.value
                        ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-400 shadow-2xs'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="newSelectedStatus"
                      value={st.value}
                      checked={newSelectedStatus === st.value}
                      onChange={() => setNewSelectedStatus(st.value)}
                      className="accent-indigo-600 mt-0.5"
                    />
                    <div className="flex-1">
                      <div className={`font-bold ${st.color}`}>{st.label}</div>
                      <div className="text-slate-500 text-[11px] mt-0.5">{st.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Rollback Stock Option Warning */}
            {((targetStatusChangePo?.status === 'COMPLETED' || targetStatusChangePo?.status === 'PARTIALLY_RECEIVED') &&
              (newSelectedStatus === 'DRAFT' || newSelectedStatus === 'ISSUED' || newSelectedStatus === 'CANCELLED')) && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-xs space-y-2.5">
                <div className="font-bold text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  ตรวจพบการย้อนสถานะจากขั้นตอนที่เคยรับของเข้าคลัง
                </div>
                <p className="text-amber-800 leading-relaxed">
                  ใบสั่งซื้อนี้เคยมีการรับสินค้าเข้าสต็อกแล้ว หากย้อนสถานะกลับเป็น <b>{newSelectedStatus}</b> ท่านต้องการให้ระบบปรับสต็อกสินค้าคืนหรือไม่?
                </p>
                <label className="flex items-center gap-2.5 pt-1 font-bold text-amber-950 cursor-pointer bg-white p-3 rounded-lg border border-amber-200 shadow-2xs">
                  <input
                    type="checkbox"
                    checked={rollbackStock}
                    onChange={(e) => setRollbackStock(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600"
                  />
                  <span>✓ ปรับลดสต็อกสินค้าในคลังคืนอัตโนมัติ (หักจำนวนที่เคยรับเข้าออกจากคลัง)</span>
                </label>
              </div>
            )}

            <div className="space-y-2 pb-6">
              <label className="text-xs font-bold text-slate-700 block">หมายเหตุ / เหตุผลในการเปลี่ยนสถานะ (ถ้ามี):</label>
              <Input
                placeholder="เช่น ตรวจนับสต็อกใหม่, ผู้จำหน่ายส่งของไม่ถูกต้อง, ลูกค้าเปลี่ยนใจ..."
                value={statusChangeNote}
                onChange={(e) => setStatusChangeNote(e.target.value)}
                className="text-xs bg-white border-slate-300 h-10"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 px-8 py-5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
            <Button variant="ghost" onClick={() => setIsStatusChangeModalOpen(false)} className="text-slate-600 hover:bg-slate-200/60 font-semibold">
              ยกเลิก
            </Button>
            <Button
              onClick={handleConfirmStatusChange}
              disabled={newSelectedStatus === targetStatusChangePo?.status}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-7 h-11 shadow-sm text-sm"
            >
              <ArrowLeftRight className="w-4 h-4 mr-2" /> ยืนยันการเปลี่ยนสถานะ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel PO Confirmation Dialog */}
      <Dialog open={isCancelModalOpen} onOpenChange={setIsCancelModalOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-rose-600">
              <Ban className="w-5 h-5 text-rose-600" />
              ยกเลิกใบสั่งซื้อ {targetCancelPo?.poNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-4">
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-800 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-rose-900">
                <AlertTriangle className="w-4 h-4 text-rose-600" /> คำเตือนการยกเลิกเอกสาร
              </div>
              <p>เมื่อยกเลิกแล้ว สถานะเอกสารจะเปลี่ยนเป็น <b>CANCELLED</b> และไม่สามารถนำไปรับสินค้าเข้าคลังได้อีก</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">ระบุเหตุผลการยกเลิก:</label>
              <div className="space-y-2 text-xs">
                {[
                  'ผู้จำหน่ายแจ้งสินค้าหมด/ยกเลิก',
                  'สั่งซื้อซ้ำซ้อน / สั่งผิดรายการ',
                  'เปลี่ยนผู้จำหน่ายรายอื่น',
                  'ทางร้านขอยกเลิกรายการสั่งซื้อ',
                ].map((reason) => (
                  <label key={reason} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="cancelReason"
                      value={reason}
                      checked={cancelReason === reason}
                      onChange={() => setCancelReason(reason)}
                      className="accent-rose-600"
                    />
                    <span className="text-slate-800 font-medium">{reason}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="radio"
                    name="cancelReason"
                    value="other"
                    checked={cancelReason === 'other'}
                    onChange={() => setCancelReason('other')}
                    className="accent-rose-600"
                  />
                  <span className="text-slate-800 font-medium">ระบุเหตุผลอื่นๆ</span>
                </label>
              </div>

              {cancelReason === 'other' && (
                <Input
                  placeholder="พิมพ์เหตุผลการยกเลิก..."
                  value={cancelCustomReason}
                  onChange={(e) => setCancelCustomReason(e.target.value)}
                  className="mt-2 text-xs bg-slate-50 border-slate-300"
                  autoFocus
                />
              )}
            </div>
          </div>
          <DialogFooter className="flex justify-between items-center gap-2 border-t border-slate-100 pt-3">
            <Button variant="ghost" onClick={() => setIsCancelModalOpen(false)} className="text-slate-600 hover:bg-slate-100">
              ย้อนกลับ
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmCancelPO}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
            >
              <Ban className="w-4 h-4 mr-1.5" /> ยืนยันยกเลิกใบสั่งซื้อ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Under-Receive / Shortfall Confirmation Modal */}
      <Dialog open={isUnderReceiveModalOpen} onOpenChange={setIsUnderReceiveModalOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-[620px] max-w-[620px] max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-8 py-5 bg-amber-50/70 shrink-0">
            <DialogTitle className="flex items-center gap-2.5 text-xl font-bold text-amber-900">
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
              ตรวจพบการรับสินค้าไม่ครบตามใบสั่งซื้อ
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-8 pt-6 pb-10 space-y-5">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 space-y-2.5">
              <div className="font-bold text-slate-900 text-sm flex items-center justify-between">
                <span>ใบสั่งซื้อ: {currentPo?.poNumber}</span>
                <span className="text-slate-500 font-normal">ผู้จำหน่าย: {currentPo?.supplier?.name || currentPo?.supplierName}</span>
              </div>
              <p className="text-slate-600">
                รายการสินค้าด้านล่างนี้ มียอดรับจริงน้อยกว่าจำนวนที่ระบุในใบสั่งซื้อ:
              </p>
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-white max-h-40 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr>
                      <th className="p-2.5">สินค้า</th>
                      <th className="p-2.5 text-center">สั่งซื้อ</th>
                      <th className="p-2.5 text-center">รับรวมครั้งนี้</th>
                      <th className="p-2.5 text-right text-rose-600">ค้างรับ/ขาด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receiveItems
                      .filter(i => ((Number(i.receivedQty) || 0) + (Number(i.toReceive) || 0)) < Number(i.orderedQty))
                      .map((item, idx) => {
                        const totalRec = (Number(item.receivedQty) || 0) + (Number(item.toReceive) || 0);
                        const diff = Number(item.orderedQty) - totalRec;
                        return (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-2.5 font-medium text-slate-900">{item.name}</td>
                            <td className="p-2.5 text-center font-bold text-slate-700">{item.orderedQty} {item.unitName}</td>
                            <td className="p-2.5 text-center font-bold text-emerald-700">{totalRec} {item.unitName}</td>
                            <td className="p-2.5 text-right font-bold text-rose-600">-{diff} {item.unitName}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-900 block">
                โปรดเลือกวิธีจัดการเอกสารใบสั่งซื้อ (PO):
              </label>

              <div className="space-y-3">
                {/* Option 1: Adjust PO & Complete */}
                <label
                  onClick={() => setUnderReceiveAction('ADJUST_AND_COMPLETE')}
                  className={`flex items-start gap-3.5 p-4 rounded-xl border transition-all cursor-pointer ${
                    underReceiveAction === 'ADJUST_AND_COMPLETE'
                      ? 'border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-400/40 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="underReceiveAction"
                    value="ADJUST_AND_COMPLETE"
                    checked={underReceiveAction === 'ADJUST_AND_COMPLETE'}
                    onChange={() => setUnderReceiveAction('ADJUST_AND_COMPLETE')}
                    className="accent-emerald-600 mt-1 h-4 w-4"
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-emerald-900 text-sm">
                        ปรับยอดในใบ PO ให้เท่ากับจำนวนที่รับจริง & ปิดเอกสารสมบูรณ์ (COMPLETED)
                      </span>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full border border-emerald-300">
                        แนะนำ
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800 leading-relaxed">
                      เหมาะสำหรับกรณีที่<b>สินค้ามาส่งแค่นี้และจะไม่มีการส่งเพิ่มอีกแล้ว</b> ระบบจะปรับลดจำนวนสินค้าและคำนวณยอดเงินรวม (Subtotal, VAT, ยอดสุทธิ) ในเอกสาร PO ใหม่โดยอัตโนมัติตามยอดรับจริง <b>เพื่อความถูกต้องในการนำไปจ่ายเงิน/ตัดยอดบัญชี</b>
                    </p>
                  </div>
                </label>

                {/* Option 2: Partial & Wait for remaining */}
                <label
                  onClick={() => setUnderReceiveAction('PARTIAL')}
                  className={`flex items-start gap-3.5 p-4 rounded-xl border transition-all cursor-pointer ${
                    underReceiveAction === 'PARTIAL'
                      ? 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-400/40 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="underReceiveAction"
                    value="PARTIAL"
                    checked={underReceiveAction === 'PARTIAL'}
                    onChange={() => setUnderReceiveAction('PARTIAL')}
                    className="accent-amber-600 mt-1 h-4 w-4"
                  />
                  <div className="flex-1 space-y-1">
                    <div className="font-bold text-amber-900 text-sm">
                      บันทึกเป็นรับบางส่วน (PARTIALLY_RECEIVED) & รอรับสินค้าส่วนที่เหลือ
                    </div>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      เหมาะสำหรับกรณีที่<b>ผู้จำหน่ายจะนำสินค้าที่ค้างส่งมาส่งเพิ่มในภายหลัง</b> ระบบจะคงยอดจำนวนสั่งซื้อเดิมไว้ และสามารถกลับมาตรวจรับสินค้าส่วนที่เหลือในครั้งต่อไปได้
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 px-8 py-5 bg-slate-50 shrink-0 flex justify-between items-center w-full">
            <Button
              variant="ghost"
              onClick={() => setIsUnderReceiveModalOpen(false)}
              className="text-slate-600 hover:bg-slate-200/60 font-semibold"
            >
              ย้อนกลับไปแก้ไขจำนวน
            </Button>
            <Button
              onClick={() => executeReceivePO(underReceiveAction === 'ADJUST_AND_COMPLETE')}
              className={`text-white font-bold px-7 h-11 shadow-sm text-sm ${
                underReceiveAction === 'ADJUST_AND_COMPLETE'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {underReceiveAction === 'ADJUST_AND_COMPLETE'
                ? 'ยืนยันปรับยอด PO และปิดเอกสาร'
                : 'ยืนยันบันทึกรับบางส่วน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Professional Purchase Order PDF / Print Modal */}
      <PurchaseOrderPdfModal
        open={isPdfModalOpen}
        onOpenChange={setIsPdfModalOpen}
        po={pdfPoData}
      />

      {/* Supplier Return Note Deduction Modal */}
      <DeductReturnNoteModal
        open={isDeductReturnModalOpen}
        onOpenChange={setIsDeductReturnModalOpen}
        po={targetPoForDeduct}
        onSuccess={(updatedPo) => {
          setCurrentPo(updatedPo);
          fetchPOs();
        }}
      />
    </div>
  );
}
