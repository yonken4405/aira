'use client';

import type { InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes } from 'react';
import { Children, cloneElement, isValidElement } from 'react';

import { cn } from '../../cn';

/**
 * Form primitives (Operate Mode): square corners, hairline borders, visible focus,
 * label always rendered. Shared by the sign-in screen and the admin roster so both
 * surfaces behave identically (DESIGN.md §5).
 */

const CONTROL = [
  'w-full border border-line bg-raised px-2.5 text-sm text-fg',
  'placeholder:text-muted/70',
  'transition-colors duration-fast',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fg',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...rest }: InputProps) {
  return <input className={cn(CONTROL, 'h-10', className)} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ className, ...rest }: SelectProps) {
  return <select className={cn(CONTROL, 'h-10', className)} {...rest} />;
}

export interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
}

export function Field({ id, label, hint, error, children }: FieldProps) {
  const describedById = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  const control = Children.map(children, (child) => {
    if (!isValidElement(child)) {
      return child;
    }

    const element = child as ReactElement<{
      'aria-describedby'?: string;
      'aria-invalid'?: boolean | 'true' | 'false';
    }>;
    const next: { 'aria-describedby'?: string; 'aria-invalid'?: 'true' } = {};

    if (describedById) {
      const existing = element.props['aria-describedby'];
      const ids = existing ? existing.split(/\s+/).filter(Boolean) : [];
      if (!ids.includes(describedById)) {
        ids.push(describedById);
      }
      next['aria-describedby'] = ids.join(' ');
    }

    if (error) {
      next['aria-invalid'] = 'true';
    }

    return cloneElement(element, next);
  });

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[10px] font-bold uppercase tracking-label text-muted">
        {label}
      </label>
      {control}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[11px] leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[11px] font-bold text-status-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
