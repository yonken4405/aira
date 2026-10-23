'use client';

import {
  useId,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '../../cn';

/**
 * Accessible form primitives (Operate Mode) sharing the visible focus-ring
 * convention established by `field.tsx`'s `CONTROL` class (R20.3). All copy is
 * caller-provided via `label` / `aria-label` props (R20.6). See DESIGN.md §5.
 */

/**
 * The hallmark focus-ring tokens mirrored from `field.tsx`'s `CONTROL`. Kept in
 * sync so every interactive primitive paints the same visible focus state.
 */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fg';

const CONTROL = [
  'border border-line bg-raised text-sm text-fg',
  'transition-colors duration-fast',
  FOCUS_RING,
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

/** Compact focus ring for inline inputs (checkbox/radio) that have no border box. */
const BOX_CONTROL = [
  'h-4 w-4 accent-fg',
  'transition-colors duration-fast',
  FOCUS_RING,
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function Textarea({ className, ...rest }: TextareaProps): ReactElement {
  return (
    <textarea
      className={cn(CONTROL, 'w-full px-2.5 py-2 placeholder:text-muted/70', className)}
      {...rest}
    />
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly label?: string;
}

export function Checkbox({ className, label, id, ...rest }: CheckboxProps): ReactElement {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const input = (
    <input type="checkbox" id={inputId} className={cn(BOX_CONTROL, className)} {...rest} />
  );
  if (label === undefined) {
    return input;
  }
  return (
    <label htmlFor={inputId} className="inline-flex items-center gap-2 text-sm text-fg">
      {input}
      <span>{label}</span>
    </label>
  );
}

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly name: string;
  readonly value: string;
  readonly label: string;
}

export function Radio({ className, label, id, ...rest }: RadioProps): ReactElement {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label htmlFor={inputId} className="inline-flex items-center gap-2 text-sm text-fg">
      <input type="radio" id={inputId} className={cn(BOX_CONTROL, className)} {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface SwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (next: boolean) => void;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
}: SwitchProps): ReactElement {
  function toggle(): void {
    if (disabled) {
      return;
    }
    onCheckedChange(!checked);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      toggle();
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex h-6 w-10 items-center border border-line bg-raised px-0.5',
        'transition-colors duration-fast',
        checked ? 'justify-end bg-fg/20' : 'justify-start',
        FOCUS_RING,
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span aria-hidden className="h-4 w-4 bg-fg" />
    </button>
  );
}
