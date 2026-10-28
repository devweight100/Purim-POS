import { create } from 'zustand';

interface DocumentSearchState {
  isOpen: boolean;
  initialQuery: string;
  openSearch: (query?: string) => void;
  closeSearch: () => void;
  setIsOpen: (isOpen: boolean) => void;
}

export const useDocumentSearchStore = create<DocumentSearchState>((set) => ({
  isOpen: false,
  initialQuery: '',
  openSearch: (query = '') => set({ isOpen: true, initialQuery: query }),
  closeSearch: () => set({ isOpen: false, initialQuery: '' }),
  setIsOpen: (isOpen) => set({ isOpen, initialQuery: isOpen ? '' : '' }),
}));
