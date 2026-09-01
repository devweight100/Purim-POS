import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserRole } from '@prisma/client';

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

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ');
    }

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

  async loginWithPin(pin: string) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, pinCode: { not: null } },
    });

    for (const u of users) {
      if (u.pinCode && await bcrypt.compare(pin, u.pinCode)) {
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

    throw new UnauthorizedException('รหัส PIN ไม่ถูกต้อง');
  }

  async register(registerDto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { username: registerDto.username } });
    if (existing) {
      throw new BadRequestException('ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        ...registerDto,
        password: hashedPassword,
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
    if (data.fullName) updatePayload.fullName = data.fullName;
    if (data.role) updatePayload.role = data.role;
    if (data.permissions !== undefined) updatePayload.permissions = data.permissions;
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;

    if (data.password && data.password.trim()) {
      updatePayload.password = await bcrypt.hash(data.password.trim(), 10);
    }
    if (data.pinCode && data.pinCode.trim()) {
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
