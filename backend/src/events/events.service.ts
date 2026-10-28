import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type RealtimeEntity =
  | 'product' | 'stock' | 'order' | 'shift' | 'customer' | 'debt' | 'category'
  | 'bankAccount' | 'settings' | 'supplier' | 'purchaseOrder' | 'claim'
  | 'supplierReturn' | 'payable' | 'user';

export interface RealtimeEvent {
  entity: RealtimeEntity;
  at: string;
  ids?: string[];
}

/**
 * Process-wide bridge. PrismaService (global, no DI on EventsService) pushes
 * here; EventsService exposes it to SSE clients. Avoids circular DI.
 */
export const realtimeBus = new Subject<RealtimeEvent>();

@Injectable()
export class EventsService {
  readonly stream$: Observable<RealtimeEvent> = realtimeBus.asObservable();

  emit(entity: RealtimeEntity, ids?: string[]) {
    realtimeBus.next({ entity, at: new Date().toISOString(), ...(ids?.length ? { ids } : {}) });
  }
}
