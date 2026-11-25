'use client';

import { useEffect, useState } from 'react';
import { BankLogo } from '@/components/common/BankLogo';
import { fetchBankAccountsFromBackend, loadBankAccounts, type BankAccount } from '@/lib/bank-account-storage';
import { paymentMethodLabel } from '@/lib/receipt-mapper';
import { formatCurrency } from '@/lib/utils';
import type { OrderRowPayment } from './order-shared';

/**
 * How a bill was paid (bill detail), one line per payment; a QR / transfer line shows the account that received the
 * money with its bank logo (docs/product-form-bank-logos.md). Old payments without an account show their reference.
 */
export function OrderPaymentsList({ payments }: { payments: OrderRowPayment[] | undefined }) {
  const [banks, setBanks] = useState<BankAccount[]>(() => loadBankAccounts());
  const needBanks = (payments || []).some((p) => p.bankAccountId);
  useEffect(() => {
    if (!needBanks) return;
    let alive = true;
    fetchBankAccountsFromBackend().then((rows) => { if (alive) setBanks(rows); }, () => undefined);
    return () => { alive = false; };
  }, [needBanks]);
  if (!payments || payments.length === 0) return null;
  return (
    <div className="space-y-1.5 pt-2 border-t border-slate-200" data-testid="order-payments">
      <div className="text-sub text-muted-foreground">ชำระโดย</div>
      {payments.map((p, i) => {
        const bank = p.bankAccountId ? banks.find((b) => b.id === p.bankAccountId) : undefined;
        return (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-fg">{paymentMethodLabel(p.method)}</span>
              {bank ? (
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground" data-testid="order-payment-bank">
                  <BankLogo account={bank} size={20} />
                  <span className="truncate">เข้า {bank.bankName} {bank.accountNumber}</span>
                </span>
              ) : p.referenceNo ? (
                <span className="truncate text-muted-foreground">{p.referenceNo}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums">{formatCurrency(Number(p.amount) || 0)}</span>
          </div>
        );
      })}
    </div>
  );
}
