import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '../../cn';

/** shadcn-style button, restricted to Operate Mode tokens (DESIGN.md §1 - 2). */
export const buttonVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap border',
    'text-xs font-bold uppercase tracking-label',
    'transition-colors duration-fast ease-out',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg',
    'disabled:cursor-not-allowed disabled:opacity-40',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'border-fg bg-fg text-ink hover:bg-white',
        secondary: 'border-line bg-raised text-fg hover:border-muted',
        ghost: 'border-transparent bg-transparent text-muted hover:text-fg',
        destructive: 'border-emergency-sunog bg-emergency-sunog text-ink hover:opacity-90',
      },
      size: {
        sm: 'h-7 px-2 text-[10px]',
        default: 'h-9 px-3',
        lg: 'h-11 px-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...rest} />
  );
}
