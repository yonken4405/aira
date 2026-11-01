import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { t } from '@aira/ui';

/** Honest "unavailable offline" treatment for a Tier-2 surface (R11.1/R11.2). */
export function OfflineNotice(): ReactElement {
  return (
    <View testID="offline-notice" className="gap-1 border border-line bg-raised p-4">
      <Text className="text-base font-extrabold text-fg">{t('citizenOfflineTitle')}</Text>
      <Text className="text-sm text-muted">{t('citizenOfflineUnavailable')}</Text>
    </View>
  );
}
