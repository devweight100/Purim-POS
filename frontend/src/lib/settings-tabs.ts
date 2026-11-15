/** Groups of the settings page (ตั้งค่า), in the order shown. `adminOnly` groups are hidden from other roles. */
export const SETTINGS_TABS = [
  { id: 'store', label: 'ข้อมูลร้าน' },
  { id: 'sales', label: 'การขายและใบเสร็จ' },
  { id: 'stock', label: 'สินค้าและสต็อก' },
  { id: 'finance', label: 'การเงิน' },
  { id: 'devices', label: 'เครื่องพิมพ์และลิ้นชัก' },
  { id: 'users', label: 'ผู้ใช้และสิทธิ์' },
  { id: 'system', label: 'ระบบ', adminOnly: true },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/** The groups this role sees (ระบบ = backups and the irreversible operations: ADMIN only). */
export function settingsTabsFor(role?: string | null) {
  return SETTINGS_TABS.filter((t) => !('adminOnly' in t && t.adminOnly) || role === 'ADMIN');
}

/** `?tab=` value -> a known group, else null. */
export function parseSettingsTab(value: string | null | undefined): SettingsTab | null {
  return SETTINGS_TABS.find((t) => t.id === value)?.id ?? null;
}
