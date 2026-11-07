import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
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
        mustChangePassword: true,
        tokenVersion: true,
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

      if (!user) {
        throw new UnauthorizedException('ไม่พบบัญชีผู้ใช้งานในระบบ กรุณาเข้าสู่ระบบใหม่');
      }

      if (!user.isActive) {
        throw new UnauthorizedException('บัญชีผู้ใช้งานถูกระงับ');
      }

      // Tokens issued before a password/PIN/role/permission change or deactivation are revoked.
      if (Number(payload.tv ?? 0) !== Number(user.tokenVersion ?? 0)) {
        throw new UnauthorizedException('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      }

      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        permissions: user.permissions,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      // Never trust token claims without the database: a disabled or demoted user
      // must not keep access just because the DB was briefly unreachable.
      throw new UnauthorizedException('ไม่สามารถตรวจสอบสิทธิ์ผู้ใช้งานได้ชั่วคราว กรุณาลองใหม่');
    }
  }
}
