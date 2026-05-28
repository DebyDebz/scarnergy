import { useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  TextInput, StyleSheet, Alert, ActivityIndicator,
  PanResponder, PanResponderGestureState,
} from 'react-native';
import { supabase, Zone } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';

const PRIMARY  = '#1E3A5F';
const CANVAS   = 300;
const CELL_PX  = 20;
const PADDING  = 12;
const INNER    = CANVAS - PADDING * 2;
const GRID_N   = Math.ceil(CANVAS / CELL_PX) + 1;

type ElementType = 'gevel' | 'transparant_deel_door' | 'transparant_deel_window' | 'dak' | 'vloer' | 'installatie';

interface PlacedElement {
  id: string; type: ElementType; label: string;
  x: number; y: number; w: number; h: number; rotation: number;
}

interface PaletteItem { type: ElementType; display: string; w: number; h: number; color: string; border: string }

const PALETTE: PaletteItem[] = [
  { type: 'gevel',                   display: 'Wall',    w: 60, h: 8,  color: PRIMARY,    border: PRIMARY },
  { type: 'transparant_deel_door',   display: 'Door',    w: 28, h: 28, color: '#bfdbfe',  border: '#2563EB' },
  { type: 'transparant_deel_window', display: 'Window',  w: 32, h: 10, color: '#bae6fd',  border: '#0284c7' },
  { type: 'dak',                     display: 'Roof',    w: 60, h: 60, color: 'rgba(30,58,95,0.08)', border: PRIMARY },
  { type: 'vloer',                   display: 'Floor',   w: 60, h: 60, color: 'rgba(30,58,95,0.04)', border: PRIMARY },
  { type: 'installatie',             display: 'Install', w: 30, h: 30, color: '#fef3c7',  border: '#D97706' },
];

const DB_TYPE: Record<ElementType, string> = {
  gevel:                   'gevel',
  transparant_deel_door:   'transparant_deel',
  transparant_deel_window: 'transparant_deel',
  dak:                     'dak',
  vloer:                   'vloer',
  installatie:             'installatie',
};

const TYPE_LABEL: Record<ElementType, string> = {
  gevel:                   'Wall',
  transparant_deel_door:   'Door',
  transparant_deel_window: 'Window',
  dak:                     'Roof',
  vloer:                   'Floor',
  installatie:             'Install',
};

const snap = (v: number) => Math.round(v / CELL_PX) * CELL_PX;
const uid  = () => Math.random().toString(36).slice(2);

function fitLines(raw: Zone['floor_plan_points']): { x1:number; y1:number; x2:number; y2:number }[] {
  if (!raw || raw.length < 3) return [];
  const xs = raw.map(p => p.x), ys = raw.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  const scale  = Math.min(INNER / rangeX, INNER / rangeY);
  const offX   = PADDING + (INNER - rangeX * scale) / 2;
  const offY   = PADDING + (INNER - rangeY * scale) / 2;
  const mapped = raw.map(p => ({ x: offX + (p.x - minX) * scale, y: offY + (p.y - minY) * scale }));
  return mapped.map((p, i) => { const n = mapped[(i + 1) % mapped.length]; return { x1: p.x, y1: p.y, x2: n.x, y2: n.y }; });
}

function ElementView({ el, selected }: { el: PlacedElement; selected: boolean }) {
  const palette = PALETTE.find(p => p.type === el.type)!;
  return (
    <View style={{
      position:        'absolute',
      left:            el.x,
      top:             el.y,
      width:           el.w,
      height:          el.h,
      backgroundColor: palette.color,
      borderWidth:     1.5,
      borderColor:     selected ? '#2563EB' : palette.border,
      borderRadius:    el.type === 'installatie' ? 4 : 2,
      opacity:         el.type === 'vloer' ? 0.7 : 1,
      transform:       [{ rotate: `${el.rotation}deg` }],
      alignItems:      'center',
      justifyContent:  'center',
    }}>
      {el.type === 'installatie' && (
        <Text style={{ fontSize: 14, color: '#D97706' }}>⚙</Text>
      )}
      {selected && (
        <View style={{
          position: 'absolute', top: -18, left: 0, right: 0, alignItems: 'center',
        }}>
          <Text style={{ fontSize: 8, color: '#374151', fontWeight: '700',
            backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 2, borderRadius: 2 }}>
            {el.label}
          </Text>
        </View>
      )}
    </View>
  );
}

interface Props {
  zones: Zone[];
  sessionId: string;
  onSaved: () => void;
}

export function ElementPlacer({ zones, sessionId, onSaved }: Props) {
  const { profile } = useAuthStore();
  const [activeZoneIdx, setActiveZoneIdx] = useState(0);
  const [elementsByZone, setElementsByZone] = useState<Record<string, PlacedElement[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [saving, setSaving] = useState(false);
  const countersRef = useRef<Record<string, number>>({});
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  if (zones.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>No zones found</Text>
        <Text style={styles.emptySub}>Go back and create at least one zone first.</Text>
      </View>
    );
  }

  const activeZone = zones[activeZoneIdx];
  const elements   = elementsByZone[activeZone.id] ?? [];
  // Floor plan outline is optional — shown when available, skipped otherwise
  const floorLines = fitLines(activeZone.floor_plan_points ?? null);

  const addElement = (p: PaletteItem) => {
    countersRef.current[p.type] = (countersRef.current[p.type] ?? 0) + 1;
    const n = countersRef.current[p.type];
    const label = `${TYPE_LABEL[p.type]}-${String(n).padStart(2, '0')}`;
    const el: PlacedElement = {
      id: uid(), type: p.type, label,
      x: snap(CANVAS / 2 - p.w / 2),
      y: snap(CANVAS / 2 - p.h / 2),
      w: p.w, h: p.h, rotation: 0,
    };
    setElementsByZone(prev => ({
      ...prev,
      [activeZone.id]: [...(prev[activeZone.id] ?? []), el],
    }));
    setSelectedId(el.id);
  };

  const makePan = (elId: string) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: () => {
      setSelectedId(elId);
      const el = (elementsByZone[activeZone.id] ?? []).find(e => e.id === elId);
      if (el) dragStartRef.current = { x: el.x, y: el.y };
    },
    onPanResponderMove: (_e, g: PanResponderGestureState) => {
      if (!dragStartRef.current) return;
      setElementsByZone(prev => {
        const list = [...(prev[activeZone!.id] ?? [])];
        const idx  = list.findIndex(e => e.id === elId);
        if (idx === -1) return prev;
        list[idx] = {
          ...list[idx],
          x: Math.max(0, Math.min(CANVAS - list[idx].w, snap(dragStartRef.current!.x + g.dx))),
          y: Math.max(0, Math.min(CANVAS - list[idx].h, snap(dragStartRef.current!.y + g.dy))),
        };
        return { ...prev, [activeZone!.id]: list };
      });
    },
    onPanResponderRelease: () => { dragStartRef.current = null; },
  });

  const rotateSelected = () => {
    if (!selectedId || !activeZone) return;
    setElementsByZone(prev => {
      const list = [...(prev[activeZone.id] ?? [])];
      const idx  = list.findIndex(e => e.id === selectedId);
      if (idx === -1) return prev;
      list[idx] = { ...list[idx], rotation: (list[idx].rotation + 45) % 360 };
      return { ...prev, [activeZone.id]: list };
    });
  };

  const deleteSelected = () => {
    if (!selectedId || !activeZone) return;
    setElementsByZone(prev => ({
      ...prev,
      [activeZone.id]: (prev[activeZone.id] ?? []).filter(e => e.id !== selectedId),
    }));
    setSelectedId(null);
  };

  const openRename = () => {
    const el = elements.find(e => e.id === selectedId);
    if (!el) return;
    setRenameText(el.label);
    setRenameTarget(el.id);
  };

  const applyRename = () => {
    if (!renameTarget || !renameText.trim() || !activeZone) return;
    setElementsByZone(prev => {
      const list = [...(prev[activeZone.id] ?? [])];
      const idx  = list.findIndex(e => e.id === renameTarget);
      if (idx !== -1) list[idx] = { ...list[idx], label: renameText.trim() };
      return { ...prev, [activeZone.id]: list };
    });
    setRenameTarget(null);
  };

  const saveAll = async () => {
    if (!profile || totalPlaced === 0) return;
    setSaving(true);

    // Build all rows first, then send as a single bulk insert so the operation
    // is atomic — a partial failure won't leave orphan rows in the DB.
    const rows = zones.flatMap(zone =>
      (elementsByZone[zone.id] ?? []).map((el, idx) => ({
        org_id:          profile.org_id,
        zone_id:         zone.id,
        element_type:    DB_TYPE[el.type],
        name:            el.label,
        orientation_deg: el.rotation,
        grid_x:          parseFloat((el.x / CANVAS).toFixed(4)),
        grid_y:          parseFloat((el.y / CANVAS).toFixed(4)),
        grid_w:          parseFloat((el.w / CANVAS).toFixed(4)),
        grid_h:          parseFloat((el.h / CANVAS).toFixed(4)),
        grid_rotation:   el.rotation,
        sort_order:      idx,
      }))
    );

    const { error } = await supabase.from('building_elements').insert(rows);
    if (error) { setSaving(false); Alert.alert('Could not save elements', error.message); return; }

    await supabase.from('inspection_sessions').update({ flow_stage: 6 }).eq('id', sessionId);
    setSaving(false);
    onSaved();
  };

  const totalPlaced = zones.reduce((n, z) => n + (elementsByZone[z.id]?.length ?? 0), 0);

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Place Elements</Text>
      <Text style={styles.sub}>Tap a type below to add it, then drag to position.</Text>

      {zones.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
          {zones.map((z, i) => (
            <TouchableOpacity key={z.id}
              style={[styles.tab, i === activeZoneIdx && styles.tabActive]}
              onPress={() => { setActiveZoneIdx(i); setSelectedId(null); }}>
              <Text style={[styles.tabTxt, i === activeZoneIdx && styles.tabTxtActive]}>
                {z.name} ({elementsByZone[z.id]?.length ?? 0})
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Canvas */}
      <View
        style={styles.canvas}
        onStartShouldSetResponder={() => true}
        onResponderGrant={() => setSelectedId(null)}
      >
        {/* Grid */}
        {Array.from({ length: GRID_N }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, styles.gridV, { left: i * CELL_PX }]} />
        ))}
        {Array.from({ length: GRID_N }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, styles.gridH, { top: i * CELL_PX }]} />
        ))}

        {/* Placeholder when no floor plan drawn for this zone */}
        {floorLines.length === 0 && elements.length === 0 && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                         alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', paddingHorizontal: 24 }}>
              No floor plan for this zone.{'\n'}Tap a type below to start placing elements.
            </Text>
          </View>
        )}

        {/* Floor plan outline */}
        {floorLines.map((seg, i) => {
          const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
          const len = Math.hypot(dx, dy);
          if (len < 1) return null;
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View key={i} style={{
              position: 'absolute', width: len, height: 1.5,
              backgroundColor: PRIMARY, opacity: 0.35,
              left: (seg.x1 + seg.x2) / 2 - len / 2,
              top:  (seg.y1 + seg.y2) / 2 - 0.75,
              transform: [{ rotate: `${angle}deg` }],
            }} />
          );
        })}

        {/* Placed elements — render each with its own PanResponder */}
        {elements.map(el => {
          const pan = makePan(el.id);
          return (
            <View
              key={el.id}
              style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h }}
              {...pan.panHandlers}
            >
              <ElementView el={{ ...el, x: 0, y: 0 }} selected={el.id === selectedId} />
            </View>
          );
        })}
      </View>

      {/* Selection actions */}
      {selectedId && (
        <View style={styles.selBar}>
          <TouchableOpacity style={styles.selBtn} onPress={openRename}>
            <Text style={styles.selBtnTxt}>✏ Rename</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selBtn} onPress={rotateSelected}>
            <Text style={styles.selBtnTxt}>↻ Rotate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.selBtn, styles.selBtnDanger]} onPress={deleteSelected}>
            <Text style={[styles.selBtnTxt, { color: '#EF4444' }]}>✕ Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Palette */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.palette}>
        {PALETTE.map(p => (
          <TouchableOpacity key={p.type} style={styles.chip} onPress={() => addElement(p)}>
            <Text style={styles.chipTxt}>+ {p.display}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Save */}
      <TouchableOpacity
        style={[styles.saveBtn, (saving || totalPlaced === 0) && styles.btnDis]}
        onPress={saveAll}
        disabled={saving || totalPlaced === 0}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.saveTxt}>
              {totalPlaced === 0
                ? 'Place at least one element to continue'
                : `Save ${totalPlaced} element${totalPlaced !== 1 ? 's' : ''} & Continue →`}
            </Text>}
      </TouchableOpacity>

      {/* Rename modal */}
      <Modal visible={!!renameTarget} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Rename Element</Text>
            <TextInput
              style={styles.modalInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={applyRename}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.btnSec} onPress={() => setRenameTarget(null)}>
                <Text style={styles.btnSecTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPri} onPress={applyRename}>
                <Text style={styles.btnPriTxt}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:        { flex: 1, padding: 16 },
  header:      { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  sub:         { fontSize: 13, color: '#6B7280', marginBottom: 10 },
  tabs:        { flexDirection: 'row', marginBottom: 10 },
  tab:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  tabActive:   { backgroundColor: PRIMARY },
  tabTxt:      { fontSize: 13, color: '#374151' },
  tabTxtActive:{ color: '#fff', fontWeight: '600' },
  canvas:      { width: CANVAS, height: CANVAS, alignSelf: 'center',
                 backgroundColor: '#fafafa', borderRadius: 8, overflow: 'hidden',
                 borderWidth: 1, borderColor: '#E5E7EB' },
  gridLine:    { position: 'absolute', backgroundColor: '#e5e7eb' },
  gridV:       { width: 1, height: CANVAS },
  gridH:       { height: 1, width: CANVAS },
  selBar:      { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 10 },
  selBtn:      { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
                 borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  selBtnDanger:{ borderColor: '#FCA5A5' },
  selBtnTxt:   { fontSize: 12, color: '#374151' },
  palette:     { flexDirection: 'row', marginTop: 12, marginBottom: 4 },
  chip:        { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                 backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', marginRight: 8 },
  chipTxt:     { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  saveBtn:     { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  saveTxt:     { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnDis:      { opacity: 0.45 },
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalBox:    { backgroundColor: '#fff', borderRadius: 14, padding: 24, width: 280 },
  modalTitle:  { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  modalInput:  { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12,
                 paddingVertical: 8, fontSize: 15, marginBottom: 16 },
  modalRow:    { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btnPri:      { backgroundColor: PRIMARY, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  btnPriTxt:   { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnSec:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB' },
  btnSecTxt:   { fontSize: 13, color: '#374151' },
  emptyWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: PRIMARY, marginBottom: 8, textAlign: 'center' },
  emptySub:    { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
});
