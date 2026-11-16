import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermissions, Roles } from '../auth/roles.decorator';
import { OnlineShopService, PublicCtx } from './online-shop.service';
import { isPublicRequest } from './public-exposure';
import { readSession } from './shop-session';

/** Client address: behind our gateway / Next proxy (loopback) the forwarded address, else the socket. */
function clientIp(req: any): string {
  const sock = String(req.socket?.remoteAddress || req.ip || '');
  const loop = sock === '127.0.0.1' || sock === '::1' || sock === '::ffff:127.0.0.1';
  const fwd = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (loop && fwd) || sock || 'unknown';
}

function ctxOf(req: any): PublicCtx {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const isPublic = isPublicRequest(req.headers);
  const session = token ? readSession(token) : null;
  // test profiles exist only for trying the shop inside the store: never accepted from the internet
  return { ip: clientIp(req), isPublic, session: session && session.dev && isPublic ? null : session };
}

/**
 * The shop page's API: the ONLY routes reachable through the Cloudflare Tunnel (public-exposure.ts).
 * No staff JWT here; customers carry a shop session token (LIFF ID token verified by LINE).
 */
@Controller('public/shop')
export class OnlineShopPublicController {
  constructor(private readonly shop: OnlineShopService) {}

  @Get('config')
  config(@Request() req: any) {
    return this.shop.publicConfig(ctxOf(req));
  }

  @Post('session')
  session(@Request() req: any, @Body() body: any) {
    return this.shop.createSession(ctxOf(req), body);
  }

  @Get('me')
  me(@Request() req: any) {
    const ctx = ctxOf(req);
    this.shop.hit(ctx);
    return this.shop.me(ctx);
  }

  @Get('categories')
  categories(@Request() req: any) {
    return this.shop.categories(ctxOf(req));
  }

  @Get('products')
  products(@Request() req: any, @Query() q: any) {
    return this.shop.catalogue(ctxOf(req), q);
  }

  @Get('images/:id')
  async image(@Request() req: any, @Param('id') id: string, @Res() res: Response) {
    const img = await this.shop.image(ctxOf(req), id);
    if (!img) throw new NotFoundException('ไม่พบรูป');
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.status(200).end(img.body);
  }

  @Get('qr/:file')
  async qr(@Param('file') file: string, @Query('a') a: string, @Query('s') s: string, @Res() res: Response) {
    const id = String(file || '').replace(/\.png$/, '');
    const png = await this.shop.qrImage(id, String(a || ''), String(s || ''));
    if (!png) throw new NotFoundException('ไม่พบ QR');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.status(200).end(png);
  }

  @Post('quote')
  quote(@Request() req: any, @Body() body: any) {
    return this.shop.quote(ctxOf(req), body);
  }

  @Post('orders')
  placeOrder(@Request() req: any, @Body() body: any) {
    return this.shop.placeOrder(ctxOf(req), body);
  }

  @Get('orders')
  myOrders(@Request() req: any) {
    return this.shop.myOrders(ctxOf(req));
  }

  @Get('orders/:id')
  myOrder(@Request() req: any, @Param('id') id: string) {
    return this.shop.myOrder(ctxOf(req), id);
  }

  @Post('orders/:id/cancel')
  cancel(@Request() req: any, @Param('id') id: string) {
    return this.shop.cancelMine(ctxOf(req), id);
  }

  @Post('link')
  link(@Request() req: any, @Body() body: any) {
    return this.shop.requestLink(ctxOf(req), body);
  }
}

/** Back office: online orders and LINE link requests (POS_SELL), LINE settings (ADMIN). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('online-shop')
export class OnlineShopAdminController {
  constructor(private readonly shop: OnlineShopService) {}

  @RequirePermissions('POS_SELL')
  @Get('counts')
  counts() {
    return this.shop.counts();
  }

  @RequirePermissions('POS_SELL')
  @Get('orders')
  list(@Query() q: any) {
    return this.shop.list(q);
  }

  @RequirePermissions('POS_SELL')
  @Get('orders/:id')
  detail(@Param('id') id: string) {
    return this.shop.detail(id);
  }

  @RequirePermissions('POS_SELL')
  @Patch('orders/:id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.shop.update(id, body);
  }

  @RequirePermissions('POS_SELL')
  @Post('orders/:id/accept')
  accept(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.shop.accept(id, body, req.user);
  }

  @RequirePermissions('POS_SELL')
  @Post('orders/:id/reject')
  reject(@Param('id') id: string, @Body() body: any) {
    return this.shop.reject(id, body);
  }

  @RequirePermissions('POS_SELL')
  @Post('orders/:id/status')
  status(@Param('id') id: string, @Body() body: any) {
    return this.shop.setStatus(id, body);
  }

  @RequirePermissions('POS_SELL')
  @Get('orders/:id/pos')
  pos(@Param('id') id: string) {
    return this.shop.posPayload(id);
  }

  @RequirePermissions('POS_SELL')
  @Get('link-requests')
  linkRequests(@Query() q: any) {
    return this.shop.linkRequests(q);
  }

  @RequirePermissions('POS_SELL')
  @Post('link-requests/:id/decide')
  decide(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.shop.decideLink(id, body, req.user);
  }

  @RequirePermissions('POS_SELL', 'MANAGE_DEBTS', 'VIEW_REPORTS')
  @Get('customers/:id/line')
  linked(@Param('id') id: string) {
    return this.shop.linkedAccounts(id);
  }

  @RequirePermissions('POS_SELL')
  @Delete('line/:lineUserId')
  unlink(@Param('lineUserId') lineUserId: string, @Request() req: any) {
    return this.shop.unlink(lineUserId, req.user);
  }

  @Roles('ADMIN')
  @Get('config')
  config() {
    return this.shop.adminConfig();
  }

  @Roles('ADMIN')
  @Put('config')
  saveConfig(@Body() body: any) {
    return this.shop.saveConfig(body);
  }

  @Roles('ADMIN')
  @Post('config/test-line')
  testLine() {
    return this.shop.testLine();
  }
}
