import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Param,
  UseGuards,
  Request,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { clientIp } from './login-throttle';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Req() req: any) {
    return this.authService.login(loginDto, clientIp(req));
  }

  @Post('login-pin')
  async loginWithPin(@Body('pin') pin: string, @Req() req: any) {
    return this.authService.loginWithPin(pin, clientIp(req));
  }

  // Creating users is an admin-only action (the endpoint used to be public and accepted any role).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  // Admin User Management Endpoints
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @Get('users')
  getAllUsers() {
    return this.authService.getAllUsers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() body: any) {
    return this.authService.updateUser(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('users/:id/toggle-active')
  toggleUserActive(@Param('id') id: string) {
    return this.authService.toggleUserActive(id);
  }
}
