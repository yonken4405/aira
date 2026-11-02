import type { ReactElement, ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { t } from '@aira/ui';

/** Secondary-surface chrome: back affordance + title, scrollable body. */
export interface ScreenShellProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly children: ReactNode;
}

export function ScreenShell({ title, subtitle, onBack, children }: ScreenShellProps): ReactElement {
  return (
    <View className="flex-1 bg-ink">
      <View className="border-b border-line bg-surface px-4 pb-3 pt-12">
        <Pressable
          testID="screen-back"
          accessibilityRole="button"
          accessibilityLabel={t('citizenBack')}
          onPress={onBack}
          className="min-h-[48px] justify-center self-start px-2"
        >
          <Text className="text-sm font-bold text-muted">{t('citizenBack')}</Text>
        </Pressable>
        <Text className="mt-1 text-2xl font-extrabold text-fg">{title}</Text>
        {subtitle ? <Text className="mt-1 text-sm text-muted">{subtitle}</Text> : null}
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}
