const fs = require('fs');
const path = require('path');

const files = {
  // Prisma Module
  'src/prisma/prisma.module.ts': `import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
`,
  'src/prisma/prisma.service.ts': `import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
`,
  // Auth Module
  'src/auth/dto/login.dto.ts': `import { IsString, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
`,
  'src/auth/dto/register.dto.ts': `import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}
`,
  'src/auth/jwt.strategy.ts': `import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'fallback_secret',
    });
  }

  async validate(payload: any) {
    return { id: payload.sub, username: payload.username, role: payload.role };
  }
}
`,
  'src/auth/auth.guard.ts': `import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
`,
  'src/auth/auth.service.ts': `import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (user && await bcrypt.compare(pass, user.password)) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { username: user.username, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(registerDto: RegisterDto) {
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        ...registerDto,
        password: hashedPassword,
      },
    });
    const { password, ...result } = user;
    return result;
  }

  async getProfile(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (user) {
        const { password, ...result } = user;
        return result;
    }
    throw new UnauthorizedException();
  }
}
`,
  'src/auth/auth.controller.ts': `import { Controller, Post, Body, Get, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }
}
`,
  'src/auth/auth.module.ts': `import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'fallback_secret',
        signOptions: { expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
`,
  // Products Module
  'src/products/dto/create-product.dto.ts': `import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsArray } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsNumber()
  @IsNotEmpty()
  basePrice!: number;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  barcodes?: string[];
}
`,
  'src/products/dto/update-product.dto.ts': `import { PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {}
`,
  'src/products/products.service.ts': `import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  private mapProductWithStock(product: any) {
    if (!product) return null;
    const stock = product.stockBatches?.reduce((sum: number, batch: any) => sum + batch.quantityRemaining, 0) || 0;
    return { ...product, computedStock: stock };
  }

  async create(createProductDto: CreateProductDto) {
    const { barcodes, ...data } = createProductDto;
    const product = await this.prisma.product.create({
      data: {
        ...data,
        barcodes: barcodes ? {
          create: barcodes.map(b => ({ barcode: b }))
        } : undefined
      },
      include: { barcodes: true, category: true, stockBatches: true }
    });
    return this.mapProductWithStock(product);
  }

  async findAll(search?: string, categoryId?: string) {
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (categoryId) {
      where.categoryId = categoryId;
    }
    const products = await this.prisma.product.findMany({
      where,
      include: { barcodes: true, category: true, stockBatches: true },
    });
    return products.map(p => this.mapProductWithStock(p));
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { barcodes: true, category: true, stockBatches: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.mapProductWithStock(product);
  }

  async findByBarcode(barcode: string) {
    const pBarcode = await this.prisma.productBarcode.findUnique({
      where: { barcode },
      include: { product: { include: { barcodes: true, category: true, stockBatches: true } } },
    });
    if (!pBarcode) throw new NotFoundException('Product not found for barcode');
    return this.mapProductWithStock(pBarcode.product);
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const { barcodes, ...data } = updateProductDto;
    
    // Simple update for simplicity. Barcodes might need separate management in real app
    if (barcodes) {
      await this.prisma.productBarcode.deleteMany({ where: { productId: id } });
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(barcodes && { barcodes: { create: barcodes.map(b => ({ barcode: b })) } })
      },
      include: { barcodes: true, category: true, stockBatches: true },
    });
    return this.mapProductWithStock(product);
  }

  async remove(id: string) {
    return this.prisma.product.delete({ where: { id } });
  }

  async getStock(id: string) {
    const product = await this.findOne(id);
    return { productId: id, computedStock: product?.computedStock };
  }
}
`,
  'src/products/products.controller.ts': `import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Get()
  findAll(@Query('search') search?: string, @Query('categoryId') categoryId?: string) {
    return this.productsService.findAll(search, categoryId);
  }

  @Get('barcode/:code')
  findByBarcode(@Param('code') code: string) {
    return this.productsService.findByBarcode(code);
  }

  @Get(':id/stock')
  getStock(@Param('id') id: string) {
    return this.productsService.getStock(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productsService.update(id, updateProductDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
`,
  'src/products/products.module.ts': `import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
`,
  // Categories Module
  'src/categories/categories.controller.ts': `import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  create(@Body() data: any) {
    return this.prisma.category.create({ data });
  }

  @Get()
  findAll() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.prisma.category.update({ where: { id }, data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}
`,
  'src/categories/categories.module.ts': `import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';

@Module({
  controllers: [CategoriesController],
})
export class CategoriesModule {}
`,
  // Inventory Module
  'src/inventory/inventory.service.ts': `import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async addStockBatch(data: any) {
    return this.prisma.stockBatch.create({
      data: {
        productId: data.productId,
        quantityReceived: data.quantity,
        quantityRemaining: data.quantity,
        unitCost: data.unitCost,
        supplierId: data.supplierId,
        note: data.note,
      }
    });
  }

  async getStockLevel(productId: string) {
    const batches = await this.prisma.stockBatch.findMany({
      where: { productId, quantityRemaining: { >: 0 } }
    });
    return batches.reduce((sum, batch) => sum + batch.quantityRemaining, 0);
  }

  async deductFIFO(productId: string, quantity: number, tx: any = this.prisma) {
    const batches = await tx.stockBatch.findMany({
      where: { productId, quantityRemaining: { >: 0 } },
      orderBy: { receivedAt: 'asc' }
    });

    let remainingToDeduct = quantity;
    let totalCost = 0;
    const deductedBatches = [];

    for (const batch of batches) {
      if (remainingToDeduct <= 0) break;

      const deductAmount = Math.min(batch.quantityRemaining, remainingToDeduct);
      
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { quantityRemaining: batch.quantityRemaining - deductAmount }
      });

      totalCost += deductAmount * Number(batch.unitCost);
      remainingToDeduct -= deductAmount;
      
      deductedBatches.push({
        batchId: batch.id,
        deducted: deductAmount,
        unitCost: batch.unitCost
      });
    }

    if (remainingToDeduct > 0) {
      throw new BadRequestException(\`Insufficient stock for product \${productId}\`);
    }

    return { totalCost, batches: deductedBatches };
  }
}
`,
  'src/inventory/inventory.controller.ts': `import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private prisma: PrismaService
  ) {}

  @Get('stock')
  async getStock() {
    const products = await this.prisma.product.findMany({
      include: { stockBatches: true }
    });
    return products.map(p => ({
      ...p,
      computedStock: p.stockBatches.reduce((sum, b) => sum + b.quantityRemaining, 0)
    }));
  }

  @Post('stock-batch')
  addStockBatch(@Body() data: any) {
    return this.inventoryService.addStockBatch(data);
  }

  @Get('low-stock')
  async getLowStock(@Query('threshold') thresholdStr: string) {
    const threshold = Number(thresholdStr) || 10;
    const products = await this.getStock();
    return products.filter(p => p.computedStock < threshold);
  }
}
`,
  'src/inventory/inventory.module.ts': `import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService]
})
export class InventoryModule {}
`,
  // Orders Module
  'src/orders/orders.service.ts': `import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrderStatus, PaymentMethod } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService
  ) {}

  async checkout(data: any, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Generate Order Number
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count = await tx.order.count({
        where: { orderNumber: { startsWith: \`ORD-\${dateStr}\` } }
      });
      const orderNumber = \`ORD-\${dateStr}-\${String(count + 1).padStart(4, '0')}\`;

      let totalCogs = 0;
      const orderItems = [];

      let subtotal = 0;

      // 2. Deduct FIFO
      for (const item of data.items) {
        const fifoResult = await this.inventory.deductFIFO(item.productId, item.quantity, tx);
        const itemTotal = item.quantity * item.unitPrice;
        subtotal += itemTotal;
        totalCogs += fifoResult.totalCost;
        
        const unitCost = item.quantity > 0 ? fifoResult.totalCost / item.quantity : 0;

        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: unitCost,
          total: itemTotal
        });
      }

      const discountAmount = data.discountAmount || 0;
      const totalAmount = subtotal - discountAmount;

      // 3. Create Order
      const order = await tx.order.create({
        data: {
          orderNumber,
          userId,
          customerId: data.customerId,
          status: OrderStatus.COMPLETED,
          subtotal,
          discountAmount,
          totalAmount,
          totalCogs,
          note: data.note,
          items: {
            create: orderItems
          },
          payments: {
            create: data.payments.map((p: any) => ({
              method: p.method,
              amount: p.amount,
              referenceNo: p.referenceNo
            }))
          }
        },
        include: { items: true, payments: true, customer: true, user: true }
      });

      return order;
    });
  }

  async voidOrder(id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!order) throw new BadRequestException('Order not found');
      if (order.status !== OrderStatus.COMPLETED) throw new BadRequestException('Can only void COMPLETED orders');

      // Restore stock
      for (const item of order.items) {
        // Find newest active batch to restore to, or just create a new adjustment batch
        await tx.stockBatch.create({
          data: {
            productId: item.productId,
            quantityReceived: item.quantity,
            quantityRemaining: item.quantity,
            unitCost: item.unitCost,
            note: \`Voided order \${order.orderNumber}\`
          }
        });
      }

      return tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.VOIDED,
          voidReason: reason
        }
      });
    });
  }

  async findAll(query: any) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.startDate && query.endDate) {
      where.createdAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate)
      };
    }
    return this.prisma.order.findMany({
      where,
      include: { items: true, payments: true, customer: true, user: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string) {
    return this.prisma.order.findUnique({
      where: { id },
      include: { items: true, payments: true, customer: true, user: true }
    });
  }
}
`,
  'src/orders/orders.controller.ts': `import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  checkout(@Body() data: any, @Request() req: any) {
    return this.ordersService.checkout(data, req.user.id);
  }

  @Post(':id/void')
  voidOrder(@Param('id') id: string, @Body() data: { reason: string }) {
    return this.ordersService.voidOrder(id, data.reason);
  }

  @Get()
  findAll(@Query() query: any) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }
}
`,
  'src/orders/orders.module.ts': `import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
`,
  // Customers Module
  'src/customers/customers.controller.ts': `import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  create(@Body() data: any) {
    return this.prisma.customer.create({ data });
  }

  @Get()
  findAll(@Query('search') search?: string) {
    const where = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as any } },
        { phone: { contains: search, mode: 'insensitive' as any } }
      ]
    } : {};
    return this.prisma.customer.findMany({ where });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  @Get(':id/orders')
  getOrders(@Param('id') id: string) {
    return this.prisma.order.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' } });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.prisma.customer.update({ where: { id }, data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.customer.delete({ where: { id } });
  }
}
`,
  'src/customers/customers.module.ts': `import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';

@Module({
  controllers: [CustomersController],
})
export class CustomersModule {}
`,
  // Settings Module
  'src/settings/settings.controller.ts': `import { Controller, Get, Post, Patch, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

const storageOptions = {
  storage: diskStorage({
    destination: './uploads',
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, \`\${file.fieldname}-\${uniqueSuffix}\${extname(file.originalname)}\`);
    }
  })
};

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getSettings() {
    let settings = await this.prisma.storeSettings.findFirst();
    if (!settings) {
      settings = await this.prisma.storeSettings.create({ data: {} });
    }
    return settings;
  }

  @Patch()
  async updateSettings(@Body() data: any) {
    let settings = await this.prisma.storeSettings.findFirst();
    if (!settings) {
      return this.prisma.storeSettings.create({ data });
    }
    return this.prisma.storeSettings.update({ where: { id: settings.id }, data });
  }

  @Post('upload-qr')
  @UseInterceptors(FileInterceptor('file', storageOptions))
  async uploadQr(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = \`/uploads/\${file.filename}\`;
    await this.updateSettings({ qrImageUrl: url });
    return { url };
  }

  @Post('upload-logo')
  @UseInterceptors(FileInterceptor('file', storageOptions))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const url = \`/uploads/\${file.filename}\`;
    await this.updateSettings({ logoUrl: url });
    return { url };
  }
}
`,
  'src/settings/settings.module.ts': `import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [SettingsController],
})
export class SettingsModule {}
`,
  // Reports Module
  'src/reports/reports.controller.ts': `import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { OrderStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private prisma: PrismaService) {}

  @Get('dashboard')
  async getDashboard() {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [todayOrders, monthOrders, totalProducts, totalCustomers, recentOrders] = await Promise.all([
      this.prisma.order.findMany({ where: { createdAt: { gte: today }, status: OrderStatus.COMPLETED } }),
      this.prisma.order.findMany({ where: { createdAt: { gte: startOfMonth }, status: OrderStatus.COMPLETED } }),
      this.prisma.product.count(),
      this.prisma.customer.count(),
      this.prisma.order.findMany({ take: 5, orderBy: { createdAt: 'desc' }, include: { customer: true } })
    ]);

    const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const monthSales = monthOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

    return {
      todaySales,
      monthSales,
      todayOrders: todayOrders.length,
      totalProducts,
      totalCustomers,
      recentOrders
    };
  }

  @Get('sales-summary')
  async getSalesSummary(@Query('period') period: string) {
    // Basic implementation for demonstration
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.COMPLETED },
      orderBy: { createdAt: 'asc' }
    });
    
    // Grouping logic based on period would go here
    return { data: orders };
  }
}
`,
  'src/reports/reports.module.ts': `import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ReportsController],
})
export class ReportsModule {}
`,
  // App Module
  'src/app.module.ts': `import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { CustomersModule } from './customers/customers.module';
import { SettingsModule } from './settings/settings.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ProductsModule,
    CategoriesModule,
    InventoryModule,
    OrdersModule,
    CustomersModule,
    SettingsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(__dirname, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}
console.log('Done creating files.');
