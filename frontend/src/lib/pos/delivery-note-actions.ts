'use client';

/**
 * บิลส่งของ entry points of the POS (docs/pos-member-picker.md): a held bill, the current cart (Shift+F8 / the cart
 * button) and a held online order. Each opens the preview dialog (components/pos/DeliveryNoteView.tsx); nothing here
 * sells, moves stock, takes a document number or changes the held bill. Held bills live on this device only, so
 * their prints are not logged on the server; online orders are (audit log PRINT_DELIVERY_NOTE + print count).
 */
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useCartStore } from '@/lib/store/cart-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { ensureCustomer } from '@/lib/customer-service';
import { billToDeliveryNote, onlineToDeliveryNote, type OnlineDeliveryNotePayload } from '@/lib/delivery-note';
import type { HeldBill } from '@/lib/types';
import { openDeliveryNote } from './delivery-note-store';

const cashierName = () => {
  const u = useAuthStore.getState().user;
  return u?.fullName || u?.username || null;
};

const open = async (...args: Parameters<typeof openDeliveryNote>) => openDeliveryNote(...args);

/** a held online order: the agreed prices and fee from the server; the print is logged there */
export async function openOnlineDeliveryNote(onlineOrderId: string) {
  try {
    const p = await apiFetch<OnlineDeliveryNotePayload>(`/online-shop/orders/${onlineOrderId}/delivery-note`);
    await open(onlineToDeliveryNote(p, { cashierName: cashierName() }), (format) => {
      void apiFetch(`/online-shop/orders/${onlineOrderId}/delivery-note/print`, { method: 'POST', body: JSON.stringify({ format }) }).catch(() => undefined);
    });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'โหลดบิลส่งของไม่สำเร็จ');
  }
}

/** Held-bills sheet: one parked bill, at the amounts it holds now. */
export async function openHeldBillDeliveryNote(bill: HeldBill) {
  if (bill.onlineOrderId) return openOnlineDeliveryNote(bill.onlineOrderId);
  const customer = bill.customerId ? await ensureCustomer(bill.customerId) : null;
  await open(billToDeliveryNote(bill, { source: 'held', reference: bill.label, heldAt: bill.heldAt, customer, cashierName: cashierName() }));
}

/** Shift+F8 / the cart's "บิลส่งของ": the current cart before it is held or paid. */
export async function openCartDeliveryNote() {
  const cart = useCartStore.getState();
  if (cart.items.length === 0) {
    toast.warning('ยังไม่มีสินค้าในตะกร้า');
    return;
  }
  if (cart.onlineOrderId) return openOnlineDeliveryNote(cart.onlineOrderId);
  const customer = cart.customerId ? await ensureCustomer(cart.customerId) : null;
  await open(billToDeliveryNote(cart, { source: 'cart', reference: '', customer, cashierName: cashierName() }));
}
