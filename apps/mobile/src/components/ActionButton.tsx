import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

export type ActionButtonTone = 'primary' | 'secondary' | 'danger';

export interface ActionButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID?: string;
  readonly tone?: ActionButtonTone;
  readonly disabled?: boolean;
}

const TONE_CLASS: Record<ActionButtonTone, string> = {
  primary: 'bg-emergency-medikal',
  secondary: 'border border-line bg-raised',
  danger: 'border border-status-error bg-raised',
};

const LABEL_CLASS: Record<ActionButtonTone, string> = {
  primary: 'text-ink',
  secondary: 'text-fg',
  danger: 'text-status-error',
};

/** Single Operate-Mode action button (min 48 dp target, no motion). */
export function ActionButton({
  label,
  onPress,
  testID,
  tone = 'primary',
  disabled = false,
}: ActionButtonProps): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[48px] items-center justify-center px-4 py-3 ${TONE_CLASS[tone]} ${
        disabled ? 'opacity-50' : 'active:opacity-75'
      }`}
    >
      <Text className={`text-base font-extrabold ${LABEL_CLASS[tone]}`}>{label}</Text>
    </Pressable>
  );
}
