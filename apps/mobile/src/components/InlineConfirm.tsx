import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { t } from '@aira/ui';

import { ActionButton } from './ActionButton';

export interface InlineConfirmProps {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly testID: string;
  readonly tone?: 'primary' | 'danger';
}

/** Confirmation gate for irreversible actions (no native Alert dependency). */
export function InlineConfirm({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  testID,
  tone = 'primary',
}: InlineConfirmProps): ReactElement {
  return (
    <View testID={testID} className="gap-3 border border-line bg-raised p-4">
      <Text className="text-base font-extrabold text-fg">{title}</Text>
      <Text className="text-sm text-muted">{body}</Text>
      <View className="gap-2">
        <ActionButton
          testID={`${testID}-confirm`}
          label={confirmLabel}
          tone={tone}
          onPress={onConfirm}
        />
        <ActionButton
          testID={`${testID}-cancel`}
          label={t('cancelAction')}
          tone="secondary"
          onPress={onCancel}
        />
      </View>
    </View>
  );
}
