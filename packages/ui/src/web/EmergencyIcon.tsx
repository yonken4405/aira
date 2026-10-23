import { Flame, HeartPulse, ShieldAlert, Waves, type LucideIcon } from 'lucide-react';

import { getCategory, type EmergencyCategoryId, type EmergencyIconName } from '../categories';
import { cn } from '../cn';

/** Lucide (shadcn icon set) resolution for the four frozen categories. */
const ICONS: Record<EmergencyIconName, LucideIcon> = {
  flame: Flame,
  'heart-pulse': HeartPulse,
  'shield-alert': ShieldAlert,
  waves: Waves,
};

export interface EmergencyIconProps {
  readonly category: EmergencyCategoryId;
  readonly size?: number;
  readonly className?: string;
  /** `false` → inherit text color instead of the semantic category color. */
  readonly colored?: boolean;
}

export function EmergencyIcon({
  category,
  size = 16,
  className,
  colored = true,
}: EmergencyIconProps) {
  const meta = getCategory(category);
  const Icon = ICONS[meta.icon];

  return (
    <Icon
      aria-hidden="true"
      size={size}
      strokeWidth={2}
      className={cn('shrink-0', className)}
      style={colored ? { color: meta.color } : undefined}
    />
  );
}
