import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserRole } from '@prisma/client';
import { loginThrottle } from './login-throttle';

const PIN_PATTERN = /^\d{4,6}$/;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (user && user.isActive && await bcrypt.compare(pass, user.password)) {
      const { password, pinCode, ...result } = user;
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto, ip = 'unknown') {
    const throttleKey = `pwd:${ip}:${String(loginDto.username || '').toLowerCase()}`;
    loginThrottle.assertAllowed(throttleKey);
    const user = await this.validateUser(loginDto.username, loginDto.password);
    if (!user) {
      loginThrottle.fail(throttleKey);
      throw new UnauthorizedException('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ');
    }
    loginThrottle.succeed(throttleKey);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload = { username: user.username, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async loginWithPin(pin: string, ip = 'unknown') {
    const throttleKey = `pin:${ip}`;
    loginThrottle.assertAllowed(throttleKey);
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
      loginThrottle.fail(throttleKey);
      throw new UnauthorizedException('รหัส PIN ไม่ถูกต้อง');
    }
    const users = await this.prisma.user.findMany({
      where: { isActive: true, pinCode: { not: null } },
    });

    for (const u of users) {
      if (u.pinCode && await bcrypt.compare(pin, u.pinCode)) {
        loginThrottle.succeed(throttleKey);
        await this.prisma.user.update({
          where: { id: u.id },
          data: { lastLoginAt: new Date() },
        });

        const { password, pinCode, ...user } = u;
        const payload = { username: u.username, sub: u.id, role: u.role };
        return {
          access_token: this.jwtService.sign(payload),
          user,
        };
      }
    }

    loginThrottle.fail(throttleKey);
    throw new UnauthorizedException('รหัส PIN ไม่ถูกต้อง');
  }

  /** PIN login identifies the user by PIN alone, so PINs must be valid and unique. */
  private async assertPinUsable(pin: string, exceptUserId?: string) {
    if (!PIN_PATTERN.test(pin)) throw new BadRequestException('PIN ต้องเป็นตัวเลข 4-6 หลัก');
    const others = await this.prisma.user.findMany({
      where: { pinCode: { not: null }, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
      select: { pinCode: true },
    });
    for (const o of others) {
      if (o.pinCode && await bcrypt.compare(pin, o.pinCode)) throw new BadRequestException('PIN นี้ถูกใช้โดยพนักงานคนอื่นแล้ว กรุณาเลือก PIN อื่น');
    }
  }

  /** Never allow the last active ADMIN to be demoted or disabled (would lock everyone out). */
  private async assertNotLastAdmin(userId: string) {
    const remaining = await this.prisma.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: userId } } });
    if (remaining === 0) throw new BadRequestException('ต้องมีผู้ดูแลระบบ (ADMIN) ที่ใช้งานได้อย่างน้อย 1 คน');
  }

  async register(registerDto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { username: registerDto.username } });
    if (existing) {
      throw new BadRequestException('ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    let hashedPin: string | undefined = undefined;
    if (registerDto.pinCode) {
      await this.assertPinUsable(registerDto.pinCode);
      hashedPin = await bcrypt.hash(registerDto.pinCode, 10);
    }
    const user = await this.prisma.user.create({
      data: {
        ...registerDto,
        password: hashedPassword,
        pinCode: hashedPin,
      },
    });
    const { password, pinCode, ...result } = user;
    return result;
  }

  async getProfile(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (user) {
      const { password, pinCode, ...result } = user;
      return result;
    }
    throw new UnauthorizedException();
  }

  // Admin User Management
  async getAllUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        permissions: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return users;
  }

  async updateUser(id: string, data: { fullName?: string; role?: UserRole; permissions?: any; password?: string; pinCode?: string; isActive?: boolean }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งานนี้');

    const updatePayload: any = {};
    const losesAdmin = user.role === 'ADMIN' && user.isActive && ((data.role && data.role !== 'ADMIN') || data.isActive === false);
    if (losesAdmin) await this.assertNotLastAdmin(id);
    if (data.role && !Object.values(UserRole).includes(data.role)) throw new BadRequestException('ตำแหน่งไม่ถูกต้อง');
    if (data.fullName) updatePayload.fullName = data.fullName;
    if (data.role) updatePayload.role = data.role;
    if (data.permissions !== undefined) updatePayload.permissions = data.permissions;
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;

    if (data.password && data.password.trim()) {
      updatePayload.password = await bcrypt.hash(data.password.trim(), 10);
    }
    if (data.pinCode && data.pinCode.trim()) {
      await this.assertPinUsable(data.pinCode.trim(), id);
      updatePayload.pinCode = await bcrypt.hash(data.pinCode.trim(), 10);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updatePayload,
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        permissions: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return updated;
  }

  async toggleUserActive(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งานนี้');
    if (user.isActive && user.role === 'ADMIN') await this.assertNotLastAdmin(id);

    return this.prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        permissions: true,
        isActive: true,
      },
    });
  }
}
