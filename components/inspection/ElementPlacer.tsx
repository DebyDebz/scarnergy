import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  TextInput, StyleSheet, Alert, ActivityIndicator,
  PanResponder, PanResponderGestureState, Image,
} from 'react-native';
import { supabase, Zone } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { isPointInPolygon } from '../../lib/geometry';
import {
  projectPointsOnImage, fitPointsToInner, imageOffsets, unprojectPoint, Offsets,
} from '../../lib/floorplanGeometry';
import { ClippedGrid } from './ClippedGrid';

const PRIMARY  = '#1E3A5F';
const CANVAS   = 300;
const CELL_PX  = 20;
const PADDING  = 12;

type ElementType = 'gevel' | 'transparant_deel_door' | 'transparant_deel_window' | 'dak' | 'dakkapel' | 'vloer' | 'installatie';

interface PlacedElement {
  id: string;
  dbId?: string;   // UUID from building_elements row, present for loaded elements
  type: ElementType; label: string;
  x: number; y: number; w: number; h: number; rotation: number;
}

interface PaletteItem { type: ElementType; display: string; w: number; h: number; color: string; border: string }

const PALETTE: PaletteItem[] = [
  { type: 'gevel',                   display: 'Wall',    w: 60, h: 8,  color: PRIMARY,    border: PRIMARY },
  { type: 'transparant_deel_door',   display: 'Door',    w: 28, h: 28, color: '#bfdbfe',  border: '#2563EB' },
  { type: 'transparant_deel_window', display: 'Window',  w: 32, h: 10, color: '#bae6fd',  border: '#0284c7' },
  { type: 'dak',                     display: 'Roof',    w: 60, h: 60, color: 'rgba(30,58,95,0.08)', border: PRIMARY },
  { type: 'dakkapel',                display: 'Dormer',  w: 26, h: 26, color: '#ccfbf1',  border: '#0d9488' },
  { type: 'vloer',                   display: 'Floor',   w: 60, h: 60, color: 'rgba(30,58,95,0.04)', border: PRIMARY },
  { type: 'installatie',             display: 'Install', w: 30, h: 30, color: '#fef3c7',  border: '#D97706' },
];

const DB_TYPE: Record<ElementType, string> = {
  gevel:                   'gevel',
  transparant_deel_door:   'transparant_deel',
  transparant_deel_window: 'transparant_deel',
  dak:                     'dak',
  dakkapel:                'dakkapel',
  vloer:                   'vloer',
  installatie:             'installatie',
};

const TYPE_LABEL: Record<ElementType, string> = {
  gevel:                   'Wall',
  transparant_deel_door:   'Door',
  transparant_deel_window: 'Window',
  dak:                     'Roof',
  dakkapel:                'Dormer',
  vloer:                   'Floor',
  installatie:             'Install',
};

// Maps a DB row back to the UI ElementType.
// transparant_deel is used for both Door and Window — distinguish by name prefix.
function dbRowToElementType(dbType: string, name: string): ElementType {
  if (dbType === 'transparant_deel') {
    return name.toLowerCase().startsWith('door') ? 'transparant_deel_door' : 'transparant_deel_window';
  }
  if (dbType === 'dakkapel') return 'dakkapel';
  return dbType as ElementType;
}

// Default pixel size for an element type when restoring from DB
// (grid_w/h are already stored, but PALETTE sizes are used as fallback)
function paletteSize(type: ElementType): { w: number; h: number } {
  const p = PALETTE.find(x => x.type === type);
  return p ? { w: p.w, h: p.h } : { w: 30, h: 30 };
}

const snap = (v: number) => Math.round(v / CELL_PX) * CELL_PX;
const uid  = () => Math.random().toString(36).slice(2);

function DoorSwingArc({ size }: { size: number }) {
  // Render a quarter-circle "swing" arc using a bordered corner
  const r = size * 0.72;
  return (
    <View pointerEvents="none" style={{
      position: 'absolute', bottom: 0, left: 0,
      width: r, height: r,
      borderBottomWidth: 1.5, borderLeftWidth: 1.5,
      borderColor: '#2563EB',
      borderBottomLeftRadius: r,
      opacity: 0.7,
    }} />
  );
}

function ElementView({ el, selected }: { el: PlacedElement; selected: boolean }) {
  const palette = PALETTE.find(p => p.type === el.type)!;
  const isDoor  = el.type === 'transparant_deel_door';
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
      overflow:        'hidden',
    }}>
      {isDoor && <DoorSwingArc size={Math.min(el.w, el.h)} />}
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
  const [loadingElements, setLoadingElements] = useState(true);
  // Intrinsic image dims per zone (from Image.getSize) → contain-fit offsets, so
  // image-relative grid_* project onto the photo exactly where the outline does.
  const [dimsByZone, setDimsByZone] = useState<Record<string, { w: number; h: number }>>({});
  const [ghostPos, setGhostPos]       = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [canUndo, setCanUndo]         = useState(false);
  const countersRef  = useRef<Record<string, number>>({});
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // History stack: up to 20 snapshots per zone, keyed by zoneId
  const historyRef   = useRef<Record<string, PlacedElement[][]>>({});
  const MAX_HISTORY  = 20;

  const pushHistory = (zoneId: string, state: PlacedElement[]) => {
    const stack = historyRef.current[zoneId] ?? [];
    historyRef.current[zoneId] = [...stack.slice(-MAX_HISTORY + 1), [...state]];
    setCanUndo(true);
  };

  // ─── Load existing elements from DB on mount ────────────────────────────
  // Resolve each image zone's intrinsic dims first (so grid_* can be projected
  // into the image's contain-fit frame), then fetch and place the elements.
  useEffect(() => {
    if (zones.length === 0) { setLoadingElements(false); return; }
    let cancelled = false;

    const resolveDims = (): Promise<Record<string, { w: number; h: number }>> =>
      Promise.all(
        zones.map(z => new Promise<[string, { w: number; h: number } | null]>(resolve => {
          if (!z.floor_plan_image_url) { resolve([z.id, null]); return; }
          Image.getSize(
            z.floor_plan_image_url,
            (w, h) => resolve([z.id, { w, h }]),
            () => resolve([z.id, null]),  // unreachable image → blank-frame fallback
          );
        })),
      ).then(pairs => {
        const out: Record<string, { w: number; h: number }> = {};
        for (const [id, dims] of pairs) if (dims) out[id] = dims;
        return out;
      });

    (async () => {
      const dims = await resolveDims();
      if (cancelled) return;
      setDimsByZone(dims);

      const { data } = await supabase
        .from('building_elements')
        .select('id, element_type, name, grid_x, grid_y, grid_w, grid_h, grid_rotation, sort_order, zone_id')
        .in('zone_id', zones.map(z => z.id))
        .eq('is_active', true)
        .order('sort_order');
      if (cancelled) return;
      if (!data || data.length === 0) { setLoadingElements(false); return; }

      const offsetsFor = (zoneId: string): Offsets =>
        dims[zoneId] ? imageOffsets(dims[zoneId], CANVAS) : { offX: 0, offY: 0 };

      const byZone: Record<string, PlacedElement[]> = {};
      const counters: Record<string, number> = {};

      for (const row of data) {
        const type = dbRowToElementType(row.element_type, row.name);
        const fallback = paletteSize(type);
        const off = offsetsFor(row.zone_id);
        const w = row.grid_w != null ? Math.round(row.grid_w * CANVAS) : fallback.w;
        const h = row.grid_h != null ? Math.round(row.grid_h * CANVAS) : fallback.h;
        const el: PlacedElement = {
          id:       uid(),
          dbId:     row.id,
          type,
          label:    row.name,
          x:        row.grid_x != null ? Math.round(off.offX + row.grid_x * CANVAS) : 0,
          y:        row.grid_y != null ? Math.round(off.offY + row.grid_y * CANVAS) : 0,
          w,
          h,
          rotation: row.grid_rotation ?? 0,
        };
        if (!byZone[row.zone_id]) byZone[row.zone_id] = [];
        byZone[row.zone_id].push(el);

        // Seed counters so new elements continue from the right number
        // e.g. "Wall-03" → counters.gevel = max(3, current)
        const match = row.name.match(/-(\d+)$/);
        if (match) {
          const n = parseInt(match[1], 10);
          counters[row.element_type] = Math.max(counters[row.element_type] ?? 0, n);
        }
      }

      countersRef.current = counters;
      setElementsByZone(byZone);
      setLoadingElements(false);
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — zones identity is stable on mount

  if (zones.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>No zones found</Text>
        <Text style={styles.emptySub}>Go back and create at least one zone first.</Text>
      </View>
    );
  }

  if (loadingElements) {
    return (
      <View style={styles.emptyWrap}>
        <ActivityIndicator color={PRIMARY} size="large" />
        <Text style={styles.emptySub}>Loading elements…</Text>
      </View>
    );
  }

  const activeZone = zones[activeZoneIdx];
  const elements   = elementsByZone[activeZone.id] ?? [];

  // Outline + element frame for the active zone. Image-anchored (projected onto
  // the photo) when the zone has an image and its dims are resolved; bbox-fit
  // otherwise. Both the boundary polygon and placed elements use this frame, so
  // dragging, the grid clip and the photo all stay aligned.
  const activeDims = dimsByZone[activeZone.id];
  const hasImage   = !!activeZone.floor_plan_image_url && !!activeDims;
  const activeOff: Offsets = hasImage ? imageOffsets(activeDims!, CANVAS) : { offX: 0, offY: 0 };

  // Pixel-space polygon for the active zone (outline render + boundary checks).
  const polygonPixelPts = hasImage
    ? projectPointsOnImage(activeZone.floor_plan_points ?? null, activeDims!, CANVAS)
    : fitPointsToInner(activeZone.floor_plan_points ?? null, CANVAS, PADDING);

  // Floor plan outline is optional — shown when available, skipped otherwise.
  const floorLines = polygonPixelPts.length >= 3
    ? polygonPixelPts.map((p, i) => {
        const n = polygonPixelPts[(i + 1) % polygonPixelPts.length];
        return { x1: p.x, y1: p.y, x2: n.x, y2: n.y };
      })
    : [];

  const addElement = (p: PaletteItem) => {
    pushHistory(activeZone.id, elementsByZone[activeZone.id] ?? []);
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
      if (el) {
        dragStartRef.current = { x: el.x, y: el.y };
        // Snapshot before the drag starts so undo restores pre-drag state
        pushHistory(activeZone.id, elementsByZone[activeZone.id] ?? []);
      }
    },
    onPanResponderMove: (_e, g: PanResponderGestureState) => {
      const start = dragStartRef.current;
      if (!start) return;
      setElementsByZone(prev => {
        const list = [...(prev[activeZone!.id] ?? [])];
        const idx  = list.findIndex(e => e.id === elId);
        if (idx === -1) return prev;
        const nx = Math.max(0, Math.min(CANVAS - list[idx].w, snap(start.x + g.dx)));
        const ny = Math.max(0, Math.min(CANVAS - list[idx].h, snap(start.y + g.dy)));
        list[idx] = { ...list[idx], x: nx, y: ny };
        // Update ghost to show snap target
        setGhostPos({ x: nx, y: ny, w: list[idx].w, h: list[idx].h });
        return { ...prev, [activeZone!.id]: list };
      });
    },
    onPanResponderRelease: (_e, g: PanResponderGestureState) => {
      setGhostPos(null);
      dragStartRef.current = null;

      // Boundary enforcement: if element center is outside the polygon, snap back
      if (polygonPixelPts.length >= 3) {
        setElementsByZone(prev => {
          const list = [...(prev[activeZone!.id] ?? [])];
          const idx  = list.findIndex(e => e.id === elId);
          if (idx === -1) return prev;
          const el  = list[idx];
          const cx  = el.x + el.w / 2;
          const cy  = el.y + el.h / 2;
          if (!isPointInPolygon(cx, cy, polygonPixelPts)) {
            // Restore the snapshot taken at grant time
            const stack = historyRef.current[activeZone!.id] ?? [];
            if (stack.length > 0) {
              Alert.alert('Outside boundary', 'Element moved back inside the floor plan.');
              return { ...prev, [activeZone!.id]: stack[stack.length - 1] };
            }
          }
          return prev;
        });
      }
    },
  });

  const rotateSelected = () => {
    if (!selectedId || !activeZone) return;
    pushHistory(activeZone.id, elementsByZone[activeZone.id] ?? []);
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
    pushHistory(activeZone.id, elementsByZone[activeZone.id] ?? []);
    setElementsByZone(prev => ({
      ...prev,
      [activeZone.id]: (prev[activeZone.id] ?? []).filter(e => e.id !== selectedId),
    }));
    setSelectedId(null);
  };

  const undoLast = () => {
    if (!activeZone) return;
    const stack = historyRef.current[activeZone.id];
    if (!stack || stack.length === 0) return;
    const prev = stack[stack.length - 1];
    const remaining = stack.slice(0, -1);
    historyRef.current[activeZone.id] = remaining;
    setElementsByZone(s => ({ ...s, [activeZone.id]: prev }));
    setSelectedId(null);
    setCanUndo(remaining.length > 0);
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

    // Zones that have at least one element on the canvas
    const dirtyZoneIds = zones
      .filter(z => (elementsByZone[z.id]?.length ?? 0) > 0)
      .map(z => z.id);

    // Step 1: soft-delete all currently active elements for those zones.
    // Using is_active=false (not hard-delete) so any existing measurements
    // referencing old element IDs stay intact in the audit trail.
    const { error: delErr } = await supabase
      .from('building_elements')
      .update({ is_active: false })
      .in('zone_id', dirtyZoneIds);
    if (delErr) { setSaving(false); Alert.alert('Could not update elements', delErr.message); return; }

    // Step 2: bulk-insert the current canvas state for all zones. Element px are
    // stored back in the zone's frame: image-relative (de-offset by the same
    // contain-fit letterbox) for image zones, raw fraction for blank zones.
    const rows = zones.flatMap(zone => {
      const off: Offsets = dimsByZone[zone.id]
        ? imageOffsets(dimsByZone[zone.id], CANVAS)
        : { offX: 0, offY: 0 };
      return (elementsByZone[zone.id] ?? []).map((el, idx) => {
        const g = unprojectPoint({ x: el.x, y: el.y }, CANVAS, off);
        return {
          org_id:          profile.org_id,
          zone_id:         zone.id,
          element_type:    DB_TYPE[el.type],
          name:            el.label,
          orientation_deg: el.rotation,
          grid_x:          parseFloat(g.x.toFixed(4)),
          grid_y:          parseFloat(g.y.toFixed(4)),
          grid_w:          parseFloat((el.w / CANVAS).toFixed(4)),
          grid_h:          parseFloat((el.h / CANVAS).toFixed(4)),
          grid_rotation:   el.rotation,
          sort_order:      idx,
        };
      });
    });

    const { error: insErr } = await supabase.from('building_elements').insert(rows);
    if (insErr) { setSaving(false); Alert.alert('Could not save elements', insErr.message); return; }

    // Link dakkapel elements to their parent dak in each zone
    const hasDakkapel = rows.some(r => r.element_type === 'dakkapel');
    if (hasDakkapel) {
      const { data: dakRows } = await supabase
        .from('building_elements')
        .select('id, zone_id')
        .in('zone_id', dirtyZoneIds)
        .eq('element_type', 'dak')
        .eq('is_active', true);
      const dakByZone: Record<string, string> = {};
      for (const d of dakRows ?? []) dakByZone[d.zone_id] = d.id;
      for (const zone of zones) {
        const dakId = dakByZone[zone.id];
        if (!dakId) continue;
        await supabase.from('building_elements')
          .update({ parent_element_id: dakId })
          .eq('zone_id', zone.id)
          .eq('element_type', 'dakkapel')
          .eq('is_active', true);
      }
    }

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
              onPress={() => { setActiveZoneIdx(i); setSelectedId(null); setCanUndo((historyRef.current[z.id]?.length ?? 0) > 0); }}>
              <Text style={[styles.tabTxt, i === activeZoneIdx && styles.tabTxtActive]}>
                {z.name} ({elementsByZone[z.id]?.length ?? 0})
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Canvas — fills remaining space between header and bottom controls */}
      <View style={styles.canvasWrap}>
      <View
        style={styles.canvas}
        onStartShouldSetResponder={() => true}
        onResponderGrant={() => setSelectedId(null)}
      >
        {/* Floor plan photo (image-upload zones) — placed elements and the grid
            project into this image's contain-fit frame so they sit on the plan. */}
        {activeZone.floor_plan_image_url && (
          <Image
            key={activeZone.id}
            source={{ uri: activeZone.floor_plan_image_url }}
            style={styles.bgImg}
            resizeMode="contain"
          />
        )}

        {/* Grid clipped to the footprint (full grid when no plan). Outline kept
            separate below to preserve the existing subtle look. */}
        <ClippedGrid size={CANVAS} cellPx={CELL_PX} points={polygonPixelPts} gridColor="#e5e7eb" showOutline={false} />

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

        {/* Snapping ghost — semi-transparent target shown while dragging */}
        {ghostPos && (
          <View pointerEvents="none" style={{
            position: 'absolute',
            left: ghostPos.x, top: ghostPos.y,
            width: ghostPos.w, height: ghostPos.h,
            borderWidth: 2, borderColor: '#2563EB',
            borderStyle: 'dashed', borderRadius: 3,
            backgroundColor: 'rgba(37,99,235,0.12)',
          }} />
        )}

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
      </View>

      {/* ── Bottom controls — always visible ── */}
      <View style={styles.bottomControls}>
        {/* Undo — visible when there is something to undo */}
        {canUndo && (
          <View style={styles.undoBar}>
            <TouchableOpacity style={styles.undoBtn} onPress={undoLast}>
              <Text style={styles.undoBtnTxt}>↩ Undo</Text>
            </TouchableOpacity>
          </View>
        )}

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

        {/* Palette chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.paletteContent}
          style={styles.palette}
        >
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
      </View>

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
  wrap:           { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0 },
  header:         { fontSize: 18, fontWeight: '700', color: PRIMARY, marginBottom: 2 },
  sub:            { fontSize: 12, color: '#6B7280', marginBottom: 8 },
  tabs:           { flexDirection: 'row', marginBottom: 8 },
  tab:            { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  tabActive:      { backgroundColor: PRIMARY },
  tabTxt:         { fontSize: 13, color: '#374151' },
  tabTxtActive:   { color: '#fff', fontWeight: '600' },
  // canvasWrap: fills remaining flex space, centers the canvas inside
  canvasWrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  canvas:         { width: CANVAS, height: CANVAS,
                    backgroundColor: '#fafafa', borderRadius: 8, overflow: 'hidden',
                    borderWidth: 1, borderColor: '#E5E7EB' },
  bgImg:          { position: 'absolute', top: 0, left: 0, width: CANVAS, height: CANVAS },
  // bottomControls: sticks to the bottom, never clipped
  bottomControls: { paddingBottom: 16, paddingTop: 4 },
  undoBar:        { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  undoBtn:        { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8,
                    borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  undoBtnTxt:     { fontSize: 12, color: '#374151' },
  selBar:         { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 8 },
  selBtn:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
                    borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  selBtnDanger:   { borderColor: '#FCA5A5' },
  selBtnTxt:      { fontSize: 12, color: '#374151' },
  palette:        { marginBottom: 8 },
  paletteContent: { flexDirection: 'row', paddingVertical: 2 },
  chip:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                    backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', marginRight: 8 },
  chipTxt:        { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  saveBtn:        { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveTxt:        { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnDis:         { opacity: 0.45 },
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
