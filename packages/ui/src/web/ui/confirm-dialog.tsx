'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { ReactElement, ReactNode } from 'react';

import { t } from '../../i18n';
import { Button } from './button';

/**
 * Confirmation gate for destructive/irreversible actions (DESIGN.md §6).
 * Built on Radix AlertDialog so focus trapping, ESC handling and screen-reader
 * semantics are correct without hand-rolled modal code.
 */
export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: 'default' | 'destructive';
  readonly onConfirm: () => void;
  /** Optional custom trigger; when omitted the dialog is controlled externally. */
  readonly children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = t('cancelAction'),
  tone = 'default',
  onConfirm,
  children,
}: ConfirmDialogProps): ReactElement {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children ? (
        <AlertDialogPrimitive.Trigger asChild>{children}</AlertDialogPrimitive.Trigger>
      ) : null}

      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/85" />

        <AlertDialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 border border-line bg-surface p-4 focus:outline-none">
          <AlertDialogPrimitive.Title className="text-sm font-bold uppercase tracking-label text-fg">
            {title}
          </AlertDialogPrimitive.Title>

          <AlertDialogPrimitive.Description className="mt-2 text-xs leading-relaxed text-muted">
            {description}
          </AlertDialogPrimitive.Description>

          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" size="sm">
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>

            <AlertDialogPrimitive.Action asChild>
              <Button
                variant={tone === 'destructive' ? 'destructive' : 'default'}
                size="sm"
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
