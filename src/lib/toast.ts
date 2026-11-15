/** Petites notifications éphémères (store local, hors store applicatif). */
import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind, durationMs?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = 'info', durationMs = 3200) => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-2), { id, message, kind }] });
    setTimeout(() => get().dismiss(id), durationMs);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (message: string, kind?: ToastKind, durationMs?: number) =>
  useToasts.getState().push(message, kind, durationMs);
