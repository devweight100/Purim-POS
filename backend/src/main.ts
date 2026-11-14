import './tz'; // must stay the first import (sets process.env.TZ before anything reads the clock)
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { json, urlencoded } from 'express';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
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
  app.enableCors({
    origin: true,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
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
}
bootstrap();
