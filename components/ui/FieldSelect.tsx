import { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, FlatList,
  SafeAreaView, StyleSheet,
} from 'react-native';

interface Props {
  label: string;
  value: string | null;
  options: string[];
  onSelect: (v: string) => void;
  placeholder?: string;
}

export function FieldSelect({ label, value, options, onSelect, placeholder = 'Selecteer…' }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity style={styles.row} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, !value && styles.placeholder]}>
          {value ?? placeholder}
        </Text>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.overlay}>
          <SafeAreaView style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Text style={styles.cancel}>Annuleren</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item === value && styles.optionSelected]}
                  onPress={() => { onSelect(item); setOpen(false); }}
                >
                  <Text style={[styles.optionText, item === value && styles.optionTextSelected]}>
                    {item}
                  </Text>
                  {item === value && <Text style={styles.check}>✓</Text>}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const PRIMARY = '#1E3A5F';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  label: { flex: 1, fontSize: 14, color: '#374151', fontWeight: '500' },
  value: { fontSize: 14, color: PRIMARY, fontWeight: '600', marginRight: 6 },
  placeholder: { color: '#9ca3af', fontWeight: '400' },
  chevron: { fontSize: 18, color: '#9ca3af' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cancel: { fontSize: 14, color: PRIMARY },

  option: { paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  optionSelected: { backgroundColor: '#eff6ff' },
  optionText: { flex: 1, fontSize: 15, color: '#111827' },
  optionTextSelected: { color: PRIMARY, fontWeight: '600' },
  check: { fontSize: 16, color: PRIMARY },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#f3f4f6', marginLeft: 20 },
});
