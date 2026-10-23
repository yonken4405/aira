/**
 * Emergency category model - the closed enum used by BOTH apps.
 *
 * Language policy (PRODUCT.md §3): English is the primary UI language. The Bisaya
 * (`localizedLabel`) values ship as secondary text today and become primary when the
 * `ceb` locale lands (`@aira/ui` i18n). IDs are the frozen wire format (PRODUCT.md §4)
 * and are NOT display text - never rename them.
 *
 * NOTE (PRODUCT.md §2): voice/STT and LLM/chat features are permanently removed from AIRA.
 * No free text, no transcripts - citizens can only pick one of these four categories.
 */

export type EmergencyCategoryId = 'SUNOG' | 'MEDIKAL' | 'KRIMEN' | 'BAHA';

/** Lucide icon names (shadcn's icon set) resolved per platform by the UI layer. */
export type EmergencyIconName = 'flame' | 'heart-pulse' | 'shield-alert' | 'waves';

export interface EmergencyCategory {
  /** Wire/payload identifier - frozen (PRODUCT.md §4). Not a display string. */
  readonly id: EmergencyCategoryId;
  /** Primary display label - English (PRODUCT.md §3). */
  readonly label: string;
  /** Secondary display label - Bisaya; primary once the `ceb` locale ships. */
  readonly localizedLabel: string;
  /** One-line English clarification for dense dashboards. */
  readonly description: string;
  /** Semantic icon - Lucide name, mapped in `@aira/ui/web` (and future RN icon layer). */
  readonly icon: EmergencyIconName;
  /** Semantic hex color - icons/labels/borders/markers ONLY (DESIGN.md §2). */
  readonly color: string;
  /** Static Tailwind classes for badge/outline usage (safe for content extraction). */
  readonly outlineClassName: string;
}

export const EMERGENCY_CATEGORIES: readonly EmergencyCategory[] = [
  {
    id: 'SUNOG',
    label: 'Fire',
    localizedLabel: 'Sunog',
    description: 'Fire or smoke',
    icon: 'flame',
    color: '#FF3B1F',
    outlineClassName: 'border-emergency-sunog text-emergency-sunog bg-emergency-sunog/10',
  },
  {
    id: 'MEDIKAL',
    label: 'Medical',
    localizedLabel: 'Medikal',
    description: 'Injury or illness',
    icon: 'heart-pulse',
    color: '#00D08A',
    outlineClassName: 'border-emergency-medikal text-emergency-medikal bg-emergency-medikal/10',
  },
  {
    id: 'KRIMEN',
    label: 'Crime',
    localizedLabel: 'Krimen',
    description: 'Crime in progress',
    icon: 'shield-alert',
    color: '#FFC53D',
    outlineClassName: 'border-emergency-krimen text-emergency-krimen bg-emergency-krimen/10',
  },
  {
    id: 'BAHA',
    label: 'Flood',
    localizedLabel: 'Baha',
    description: 'Flooding or rising water',
    icon: 'waves',
    color: '#4CC2FF',
    outlineClassName: 'border-emergency-baha text-emergency-baha bg-emergency-baha/10',
  },
] as const;

const CATEGORY_IDS: ReadonlySet<string> = new Set(
  EMERGENCY_CATEGORIES.map((category) => category.id),
);

export function isEmergencyCategoryId(value: unknown): value is EmergencyCategoryId {
  return typeof value === 'string' && CATEGORY_IDS.has(value);
}

export function getCategory(id: EmergencyCategoryId): EmergencyCategory {
  const found = EMERGENCY_CATEGORIES.find((category) => category.id === id);
  if (!found) {
    throw new Error(`Unknown emergency category: ${String(id)}`);
  }
  return found;
}
