'use client';

import { useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { getTerminalId } from '@/lib/terminal-id';
import { formatQty } from '@/lib/qty';
import { useCartStore } from '@/lib/store/cart-store';
import type { CartItem } from '@/lib/types';
import type { Customer } from '@/lib/customer-service';

/** The logged-in user as the monitor shows it. */
interface TerminalUser {
  name?: string | null;
  username?: string | null;
}

const HEARTBEAT_MS = 10000;
const LIVE_STATE_DEBOUNCE_MS = 300;

function terminalIdentity(user: TerminalUser | null | undefined) {
  const terminalId = getTerminalId();
  const terminalName =
    localStorage.getItem('purim_terminal_custom_name') || `จุดขาย #${terminalId.slice(0, 6).toUpperCase()}`;
  return { terminalId, terminalName, userName: user?.name || user?.username || 'แคชเชียร์' };
}

/** Pings the server's store monitor every 10 s while a POS screen is open (errors are ignored). */
export function useTerminalHeartbeat(user: TerminalUser | null | undefined) {
  useEffect(() => {
    const reportHeartbeat = async () => {
      try {
        await apiFetch('/server-control/ping', {
          method: 'POST',
          body: JSON.stringify(terminalIdentity(user)),
        });
      } catch {
        // silent
      }
    };
    void reportHeartbeat();
    const interval = setInterval(reportHeartbeat, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [user]);
}

interface LiveStateInput {
  items: CartItem[];
  showPayment: boolean;
  showCashDrawer: boolean;
  showClaim: boolean;
  activeCustomer: Customer | null;
  user: TerminalUser | null | undefined;
  idleDescription: string;
}

type LiveAction = 'IDLE' | 'SCANNING' | 'PAYMENT' | 'VOID' | 'DRAWER' | 'CLAIM';

/**
 * Sends a small snapshot of what the cashier is doing (cart, payment, drawer, claim) to the store
 * monitor, debounced 300 ms so rapid scanning batches cleanly. Failures never affect the cashier.
 */
export function useTerminalLiveState({
  items,
  showPayment,
  showCashDrawer,
  showClaim,
  activeCustomer,
  user,
  idleDescription,
}: LiveStateInput) {
  const prevItemsCount = useRef<number>(items.length);

  useEffect(() => {
    const sendState = async () => {
      // Latest cart snapshot (the effect re-runs on cart items; the getters live on the store)
      const cart = useCartStore.getState();
      try {
        let activeAction: LiveAction = 'IDLE';
        let actionDescription = idleDescription;
        let alertLevel: 'NORMAL' | 'WARNING' | 'ALERT' = 'NORMAL';

        const totalAmount = cart.getTotal();

        if (showPayment) {
          activeAction = 'PAYMENT';
          actionDescription = `กำลังเปิดหน้าชำระเงิน (ยอดรวม ฿${totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })})`;
        } else if (showCashDrawer) {
          activeAction = 'DRAWER';
          actionDescription = 'เปิดลิ้นชักเก็บเงินหน้าร้าน';
        } else if (showClaim) {
          activeAction = 'CLAIM';
          actionDescription = 'กำลังทำรายการเคลม/เปลี่ยนสินค้า';
        } else if (cart.items.length > 0) {
          activeAction = 'SCANNING';
          const lastItem = cart.items[cart.items.length - 1];
          actionDescription = `ยิงสินค้า: ${lastItem.name} (${formatQty(lastItem.quantity)} ${lastItem.unitName})`;

          if (cart.items.length < prevItemsCount.current) {
            activeAction = 'VOID';
            actionDescription = `⚠️ มีการลบสินค้าออกจากตะกร้า (เหลือ ${cart.items.length} รายการ)`;
            alertLevel = 'WARNING';
          }
        }

        prevItemsCount.current = cart.items.length;

        const liveState = {
          activeAction,
          actionDescription,
          actionTimestamp: new Date().toISOString(),
          customerName: activeCustomer?.name || (cart.customerId ? 'ลูกค้าสมาชิก' : undefined),
          itemCount: cart.getItemCount(),
          totalAmount,
          discountAmount: cart.getBillDiscountAmount(),
          cartItems: cart.items.map((it) => ({
            productId: it.productId,
            name: it.name,
            barcode: it.sku || '',
            unitName: it.unitName,
            price: cart.getEffectivePrice(it),
            quantity: it.quantity,
            total: cart.getItemLineTotal(it),
          })),
          alertLevel,
        };

        await apiFetch('/server-control/sync-live-state', {
          method: 'POST',
          body: JSON.stringify({ ...terminalIdentity(user), liveState }),
        });
      } catch {
        // silent fail - zero impact on cashier operations
      }
    };

    const timeout = setTimeout(sendState, LIVE_STATE_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [items, showPayment, showCashDrawer, showClaim, activeCustomer, user, idleDescription]);
}
