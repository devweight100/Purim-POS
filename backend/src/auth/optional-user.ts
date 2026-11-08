import { JwtService } from '@nestjs/jwt';
import { getJwtSecret } from './jwt-secret';

export interface TokenUser {
  id: string;
  username: string;
  role: string;
  permissions: unknown;
}

let jwt: JwtService | null = null;

/**
 * Resolve the user behind a Bearer token without failing the request (for endpoints that are
 * public but show more to authenticated users). Same checks as JwtStrategy: valid signature,
 * active user, matching tokenVersion. Returns null when anything is wrong.
 */
export async function userFromRequest(req: any, prisma: any): Promise<TokenUser | null> {
  const header = String(req?.headers?.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  try {
    jwt ||= new JwtService({ secret: getJwtSecret() });
    const payload: any = await jwt.verifyAsync(m[1].trim());
    if (!payload?.sub) return null;
    const user = await prisma.user.findUnique({
      where: { id: String(payload.sub) },
      select: { id: true, username: true, role: true, permissions: true, isActive: true, tokenVersion: true },
    });
    if (!user || !user.isActive) return null;
    if (Number(payload.tv ?? 0) !== Number(user.tokenVersion ?? 0)) return null;
    return { id: user.id, username: user.username, role: user.role, permissions: user.permissions };
  } catch {
    return null;
  }
}
