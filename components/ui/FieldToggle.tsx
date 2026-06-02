import { View, Text, Switch, StyleSheet } from 'react-native';

interface Props {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export function FieldToggle({ label, value, onChange }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#d1d5db', true: '#bfdbfe' }}
        thumbColor={value ? '#1E3A5F' : '#9ca3af'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  label: { flex: 1, fontSize: 14, color: '#374151', fontWeight: '500' },
});
