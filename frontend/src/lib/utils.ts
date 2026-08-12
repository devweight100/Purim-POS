import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
  }).format(amount)
}

export function formatDate(dateStr: string | Date) {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function generateOrderNumber() {
  const date = new Date()
  const d = date.toISOString().slice(0,10).replace(/-/g, '')
  const r = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `ORD-${d}-${r}`
}
