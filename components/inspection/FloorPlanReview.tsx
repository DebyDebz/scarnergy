import { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Zone, BuildingElement } from '../../lib/supabase';
import { projectPointsOnImage, fitPointsToInner, imageOffsets, gridLengthMeters } from '../../lib/floorplanGeometry';
import { ClippedGrid } from './ClippedGrid';

/**
 * Stage 6 support — read-only gridded plan that renders placed elements at their
 * grid positions with each element's captured measurement shown ON the plan.
 * Tapping an element opens its measurement screen. Mirrors the geometry/scale of
 * GridCanvas (same CANVAS/CELL_PX and shared projection) so the plan looks
 * identical to where the elements were placed.
 */

const PRIMARY = '#1E3A5F';
const CANVAS   = 300;
const PADDING  = 12;
const CELL_PX  = 20;

// Element box colours per type (mirrors ElementPlacer palette intent).
const TYPE_COLOR: Record<string, { bg: string; border: string }> = {
  gevel:            { bg: 'rgba(30,58,95,0.20)',   border: '#1E3A5F' },
  transparant_deel: { bg: 'rgba(46,134,193,0.22)', border: '#2E86C1' },
  vloer:            { bg: 'rgba(156,163,175,0.18)', border: '#9CA3AF' },
  dak:              { bg: 'rgba(180,83,9,0.18)',    border: '#B45309' },
  installatie:      { bg: 'rgba(217,119,6,0.20)',   border: '#D97706' },
};

// First captured dimension, in metres — what we show next to the element.
function primaryMeters(el: BuildingElement): string | null {
  const mm = el.length_mm ?? el.width_mm ?? el.height_mm;
  return mm != null ? `${(mm / 1000).toFixed(2)}m` : null;
}

interface Props {
  zone: Zone;
  elements: BuildingElement[];
  onMeasure: (elementId: string) => void;
}

export function FloorPlanReview({ zone, elements, onMeasure }: Props) {
  const hasImage = !!zone.floor_plan_image_url;
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgDims,   setImgDims]   = useState<{ w: number; h: number } | null>(null);

  // Outline points: image-anchored when the photo dims are known, bbox-fit otherwise.
  const outlinePts = hasImage && imgDims
    ? projectPointsOnImage(zone.floor_plan_points, imgDims, CANVAS)
    : fitPointsToInner(zone.floor_plan_points, CANVAS, PADDING);
  // Elements share the outline's frame: image-relative grid_* are shifted by the
  // same contain-fit letterbox so they land on the photo (blank zones → {0,0}).
  const { offX, offY } = hasImage && imgDims ? imageOffsets(imgDims, CANVAS) : { offX: 0, offY: 0 };

  const scaleM = zone.floor_plan_scale_m ?? null;
  // floor_plan_scale_m = metres across the full canvas width.
  const cellM  = scaleM != null ? (CELL_PX / CANVAS) * scaleM : null;
  const placed = elements.filter(e => e.grid_x != null && e.grid_y != null);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Floor Plan — {zone.name}</Text>
      <Text style={styles.sub}>Tap an element on the plan to measure it. Captured values are shown in place.</Text>

      <View style={styles.canvas}>
        {/* Background image (image-upload zones) */}
        {hasImage && (
          <>
            {!imgLoaded && (
              <View style={styles.imgLoading}><ActivityIndicator color={PRIMARY} /></View>
            )}
            <Image
              source={{ uri: zone.floor_plan_image_url! }}
              style={[styles.img, imgLoaded ? styles.imgVisible : styles.imgHidden]}
              resizeMode="contain"
              onLoad={(e) => {
                const s = e.nativeEvent?.source;
                if (s?.width && s?.height) setImgDims({ w: s.width, h: s.height });
                setImgLoaded(true);
              }}
            />
          </>
        )}

        {/* Grid clipped to the footprint outline (full grid when not yet traced) */}
        <ClippedGrid size={CANVAS} cellPx={CELL_PX} points={outlinePts} />

        {/* Elements (tappable) */}
        {placed.map(el => {
          const x = offX + el.grid_x! * CANVAS, y = offY + el.grid_y! * CANVAS;
          const w = Math.max((el.grid_w ?? 0.04) * CANVAS, 8);
          const h = Math.max((el.grid_h ?? 0.04) * CANVAS, 8);
          const col = TYPE_COLOR[el.element_type] ?? TYPE_COLOR.gevel;
          return (
            <TouchableOpacity
              key={el.id}
              activeOpacity={0.7}
              onPress={() => onMeasure(el.id)}
              style={{
                position: 'absolute', left: x, top: y, width: w, height: h,
                backgroundColor: col.bg, borderWidth: 1.5,
                borderColor: el.is_complete ? '#1E8449' : col.border, borderRadius: 2,
                transform: [{ rotate: `${el.grid_rotation ?? 0}deg` }],
              }}
            />
          );
        })}

        {/* Name + value chips at each element centre. Captured value when measured;
            otherwise the scale-derived suggestion ("~1.20m") so the inspector
            sees the plan's own measurement before capturing. */}
        {placed.map(el => {
          const captured  = primaryMeters(el);
          const suggested = captured == null ? gridLengthMeters(el.grid_w, scaleM) : null;
          const value = captured ?? (suggested != null ? `~${suggested.toFixed(2)}m` : null);
          const cx = offX + (el.grid_x! + (el.grid_w ?? 0.04) / 2) * CANVAS;
          const cy = offY + (el.grid_y! + (el.grid_h ?? 0.04) / 2) * CANVAS;
          return (
            <View key={`c${el.id}`} pointerEvents="none"
              style={[styles.chipWrap, { left: cx - 40, top: cy - 10 }]}>
              <View style={[styles.chip, suggested != null && styles.chipSuggested]}>
                <Text style={styles.chipName} numberOfLines={1}>{el.name}</Text>
                {value != null && <Text style={styles.chipTxt}>{value}</Text>}
              </View>
            </View>
          );
        })}
      </View>

      {/* Scale + progress footer */}
      <View style={styles.infoRow}>
        {cellM != null && <Text style={styles.infoTxt}>Grid cell: <Text style={styles.infoBold}>{cellM.toFixed(2)} m</Text></Text>}
        <Text style={styles.infoTxt}>
          Measured: <Text style={styles.infoBold}>{placed.filter(e => e.is_complete).length}/{placed.length}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:       { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12,
                elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  title:      { fontSize: 15, fontWeight: '700', color: PRIMARY },
  sub:        { fontSize: 12, color: '#6B7280', marginTop: 2, marginBottom: 12 },
  canvas:     { width: CANVAS, height: CANVAS, alignSelf: 'center',
                backgroundColor: '#fafafa', borderRadius: 8, overflow: 'hidden',
                borderWidth: 1, borderColor: '#E5E7EB' },
  img:        { position: 'absolute', top: 0, left: 0, width: CANVAS, height: CANVAS },
  imgVisible: { opacity: 1 },
  imgHidden:  { opacity: 0 },
  imgLoading: { position: 'absolute', top: 0, left: 0, width: CANVAS, height: CANVAS,
                alignItems: 'center', justifyContent: 'center' },
  chipWrap:   { position: 'absolute', width: 80, alignItems: 'center' },
  chip:       { backgroundColor: 'rgba(30,58,95,0.92)', alignItems: 'center',
                borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, maxWidth: 80 },
  chipSuggested: { backgroundColor: 'rgba(107,114,128,0.85)' },
  chipName:   { fontSize: 8, color: '#fff', fontWeight: '700' },
  chipTxt:    { fontSize: 8, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  infoRow:    { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 12 },
  infoTxt:    { fontSize: 12, color: '#6B7280' },
  infoBold:   { fontWeight: '700', color: PRIMARY },
});
