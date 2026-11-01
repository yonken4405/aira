import type { ReactElement } from 'react';
import { View } from 'react-native';

import { t } from '@aira/ui';

import { ActionButton } from './ActionButton';
import { TextField } from './TextField';

export interface ListEditorProps {
  readonly label: string;
  readonly entries: readonly string[];
  readonly onChange: (entries: string[]) => void;
  readonly testID: string;
  readonly maxItems: number;
}

/** Editable bounded list of free-text entries (allergies / conditions / medications). */
export function ListEditor({
  label,
  entries,
  onChange,
  testID,
  maxItems,
}: ListEditorProps): ReactElement {
  const replace = (index: number, value: string): void => {
    onChange(entries.map((entry, i) => (i === index ? value : entry)));
  };

  const remove = (index: number): void => {
    onChange(entries.filter((_entry, i) => i !== index));
  };

  return (
    <View className="gap-2">
      {entries.map((entry, index) => (
        <View key={`${testID}-${index}`} className="flex-row items-end gap-2">
          <View className="flex-1">
            <TextField
              label={`${label} ${index + 1}`}
              testID={`${testID}-${index}`}
              value={entry}
              onChangeText={(value) => replace(index, value)}
            />
          </View>
          <ActionButton
            testID={`${testID}-${index}-remove`}
            label={t('citizenRemove')}
            tone="secondary"
            onPress={() => remove(index)}
          />
        </View>
      ))}
      <ActionButton
        testID={`${testID}-add`}
        label={t('citizenAddEntry')}
        tone="secondary"
        disabled={entries.length >= maxItems}
        onPress={() => onChange([...entries, ''])}
      />
    </View>
  );
}
