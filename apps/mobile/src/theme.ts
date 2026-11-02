/**
 * Semantic colour tokens for React Native SVG icons. Values mirror the DESIGN.md
 * palette; NativeWind classes cover everything that is a regular View/Text.
 */

import { EMERGENCY_CATEGORIES } from '@aira/ui';

/** `fg` - primary icon/text colour. */
export const ICON_COLOR = '#F2F5F8';

/** `muted` - secondary icon colour. */
export const ICON_MUTED_COLOR = '#93A1B0';

/** `emergency.medikal` - the single affirmative action colour. */
export const ICON_ACTION_COLOR =
  EMERGENCY_CATEGORIES.find((c) => c.id === 'MEDIKAL')?.color ?? ICON_COLOR;
