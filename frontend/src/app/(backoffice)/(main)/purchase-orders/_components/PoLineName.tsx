/**
 * Name of a PO line on the purchase-order screens: the name for the PO's name mode (docName), with the supplier's
 * code and, when the printed name is not the shop name, the shop name underneath (staff still know the product).
 */
export function PoLineName({ item, className = '' }: {
  item: { docName?: string | null; docCode?: string | null; name?: string; product?: { name?: string } | null };
  className?: string;
}) {
  const shopName = item.name || item.product?.name || 'สินค้า';
  const printed = item.docName || shopName;
  return (
    <span className={`min-w-0 ${className}`}>
      <span className="block break-words" data-testid="po-line-name">{printed}</span>
      {(item.docCode || printed !== shopName) && (
        <span className="block text-[11px] font-medium text-slate-500" data-testid="po-line-sub">
          {item.docCode ? <span className="font-mono">รหัสผู้ขาย: {item.docCode}</span> : null}
          {item.docCode && printed !== shopName ? ' · ' : null}
          {printed !== shopName ? `ชื่อร้าน: ${shopName}` : null}
        </span>
      )}
    </span>
  );
}
