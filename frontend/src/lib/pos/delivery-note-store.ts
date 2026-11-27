import { create } from 'zustand';
import type { DeliveryNoteData } from '@/lib/delivery-note';

export type DeliveryNoteFormat = '80mm' | 'a4';

interface DeliveryNoteState {
  /** the note shown in the preview dialog (null = closed) */
  data: DeliveryNoteData | null;
  /** called once per print (online orders: audit log + print count) */
  onPrinted?: (format: DeliveryNoteFormat) => void;
}

/** บิลส่งของ preview dialog (components/pos/DeliveryNoteView.tsx), docs/pos-member-picker.md */
export const useDeliveryNote = create<DeliveryNoteState>(() => ({ data: null }));

export function openDeliveryNote(data: DeliveryNoteData, onPrinted?: (format: DeliveryNoteFormat) => void) {
  useDeliveryNote.setState({ data, onPrinted });
}

export function closeDeliveryNote() {
  useDeliveryNote.setState({ data: null, onPrinted: undefined });
}
