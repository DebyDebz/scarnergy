import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, SectionList, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { supabase, Rekenzone, Zone } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { FieldSelect } from '../ui/FieldSelect';

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

// Per-type element counts shown under a rekenzone header, AppSheet-style.
const COUNT_TYPES: Array<{ type: string; singular: string; plural: string }> = [
  { type: 'gevel',       singular: 'gevel',       plural: 'gevels' },
  { type: 'dak',         singular: 'dak',         plural: 'daken' },
  { type: 'vloer',       singular: 'vloer',       plural: 'vloeren' },
  { type: 'installatie', singular: 'installatie', plural: 'installaties' },
];

const NEW_REKENZONE = '__new__';

export function ZoneManager({ buildingId, zones, onZonesChange, onDrawZone, onContinue }: Props) {
  const { profile } = useAuthStore();
  const [adding, setAdding] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [creating, setCreating] = useState(false);

  const [rekenzones, setRekenzones] = useState<Rekenzone[]>([]);
  const [selectedRekenzoneId, setSelectedRekenzoneId] = useState('');
  const [newRzMode, setNewRzMode] = useState(false);
  const [newRzName, setNewRzName] = useState('');
  const [creatingRz, setCreatingRz] = useState(false);
  const [elementTypesByZone, setElementTypesByZone] = useState<Record<string, string[]>>({});

  useEffect(() => {
    supabase
      .from('rekenzones')
      .select('*')
      .eq('building_id', buildingId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setRekenzones((data as Rekenzone[]) ?? []));
  }, [buildingId]);

  const zoneIdsKey = zones.map(z => z.id).join(',');
  useEffect(() => {
    const ids = zoneIdsKey ? zoneIdsKey.split(',') : [];
    if (!ids.length) { setElementTypesByZone({}); return; }
    supabase
      .from('building_elements')
      .select('zone_id, element_type')
      .in('zone_id', ids)
      .eq('is_active', true)
      .then(({ data }) => {
        const byZone: Record<string, string[]> = {};
        for (const row of (data ?? []) as Array<{ zone_id: string; element_type: string }>) {
          (byZone[row.zone_id] ??= []).push(row.element_type);
        }
        setElementTypesByZone(byZone);
      });
  }, [zoneIdsKey]);

  const zonesWithPlan = zones.filter(z => z.floor_plan_points && z.floor_plan_points.length >= 3);
  const canContinue = zonesWithPlan.length > 0;

  const sections = useMemo(() => {
    if (!rekenzones.length) return [];
    const list = rekenzones.map(rz => ({
      key: rz.id,
      title: rz.name,
      data: zones.filter(z => z.rekenzone_id === rz.id),
    }));
    const loose = zones.filter(z => !z.rekenzone_id || !rekenzones.some(rz => rz.id === z.rekenzone_id));
    if (loose.length) list.push({ key: 'none', title: 'Ongegroepeerd', data: loose });
    return list.filter(s => s.data.length || s.key !== 'none');
  }, [rekenzones, zones]);

  const countLine = (sectionZones: Zone[]): string => {
    const counts: Record<string, number> = {};
    for (const z of sectionZones) {
      for (const t of elementTypesByZone[z.id] ?? []) counts[t] = (counts[t] ?? 0) + 1;
    }
    return COUNT_TYPES
      .filter(c => counts[c.type])
      .map(c => `${counts[c.type]} ${counts[c.type] === 1 ? c.singular : c.plural}`)
      .join(' · ');
  };

  const createRekenzone = async () => {
    const name = newRzName.trim();
    if (!name || !profile) return;
    setCreatingRz(true);
    const { data, error } = await supabase
      .from('rekenzones')
      .insert({ org_id: profile.org_id, building_id: buildingId, name, sort_order: rekenzones.length })
      .select().single();
    setCreatingRz(false);
    if (error) { Alert.alert('Could not create rekenzone', error.message); return; }
    const rz = data as Rekenzone;
    setRekenzones([...rekenzones, rz]);
    setSelectedRekenzoneId(rz.id);
    setNewRzName('');
    setNewRzMode(false);
  };

  const createZone = async () => {
    const name = zoneName.trim();
    if (!name || !profile) return;
    setCreating(true);
    const zoneCode = `Z${String(zones.length + 1).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('zones')
      .insert({
        org_id: profile.org_id, building_id: buildingId, zone_code: zoneCode, name,
        floor_level: 0, rekenzone_id: selectedRekenzoneId || null,
      })
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

      {sections.length ? (
        <SectionList
          sections={sections}
          keyExtractor={z => z.id}
          renderItem={renderZone}
          renderSectionHeader={({ section }) => {
            const line = countLine(section.data as Zone[]);
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {line ? <Text style={styles.sectionCounts}>{line}</Text> : null}
              </View>
            );
          }}
          stickySectionHeadersEnabled={false}
          style={{ flex: 1 }}
          ListEmptyComponent={
            <Text style={styles.empty}>No zones yet. Add your first zone below.</Text>
          }
        />
      ) : (
        <FlatList
          data={zones}
          keyExtractor={z => z.id}
          renderItem={renderZone}
          style={{ flex: 1 }}
          ListEmptyComponent={
            <Text style={styles.empty}>No zones yet. Add your first zone below.</Text>
          }
        />
      )}

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
          <View style={styles.rzSelect}>
            <FieldSelect
              label="Rekenzone"
              value={selectedRekenzoneId || null}
              placeholder="Geen"
              options={[
                { value: '', label: 'Geen' },
                ...rekenzones.map(rz => ({ value: rz.id, label: rz.name })),
                { value: NEW_REKENZONE, label: '+ Nieuwe rekenzone…' },
              ]}
              onSelect={v => {
                if (v === NEW_REKENZONE) { setNewRzMode(true); return; }
                setNewRzMode(false);
                setSelectedRekenzoneId(v);
              }}
            />
          </View>
          {newRzMode && (
            <View style={styles.rowGap}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder='Rekenzone naam (e.g. "A met airco")'
                value={newRzName}
                onChangeText={setNewRzName}
                returnKeyType="done"
                onSubmitEditing={createRekenzone}
              />
              <TouchableOpacity
                style={[styles.btnPri, (!newRzName.trim() || creatingRz) && styles.btnDis]}
                onPress={createRekenzone} disabled={!newRzName.trim() || creatingRz}
              >
                {creatingRz
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.btnPriTxt}>Add</Text>}
              </TouchableOpacity>
            </View>
          )}
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
  rzSelect:    { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
                 overflow: 'hidden', marginBottom: 10 },
  rowGap:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionHeader:{ paddingTop: 8, paddingBottom: 6 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#6B7280',
                  textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionCounts:{ fontSize: 11, color: '#9CA3AF', marginTop: 1 },
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
