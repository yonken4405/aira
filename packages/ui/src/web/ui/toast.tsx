'use client';

import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '../../cn';
import { t } from '../../i18n';

/**
 * Unified notification system (DESIGN.md §6).
 *
 * Every asynchronous outcome in the product surfaces through this one API - no ad-hoc
 * banners. Toasts are flat, bordered, announce themselves via `role="status"`, and
 * auto-dismiss after 5s.
 */

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastInput {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
}

interface ToastRecord extends ToastInput {
  readonly id: number;
}

interface ToastContextValue {
  toast(input: ToastInput): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5_000;

const TONE_BORDER: Record<ToastTone, string> = {
  info: 'border-l-status-info',
  success: 'border-l-status-success',
  error: 'border-l-status-error',
};

function ToastItem({
  record,
  onDismiss,
}: {
  readonly record: ToastRecord;
  readonly onDismiss: (id: number) => void;
}) {
  const tone = record.tone ?? 'info';

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(record.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [record.id, onDismiss]);

  return (
    <li
      role="status"
      data-testid={`toast-${tone}`}
      className={cn(
        'pointer-events-auto flex w-80 items-start gap-3 border border-l-4 border-line bg-surface p-3',
        TONE_BORDER[tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-label text-fg">{record.title}</p>
        {record.description ? (
          <p className="mt-1 break-words text-xs leading-relaxed text-muted">
            {record.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(record.id)}
        aria-label={t('dismissNotification')}
        className="border border-transparent p-1 text-muted transition-colors duration-fast hover:border-line hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-fg"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((record) => record.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { ...input, id }]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ol
        aria-live="polite"
        aria-label={t('notifications')}
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex list-none flex-col gap-2"
      >
        {toasts.map((record) => (
          <ToastItem key={record.id} record={record} onDismiss={dismiss} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return context;
}

/**
 * Non-throwing toast accessor for islands that may render outside a
 * {@link ToastProvider} (e.g. the App_Shell header in isolation). When a
 * provider is present it behaves exactly like {@link useToast}; otherwise it
 * returns no-op handlers so the surface still functions without a toast host.
 */
export function useOptionalToast(): ToastContextValue {
  const context = useContext(ToastContext);
  return context ?? { toast: () => -1, dismiss: () => undefined };
}
