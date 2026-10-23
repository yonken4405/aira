import { Pressable, Text } from 'react-native';

export interface SosButtonProps {
  /** English label - the largest element on the cell (PRODUCT.md §3). */
  readonly label: string;
  /** Bisaya secondary hint (becomes primary when the `ceb` locale ships). */
  readonly sublabel: string;
  /** Semantic category color - border + label only (DESIGN.md §2). */
  readonly color: string;
  readonly onPress: () => void;
  readonly testID: string;
}

/**
 * Massive, high-contrast SOS cell. Whole quadrant is the tap target;
 * press feedback is an instant opacity change - no bounce, no motion gimmicks.
 */
export function SosButton({ label, sublabel, color, onPress, testID }: SosButtonProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} emergency, ${sublabel}`}
      className="flex-1 items-start justify-end border-2 bg-raised px-4 pb-5 pt-6 active:opacity-75"
      style={{ borderColor: color }}
    >
      <Text
        className="text-4xl font-extrabold"
        style={{ color }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {label}
      </Text>
      <Text className="mt-1 text-xs font-bold uppercase text-muted">{sublabel}</Text>
    </Pressable>
  );
}
