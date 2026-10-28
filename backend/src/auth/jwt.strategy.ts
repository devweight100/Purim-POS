import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ||
        process.env.JWT_SECRET ||
        'fallback_secret',
    });
  }

  async validate(payload: any) {
    if (!payload?.sub && !payload?.username) {
      throw new UnauthorizedException('Token ไม่ถูกต้อง');
    }

    try {
      const selectFields = {
        id: true,
        username: true,
        fullName: true,
        role: true,
        permissions: true,
        isActive: true,
      };

      let user = payload.sub
        ? await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: selectFields,
          })
        : null;

      // Fallback by username if the database was re-seeded/reset and UUID changed
      if (!user && payload.username) {
        user = await this.prisma.user.findUnique({
          where: { username: payload.username },
          select: selectFields,
        });
      }

      // Fallback to active admin if token belongs to an ADMIN before DB reset
      if (!user && payload.role === 'ADMIN') {
        user = await this.prisma.user.findFirst({
          where: { role: 'ADMIN', isActive: true },
          select: selectFields,
        });
      }

      if (!user) {
        throw new UnauthorizedException('ไม่พบบัญชีผู้ใช้งานในระบบ กรุณาเข้าสู่ระบบใหม่');
      }

      if (!user.isActive) {
        throw new UnauthorizedException('บัญชีผู้ใช้งานถูกระงับ');
      }

      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        permissions: user.permissions,
        isActive: user.isActive,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      // If DB has a transient connection hiccup, fall back to verified JWT claims
      return {
        id: payload.sub,
        username: payload.username,
        fullName: payload.fullName || payload.username,
        role: payload.role || 'CASHIER',
        permissions: payload.permissions || null,
        isActive: true,
      };
    }
  }
}
