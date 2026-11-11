import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { quantitiesToNumbers } from './qty';

/** Sends DECIMAL quantity columns as JSON numbers (Prisma would serialise them as strings). */
@Injectable()
export class QtyResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((body) => quantitiesToNumbers(body)));
  }
}
