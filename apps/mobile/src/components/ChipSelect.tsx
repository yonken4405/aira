import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

export interface ChipOption {
  readonly value: string;
  readonly label: string;
}

export interface ChipSelectProps {
  readonly label: string;
  readonly options: readonly ChipOption[];
  readonly selected: string | null;
  readonly onSelect: (value: string | null) => void;
  readonly testID: string;
  readonly unsetLabel: string;
}

/** Closed-set selector (blood type / age band) with an explicit unset option. */
export function ChipSelect({
  label,
  options,
  selected,
  onSelect,
  testID,
  unsetLabel,
}: ChipSelectProps): ReactElement {
  const all: readonly ChipOption[] = [{ value: '', label: unsetLabel }, ...options];

  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase tracking-label text-muted">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {all.map((option) => {
          const value = option.value === '' ? null : option.value;
          const active = selected === value;
          return (
            <Pressable
              key={option.value === '' ? 'unset' : option.value}
              testID={`${testID}-${option.value === '' ? 'unset' : option.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => onSelect(value)}
              className={`min-h-[48px] justify-center border px-3 py-2 ${
                active ? 'border-emergency-medikal bg-raised' : 'border-line bg-surface'
              }`}
            >
              <Text className={`text-sm font-bold ${active ? 'text-fg' : 'text-muted'}`}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
