import { searchMatchHint, type ProductNames } from '@shared/product-names';

/**
 * Small line under a search result whose match came from another name of the product (docs/product-names.md):
 * "ผู้ผลิต: …", "ชื่อผู้ขาย: …" or "รหัสผู้ขาย: …". Nothing when the shop name / SKU matched. The result itself
 * always shows the shop name.
 */
export function SearchMatchHint({ product, query, className = '' }: { product: ProductNames | null | undefined; query: string | null | undefined; className?: string }) {
  const hint = searchMatchHint(product, query);
  if (!hint) return null;
  return (
    <div data-testid="search-match-hint" title={hint} className={`truncate text-[11px] font-medium leading-tight text-sky-700 ${className}`}>
      {hint}
    </div>
  );
}
