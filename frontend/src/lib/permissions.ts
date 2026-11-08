export interface PermissionUser {
  role?: string;
  permissions?: string[] | null;
}

/**
 * Route -> required permission.
 *  - 'X'              : needs X
 *  - ['X', 'Y']       : needs X OR Y
 *  - [['X','Y'], ['Z']]: needs (X OR Y) AND Z  - used when a page calls several APIs with different guards
 * Keep these in line with the backend @RequirePermissions/@Roles of every API the page loads, otherwise a user
 * sees the page but gets 403s and empty lists.
 */
export type PermissionRequirement = string | string[] | string[][];

export const ROUTE_PERMISSIONS: Record<string, PermissionRequirement> = {
  '/master-control': 'VIEW_REPORTS',
  '/monitor': 'VIEW_REPORTS',
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
  // GET /claims needs MANAGE_CLAIMS|POS_SELL; GET /suppliers needs MANAGE_PURCHASES|MANAGE_PAYABLES|MANAGE_INVENTORY
  '/claim-inventory': [['MANAGE_CLAIMS', 'POS_SELL'], ['MANAGE_INVENTORY', 'MANAGE_PURCHASES', 'MANAGE_PAYABLES']],
  '/suppliers': 'MANAGE_PURCHASES',
  '/purchase-orders': 'MANAGE_PURCHASES',
  '/payables': 'MANAGE_PAYABLES',
  // The page loads /suppliers and /purchase-orders (MANAGE_PURCHASES) besides /supplier-returns
  '/supplier-returns': 'MANAGE_PURCHASES',
  '/accounts': 'MANAGE_SETTINGS',
  '/finance': 'MANAGE_FINANCE',
  '/approvals': ['APPROVE_OVERRIDES', 'VIEW_REPORTS'],
  '/settings': 'MANAGE_SETTINGS',
  '/users': 'MANAGE_USERS',
};

export function hasPermission(
  user: PermissionUser | null | undefined,
  requiredPermission?: PermissionRequirement
): boolean {
  if (!user) return true; // Standalone / unauthenticated fallback so menus don't disappear
  if (user.role === 'ADMIN') return true;

  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('ALL')) return true;

  if (!requiredPermission) return true;

  if (Array.isArray(requiredPermission)) {
    if (requiredPermission.length > 0 && Array.isArray(requiredPermission[0])) {
      return (requiredPermission as string[][]).every((group) => group.some((p) => perms.includes(p)));
    }
    return (requiredPermission as string[]).some((p) => perms.includes(p));
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
