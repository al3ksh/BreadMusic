'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastInput {
  type?: ToastType;
  title: string;
  description?: string;
  durationMs?: number;
}

interface ToastItem {
  id: number;
  type: ToastType;
  title: string;
  description?: string;
  durationMs: number;
}

interface ToastContextValue {
  pushToast: (toast: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 3200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((input: ToastInput) => {
    const id = idRef.current;
    idRef.current += 1;

    const toast: ToastItem = {
      id,
      type: input.type || 'info',
      title: input.title,
      description: input.description,
      durationMs: input.durationMs ?? DEFAULT_DURATION,
    };

    setToasts((prev) => [...prev, toast]);

    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((entry) => entry.id !== id));
      timersRef.current.delete(id);
    }, toast.durationMs);

    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    pushToast,
    success: (title, description) => pushToast({ type: 'success', title, description }),
    error: (title, description) => pushToast({ type: 'error', title, description, durationMs: 4200 }),
    info: (title, description) => pushToast({ type: 'info', title, description }),
  }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="fixed bottom-4 right-4 z-[220] w-[min(92vw,360px)] space-y-2 pointer-events-none" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const colorClass =
            toast.type === 'success'
              ? 'border-success/40 bg-success/10'
              : toast.type === 'error'
                ? 'border-danger/40 bg-danger/10'
                : 'border-info/40 bg-info/10';

          const Icon =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'error'
                ? AlertTriangle
                : Info;

          return (
            <div
              key={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto rounded-lg border shadow-xl backdrop-blur-sm animate-slide-up ${colorClass}`}
              style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
            >
              <div className="flex items-start gap-3 px-3 py-2.5">
                <Icon size={16} className="mt-0.5 shrink-0 text-text-primary" />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary leading-tight">{toast.title}</p>
                  {toast.description && (
                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">{toast.description}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
