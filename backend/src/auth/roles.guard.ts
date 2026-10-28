import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, PERMISSIONS_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      (!requiredRoles || requiredRoles.length === 0) &&
      (!requiredPermissions || requiredPermissions.length === 0)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request?.user;

    if (!user) {
      throw new ForbiddenException('ไม่พบข้อมูลสิทธิ์ผู้ใช้งาน');
    }

    // ADMIN always has full access to all endpoints
    if (user.role === 'ADMIN') {
      return true;
    }

    const userPermissions: string[] = Array.isArray(user.permissions)
      ? user.permissions.map((p: any) => String(p))
      : [];

    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.includes(user.role);
      if (!hasRole) {
        // Allow if route also specifies granular permissions and user has them (unless restricted to ADMIN only)
        const isAdminOnly = requiredRoles.length === 1 && requiredRoles[0] === 'ADMIN';
        const hasExplicitPermission =
          !isAdminOnly &&
          requiredPermissions &&
          requiredPermissions.length > 0 &&
          (userPermissions.includes('ALL') ||
            requiredPermissions.some((perm) => userPermissions.includes(perm)));

        if (!hasExplicitPermission) {
          throw new ForbiddenException(
            `คุณไม่มีสิทธิ์ดำเนินการนี้ (ต้องการสิทธิ์ระดับ ${requiredRoles.join(' หรือ ')})`,
          );
        }
      }
    }

    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasPermission =
        user.role === 'MANAGER' ||
        userPermissions.includes('ALL') ||
        requiredPermissions.some((perm) => userPermissions.includes(perm));

      if (!hasPermission) {
        throw new ForbiddenException('คุณไม่มีสิทธิ์ดำเนินการในส่วนนี้');
      }
    }

    return true;
  }
}
