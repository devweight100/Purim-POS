import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { LineStaffService } from './line-staff.service';

/**
 * LINE Messaging API webhook: POST /api/public/line/webhook. Reachable from the internet through the 3080 gateway
 * (this exact path only, shared/src/public-exposure.ts). No staff login: the X-Line-Signature (HMAC of the raw body
 * with the channel secret) proves the request came from LINE; anything else is 401.
 */
@Controller('public/line')
export class LineWebhookController {
  constructor(private readonly staff: LineStaffService) {}

  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() req: any, @Headers('x-line-signature') signature: string | undefined, @Body() body: any) {
    return this.staff.webhook(req.rawBody, signature, body);
  }
}
