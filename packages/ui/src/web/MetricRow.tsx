import { cn } from '../cn';

export interface MetricRowProps {
  readonly label: string;
  readonly value: string;
  readonly className?: string;
}

/** Dense label/value row for the routing panel - tabular numerals, hairline divider (DESIGN.md §5). */
export function MetricRow({ label, value, className }: MetricRowProps) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0',
        className,
      )}
    >
      <span className="text-[11px] uppercase tracking-label text-muted">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-fg">{value}</span>
    </div>
  );
}
