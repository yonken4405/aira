import type { HTMLAttributes } from 'react';

import { cn } from '../../cn';

/**
 * Loading placeholder (DESIGN.md §6). The only animation allowed is this subdued
 * opacity pulse - suppressed entirely under `prefers-reduced-motion`.
 */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('animate-pulse bg-raised motion-reduce:animate-none', className)}
      {...rest}
    />
  );
}
