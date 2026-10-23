import { getCategory, type EmergencyCategoryId } from '../categories';
import { cn } from '../cn';
import { EmergencyIcon } from './EmergencyIcon';

export interface CategoryBadgeProps {
  readonly category: EmergencyCategoryId;
  readonly className?: string;
}

/**
 * Semantic category chip: English label (primary) + Bisaya (secondary) + Lucide icon.
 * Never color alone (DESIGN.md §2).
 */
export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const meta = getCategory(category);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        meta.outlineClassName,
        className,
      )}
    >
      <EmergencyIcon category={category} size={12} />
      {meta.label}
      <span className="font-medium normal-case tracking-normal opacity-70">
        {meta.localizedLabel}
      </span>
    </span>
  );
}
