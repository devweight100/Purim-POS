import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency with THB symbol and comma thousands separators e.g. ฿12,500 (no decimal if whole) or ฿12,500.50 (2 decimals if fraction)
 */
export function formatCurrency(amount: number): string {
  const val = Number(amount) || 0;
  const hasDecimal = val % 1 !== 0;
  return '฿' + val.toLocaleString('th-TH', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Format number with comma thousands separators e.g. 12,500 or 12,500.50
 */
export function formatNumber(amount: number): string {
  const val = Number(amount) || 0;
  const hasDecimal = val % 1 !== 0;
  return val.toLocaleString('th-TH', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch {
    return "-";
  }
}

export function generateOrderNumber(): string {
  const date = new Date()
  const d = date.toISOString().slice(0,10).replace(/-/g, '')
  const r = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `ORD-${d}-${r}`
}

/**
 * Convert numeric Thai Baht to Thai wording text e.g. 1250.50 -> หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์
 */
export function thaiBahtText(num: number): string {
  if (!num || isNaN(num) || num <= 0) return "ศูนย์บาทถ้วน";
  const thaiNums = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const thaiUnits = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
  
  const [bahtStr, satangStr] = num.toFixed(2).split(".");
  let bahtVal = parseInt(bahtStr, 10);
  
  if (bahtVal === 0 && parseInt(satangStr, 10) === 0) return "ศูนย์บาทถ้วน";

  let result = "";
  if (bahtVal > 0) {
    const str = bahtVal.toString();
    const len = str.length;

    for (let i = 0; i < len; i++) {
      const digit = parseInt(str[i], 10);
      const pos = len - 1 - i;
      const unitPos = pos % 6;

      if (digit !== 0) {
        if (unitPos === 1 && digit === 1) {
          result += "สิบ";
        } else if (unitPos === 1 && digit === 2) {
          result += "ยี่สิบ";
        } else if (unitPos === 0 && digit === 1 && len > 1 && i === len - 1) {
          result += "เอ็ด";
        } else {
          result += thaiNums[digit] + thaiUnits[unitPos];
        }
      }
      if (unitPos === 0 && pos > 0) {
        result += "ล้าน";
      }
    }
    result += "บาท";
  }

  const satangVal = parseInt(satangStr, 10);
  if (satangVal === 0) {
    result += "ถ้วน";
  } else {
    if (satangVal < 10) {
      result += thaiNums[satangVal] + "สตางค์";
    } else {
      const ten = Math.floor(satangVal / 10);
      const unit = satangVal % 10;
      if (ten === 1) result += "สิบ";
      else if (ten === 2) result += "ยี่สิบ";
      else result += thaiNums[ten] + "สิบ";

      if (unit === 1) result += "เอ็ด";
      else if (unit > 1) result += thaiNums[unit];
      result += "สตางค์";
    }
  }
  return result;
}

