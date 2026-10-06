import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

type ToastKind = 'error' | 'success';
interface ToastMessage { id: number; kind: ToastKind; message: string }
type Listener = (toast: ToastMessage) => void;

const listeners = new Set<Listener>();
let nextId = 1;

function publish(kind: ToastKind, message: string) {
  const toast = { id: nextId++, kind, message };
  listeners.forEach(listener => listener(toast));
}

export const toast = {
  error: (message: string) => publish('error', message),
  success: (message: string) => publish('success', message),
};

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }
  return error instanceof Error ? error.message : 'An unexpected request error occurred.';
}

export default function ToastProvider() {
  const [items, setItems] = useState<ToastMessage[]>([]);
  useEffect(() => {
    const listener: Listener = item => {
      setItems(current => [...current.slice(-3), item]);
      window.setTimeout(() => setItems(current => current.filter(value => value.id !== item.id)), 5000);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return (
    <div className="fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {items.map(item => (
        <div key={item.id} className={`flex items-start gap-3 rounded-xl border p-4 shadow-2xl backdrop-blur ${item.kind === 'error' ? 'border-rose-400/25 bg-rose-950/90 text-rose-100' : 'border-emerald-400/25 bg-emerald-950/90 text-emerald-100'}`}>
          {item.kind === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <p className="flex-1 text-sm leading-5">{item.message}</p>
          <button aria-label="Dismiss notification" onClick={() => setItems(current => current.filter(value => value.id !== item.id))}><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
