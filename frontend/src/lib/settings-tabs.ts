/** Groups of the settings page (ตั้งค่า), in the order shown. A group with `roles` is shown to those roles only. */
export const SETTINGS_TABS = [
  { id: 'store', label: 'ข้อมูลร้าน' },
  { id: 'sales', label: 'การขายและใบเสร็จ' },
  { id: 'stock', label: 'สินค้าและสต็อก' },
  { id: 'finance', label: 'การเงิน' },
  { id: 'devices', label: 'เครื่องพิมพ์และลิ้นชัก' },
  { id: 'users', label: 'ผู้ใช้และสิทธิ์' },
  { id: 'online', label: 'ร้านออนไลน์ (LINE)', roles: ['ADMIN'] },
  { id: 'system', label: 'ระบบ', roles: ['ADMIN', 'MANAGER'] },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/**
 * The groups this role sees. ระบบ = version and backups for ADMIN and MANAGER (same roles as the backup API);
 * its danger zone (delete everything) is ADMIN only inside the page.
 */
export function settingsTabsFor(role?: string | null) {
  return SETTINGS_TABS.filter((t) => !('roles' in t) || (t.roles as readonly string[]).includes(role ?? ''));
}

/** `?tab=` value -> a known group, else null. */
export function parseSettingsTab(value: string | null | undefined): SettingsTab | null {
  return SETTINGS_TABS.find((t) => t.id === value)?.id ?? null;
}
