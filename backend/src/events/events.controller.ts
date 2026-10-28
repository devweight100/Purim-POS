import { Controller, MessageEvent, Query, Sse, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { interval, map, merge, Observable, of } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  private readonly jwt: JwtService;

  constructor(
    private readonly events: EventsService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // Same secret resolution as JwtStrategy.
    this.jwt = new JwtService({
      secret: config.get<string>('JWT_SECRET') || process.env.JWT_SECRET || 'fallback_secret',
    });
  }

  /** EventSource cannot send headers, so the JWT is accepted as ?token=. */
  @Sse('stream')
  async stream(@Query('token') token?: string): Promise<Observable<MessageEvent>> {
    if (!token) throw new UnauthorizedException('Missing token');
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!payload?.sub && !payload?.username) throw new UnauthorizedException('Invalid token');
    try {
      const user = payload.sub
        ? await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true } })
        : await this.prisma.user.findUnique({ where: { username: payload.username }, select: { isActive: true } });
      if (user && !user.isActive) throw new UnauthorizedException('Account disabled');
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      /* transient DB error: trust the verified JWT, like JwtStrategy */
    }

    return merge(
      of<MessageEvent>({ type: 'ready', data: { at: new Date().toISOString() } }),
      this.events.stream$.pipe(map((e): MessageEvent => ({ type: 'change', data: e }))),
      interval(20000).pipe(map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } }))),
    );
  }
}
