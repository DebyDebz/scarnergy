import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { supabase, Zone } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';

const PRIMARY = '#1E3A5F';

function ZoneThumbnail({ zone }: { zone: Zone }) {
  const hasplan = zone.floor_plan_points && zone.floor_plan_points.length >= 3;
  const SIZE = 56;

  if (!hasplan) {
    return (
      <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: 20, color: '#D1D5DB' }}>?</Text>
      </View>
    );
  }

  const pts = zone.floor_plan_points!;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  const scale = Math.min((SIZE - 8) / rangeX, (SIZE - 8) / rangeY);
  const offX = 4 + ((SIZE - 8) - rangeX * scale) / 2;
  const offY = 4 + ((SIZE - 8) - rangeY * scale) / 2;
  const mapped = pts.map(p => ({
    x: offX + (p.x - minX) * scale,
    y: offY + (p.y - minY) * scale,
  }));

  return (
    <View style={styles.thumb}>
      {mapped.map((p, i) => {
        const next = mapped[(i + 1) % mapped.length];
        const dx = next.x - p.x, dy = next.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) return null;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View key={i} style={{
            position:  'absolute',
            width: len, height: 1.5,
            backgroundColor: PRIMARY,
            left:  (p.x + next.x) / 2 - len / 2,
            top:   (p.y + next.y) / 2 - 0.75,
            transform: [{ rotate: `${angle}deg` }],
          }} />
        );
      })}
    </View>
  );
}

interface Props {
  buildingId: string;
  zones: Zone[];
  onZonesChange: (zones: Zone[]) => void;
  onDrawZone: (zoneId: string, zoneName: string) => void;
  onContinue: () => void;
}

export function ZoneManager({ buildingId, zones, onZonesChange, onDrawZone, onContinue }: Props) {
  const { profile } = useAuthStore();
  const [adding, setAdding] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [creating, setCreating] = useState(false);

  const zonesWithPlan = zones.filter(z => z.floor_plan_points && z.floor_plan_points.length >= 3);
  const canContinue = zonesWithPlan.length > 0;

  const createZone = async () => {
    const name = zoneName.trim();
    if (!name || !profile) return;
    setCreating(true);
    const zoneCode = `Z${String(zones.length + 1).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('zones')
      .insert({ org_id: profile.org_id, building_id: buildingId, zone_code: zoneCode, name, floor_level: 0 })
      .select().single();
    setCreating(false);
    if (error) { Alert.alert('Could not create zone', error.message); return; }
    const newZone = data as Zone;
    onZonesChange([...zones, newZone]);
    setZoneName('');
    setAdding(false);
    onDrawZone(newZone.id, newZone.name);
  };

  const renderZone = ({ item }: { item: Zone }) => {
    const hasplan = !!(item.floor_plan_points && item.floor_plan_points.length >= 3);
    return (
      <View style={styles.card}>
        <ZoneThumbnail zone={item} />
        <View style={styles.zoneInfo}>
          <Text style={styles.zoneName}>{item.name}</Text>
          <Text style={[styles.status, hasplan ? styles.statusOk : styles.statusWarn]}>
            {hasplan ? '✓ Floor plan drawn' : 'No floor plan yet'}
          </Text>
        </View>
        <TouchableOpacity style={styles.drawBtn} onPress={() => onDrawZone(item.id, item.name)}>
          <Text style={styles.drawBtnTxt}>{hasplan ? 'Redraw' : 'Draw'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Your Zones</Text>
      <Text style={styles.sub}>Each zone needs a floor plan before you can place elements.</Text>

      <FlatList
        data={zones}
        keyExtractor={z => z.id}
        renderItem={renderZone}
        style={{ flex: 1 }}
        ListEmptyComponent={
          <Text style={styles.empty}>No zones yet. Add your first zone below.</Text>
        }
      />

      {adding ? (
        <View style={styles.addForm}>
          <TextInput
            style={styles.input}
            placeholder="Zone name (e.g. Ground Floor, Room A)"
            value={zoneName}
            onChangeText={setZoneName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={createZone}
          />
          <View style={styles.row}>
            <TouchableOpacity style={styles.btnSec} onPress={() => { setAdding(false); setZoneName(''); }}>
              <Text style={styles.btnSecTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPri, (!zoneName.trim() || creating) && styles.btnDis]}
              onPress={createZone} disabled={!zoneName.trim() || creating}
            >
              {creating
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnPriTxt}>Create & Draw</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)}>
          <Text style={styles.addBtnTxt}>+ Add Zone</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.continueBtn, !canContinue && styles.btnDis]}
        onPress={onContinue} disabled={!canContinue}
      >
        <Text style={styles.continueTxt}>
          {canContinue
            ? `Continue with ${zonesWithPlan.length} zone${zonesWithPlan.length > 1 ? 's' : ''} →`
            : 'Draw at least one floor plan to continue'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:        { flex: 1, padding: 16 },
  header:      { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  sub:         { fontSize: 13, color: '#6B7280', marginBottom: 16 },
  empty:       { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 32 },
  card:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
                 borderRadius: 10, padding: 12, marginBottom: 10,
                 borderWidth: 1, borderColor: '#E5E7EB' },
  thumb:       { width: 56, height: 56, borderRadius: 6, backgroundColor: '#f9fafb',
                 borderWidth: 1, borderColor: '#E5E7EB', overflow: 'hidden' },
  zoneInfo:    { flex: 1 },
  zoneName:    { fontSize: 14, fontWeight: '600', color: '#111827' },
  status:      { fontSize: 12, marginTop: 2 },
  statusOk:    { color: '#059669' },
  statusWarn:  { color: '#D97706' },
  drawBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6,
                 borderWidth: 1, borderColor: PRIMARY },
  drawBtnTxt:  { fontSize: 12, color: PRIMARY, fontWeight: '600' },
  addForm:     { backgroundColor: '#f9fafb', borderRadius: 10, padding: 12,
                 marginTop: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  input:       { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D1D5DB',
                 borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, marginBottom: 10 },
  row:         { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  addBtn:      { borderWidth: 1, borderColor: PRIMARY, borderRadius: 10,
                 paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  addBtnTxt:   { color: PRIMARY, fontSize: 14, fontWeight: '600' },
  continueBtn: { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14,
                 alignItems: 'center', marginTop: 16 },
  continueTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnPri:      { backgroundColor: PRIMARY, paddingHorizontal: 16, paddingVertical: 8,
                 borderRadius: 8, alignItems: 'center' },
  btnPriTxt:   { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnSec:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
                 borderWidth: 1, borderColor: '#D1D5DB' },
  btnSecTxt:   { fontSize: 13, color: '#374151' },
  btnDis:      { opacity: 0.45 },
});
