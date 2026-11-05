import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Endpoints still reachable while the account must change a default/temporary credential. */
const ALLOWED_WHILE_MUST_CHANGE = ['/api/auth/me', '/api/auth/change-password', '/api/auth/default-pin'];

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    const req = context.switchToHttp().getRequest();
    if (req.user?.mustChangePassword) {
      const path = String(req.originalUrl || req.url || '').split('?')[0];
      if (!ALLOWED_WHILE_MUST_CHANGE.includes(path)) {
        throw new ForbiddenException({ statusCode: 403, code: 'MUST_CHANGE_PASSWORD', message: 'กรุณาเปลี่ยนรหัสผ่านเริ่มต้นก่อนใช้งานระบบ' });
      }
    }
    return true;
  }
}
