import { Controller, Get, Headers, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ProductsService } from './products.service';

/**
 * Product photos by URL (the product list carries `url` / `thumbUrl` instead of base64 data).
 * Public on purpose: <img> tags cannot send the bearer token; ids are random UUIDs and product photos are not
 * secret. A photo row's data never changes (edits keep or replace whole rows), so responses are cacheable for good.
 */
@Controller('product-images')
export class ProductImagesController {
  constructor(private readonly productsService: ProductsService) {}

  @Get(':id')
  async get(
    @Param('id') id: string,
    @Query('size') size: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    const thumb = size === 'thumb';
    const etag = `"${id}${thumb ? '-t' : ''}"`;
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }
    const img = await this.productsService.getImage(id, thumb ? 'thumb' : undefined);
    if (!img) {
      res.removeHeader('Cache-Control');
      res.removeHeader('ETag');
      throw new NotFoundException('ไม่พบรูปสินค้า');
    }
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.status(200).end(img.body);
  }
}
