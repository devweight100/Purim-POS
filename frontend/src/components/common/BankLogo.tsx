import { accountBankCode, bankByCode } from '@shared/thai-banks';

/**
 * The logo of a receiving bank account (docs/product-form-bank-logos.md): the owner's uploaded image when there is
 * one, else the built-in badge (the bank's colour circle + a short abbreviation, drawn here as SVG; no bank logo
 * files are shipped). Works offline. Decorative next to the bank name unless `label` is given.
 */
export function BankLogo({ account, size = 32, label, className = '' }: {
  account: { bankCode?: string | null; bankName?: string | null; logoUrl?: string | null } | null | undefined;
  size?: number;
  /** accessible name (when the logo stands alone) */
  label?: string;
  className?: string;
}) {
  const bank = bankByCode(accountBankCode(account));
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  if (account?.logoUrl && /^data:image\/(png|jpeg|webp);base64,/.test(account.logoUrl)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a data URL (uploaded logo), next/image adds nothing
      <img
        src={account.logoUrl}
        alt={label || ''}
        width={size}
        height={size}
        data-testid="bank-logo-image"
        className={`shrink-0 rounded-full bg-white object-contain ring-1 ring-slate-200 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const text = bank.abbr;
  const fontSize = text.length <= 1 ? 22 : text.length === 2 ? 17 : text.length === 3 ? 14 : text.length === 4 ? 11.5 : 9.5;
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      data-testid="bank-logo-badge"
      data-bank={bank.code}
      className={`shrink-0 ${className}`}
      {...a11y}
    >
      <circle cx="20" cy="20" r="20" fill={bank.color} />
      <text
        x="20"
        y="20"
        dy="0.35em"
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={700}
        fontFamily="var(--font-sans), Sarabun, sans-serif"
        fill={bank.fg}
      >
        {text}
      </text>
    </svg>
  );
}
