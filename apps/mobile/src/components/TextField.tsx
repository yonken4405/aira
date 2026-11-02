import type { ReactElement } from 'react';
import { Text, TextInput, View } from 'react-native';

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly testID?: string;
  readonly secureTextEntry?: boolean;
  readonly multiline?: boolean;
  readonly keyboardType?: 'default' | 'email-address' | 'phone-pad';
  readonly autoCapitalize?: 'none' | 'sentences';
  readonly error?: string;
  readonly hint?: string;
}

/** Labeled text input with wired accessibility error state. */
export function TextField({
  label,
  value,
  onChangeText,
  testID,
  secureTextEntry = false,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  error,
  hint,
}: TextFieldProps): ReactElement {
  return (
    <View className="gap-1">
      <Text className="text-xs font-bold uppercase tracking-label text-muted">{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        accessibilityState={{ disabled: false }}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        className={`min-h-[48px] border bg-raised px-3 py-2 text-base text-fg ${
          error ? 'border-status-error' : 'border-line'
        }`}
      />
      {hint ? <Text className="text-xs text-muted">{hint}</Text> : null}
      {error ? <Text className="text-xs text-status-error">{error}</Text> : null}
    </View>
  );
}
