import './tz'; // must stay the first import (sets process.env.TZ before anything reads the clock)
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { json, urlencoded } from 'express';
import compression from 'compression';
import { isPublicRequest, publicApiAllowed, publicExposureMiddleware, startShopGateway } from './online-shop/public-exposure';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // FIRST: requests that came through the Cloudflare Tunnel (online shop) reach only /api/public/shop/*.
  // (Also applied by AppModule for every route; this one covers /uploads and unknown paths too.)
  app.use(publicExposureMiddleware);
  
  // gzip JSON responses (the product list / reports compress ~10x; the Next.js /api rewrite passes the encoded
  // body through). Never the realtime event stream: compression would buffer the events.
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (String(req.headers.accept || '').includes('text/event-stream')) return false;
        if (String(res.getHeader('Content-Type') || '').includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Set larger payload limits for bulk Excel product imports
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Enable CORS for localhost and all LAN network clients
  // (never for the online shop: its page is same-origin, and tunnel requests get no CORS at all)
  app.enableCors((req: any, cb: (err: Error | null, options: any) => void) => {
    const shop = isPublicRequest(req.headers) || publicApiAllowed(req.originalUrl || req.url || '');
    cb(null, { origin: !shop, credentials: !shop, methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS' });
  });

  // Global prefix for clean API routing
  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Serve uploaded images only (logo / QR). Anything else that may sit in the folder from older
  // versions (html, svg, ...) is not served, and browsers must not sniff a different content type.
  app.use('/uploads', (req: any, res: any, next: any) => {
    let p = '';
    try { p = decodeURIComponent(String(req.path || '')).toLowerCase(); } catch { p = ''; }
    if (!/^\/[^/\\]+\.(png|jpe?g|webp|gif)$/.test(p)) {
      res.status(404).json({ statusCode: 404, message: 'ไม่พบไฟล์' });
      return;
    }
    next();
  });
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    },
  });

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0'); // Listen on all network interfaces (LAN & Localhost)
  console.log(`🚀 Purim POS Backend is running on: http://localhost:${port}/api and http://0.0.0.0:${port}/api`);

  // Online shop gateway: the ONLY port cloudflared may point at (127.0.0.1). SHOP_GATEWAY_PORT=0 turns it off.
  const gatewayPort = Number(process.env.SHOP_GATEWAY_PORT ?? 3080);
  if (Number.isInteger(gatewayPort) && gatewayPort > 0) {
    startShopGateway({
      port: gatewayPort,
      host: '127.0.0.1',
      target: process.env.FRONTEND_INTERNAL_URL || `http://127.0.0.1:${process.env.POS_PORT || 3000}`,
      log: (m) => console.log(m),
    });
  }
}
bootstrap();
