import type { ReactNode } from 'react';

import { cn } from '../cn';

export interface PanelProps {
  readonly title?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}

/** Flat bordered container - the only "card" shape allowed in Operate Mode (DESIGN.md). */
export function Panel({ title, actions, children, className, bodyClassName }: PanelProps) {
  const hasHeader = title !== undefined || actions !== undefined;

  return (
    <section className={cn('flex min-h-0 flex-col border border-line bg-surface', className)}>
      {hasHeader ? (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
          {title !== undefined ? (
            <h2 className="text-[11px] font-bold uppercase tracking-label text-muted">{title}</h2>
          ) : null}
          {actions}
        </header>
      ) : null}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}
