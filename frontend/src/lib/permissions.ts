export interface PermissionUser {
  role?: string;
  permissions?: string[] | null;
}

export const ROUTE_PERMISSIONS: Record<string, string | string[]> = {
  '/master-control': 'VIEW_REPORTS',
  '/pos': 'POS_SELL',
  '/dashboard': 'VIEW_REPORTS',
  '/reports': 'VIEW_REPORTS',
  '/orders': ['POS_SELL', 'VIEW_REPORTS'],
  '/shifts': ['POS_SELL', 'VIEW_REPORTS'],
  '/debts': 'MANAGE_DEBTS',
  '/customers': ['POS_SELL', 'MANAGE_DEBTS', 'VIEW_REPORTS'],
  '/claims': 'MANAGE_CLAIMS',
  '/products': 'MANAGE_INVENTORY',
  '/categories': 'MANAGE_INVENTORY',
  '/inventory': 'MANAGE_INVENTORY',
  '/claim-inventory': ['MANAGE_CLAIMS', 'MANAGE_INVENTORY'],
  '/suppliers': 'MANAGE_PURCHASES',
  '/purchase-orders': 'MANAGE_PURCHASES',
  '/payables': 'MANAGE_PAYABLES',
  '/supplier-returns': ['MANAGE_CLAIMS', 'MANAGE_PURCHASES'],
  '/accounts': 'MANAGE_SETTINGS',
  '/settings': 'MANAGE_SETTINGS',
  '/users': 'MANAGE_USERS',
};

export function hasPermission(
  user: PermissionUser | null | undefined,
  requiredPermission?: string | string[]
): boolean {
  if (!user) return true; // Standalone / unauthenticated fallback so menus don't disappear
  if (user.role === 'ADMIN') return true;

  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('ALL')) return true;

  if (!requiredPermission) return true;

  if (Array.isArray(requiredPermission)) {
    return requiredPermission.some((p) => perms.includes(p));
  }

  return perms.includes(requiredPermission);
}

export function canAccessRoute(
  user: PermissionUser | null | undefined,
  pathname: string
): boolean {
  if (!user) return true; // Standalone / unauthenticated fallback so menus don't disappear
  if (user.role === 'ADMIN') return true;

  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('ALL')) return true;

  // Exact match or sub-route match
  for (const [route, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(route + '/')) {
      return hasPermission(user, perm);
    }
  }

  return true;
}
