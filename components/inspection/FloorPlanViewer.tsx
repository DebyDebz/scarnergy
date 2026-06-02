import { useState } from 'react';
import {
  View, Text, Image, ScrollView,
  TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Zone } from '../../lib/supabase';

const PRIMARY = '#1E3A5F';
const CANVAS  = 300;
const CELL_PX = 20;
const PADDING = 12;
const INNER   = CANVAS - PADDING * 2;
const GRID_N  = Math.ceil(CANVAS / CELL_PX) + 1;

// Same projection used in GridCanvas / ElementPlacer
function fitLines(raw: Zone['floor_plan_points']): { x1: number; y1: number; x2: number; y2: number }[] {
  if (!raw || raw.length < 3) return [];
  const xs = raw.map(p => p.x), ys = raw.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rX = maxX - minX || 1, rY = maxY - minY || 1;
  const scale = Math.min(INNER / rX, INNER / rY);
  const offX  = PADDING + (INNER - rX * scale) / 2;
  const offY  = PADDING + (INNER - rY * scale) / 2;
  const mapped = raw.map(p => ({ x: offX + (p.x - minX) * scale, y: offY + (p.y - minY) * scale }));
  return mapped.map((p, i) => { const n = mapped[(i + 1) % mapped.length]; return { x1: p.x, y1: p.y, x2: n.x, y2: n.y }; });
}

interface Props {
  zones: Zone[];
  onContinue: () => void;
}

export function FloorPlanViewer({ zones, onContinue }: Props) {
  const zonesWithImage = zones.filter(z => z.floor_plan_image_url && z.floor_plan_scale_m);
  const [activeIdx, setActiveIdx] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);

  const activeZone = zonesWithImage[activeIdx];
  if (!activeZone) return null;

  const lines   = fitLines(activeZone.floor_plan_points ?? null);
  const scaleM  = activeZone.floor_plan_scale_m ?? 5;
  const cellM   = scaleM / (INNER / CELL_PX);

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Floor Plan</Text>
      <Text style={styles.sub}>Review the floor plan set up by your supervisor, then continue to place elements.</Text>

      {zonesWithImage.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
          {zonesWithImage.map((z, i) => (
            <TouchableOpacity
              key={z.id}
              style={[styles.tab, i === activeIdx && styles.tabActive]}
              onPress={() => { setActiveIdx(i); setImgLoaded(false); }}
            >
              <Text style={[styles.tabTxt, i === activeIdx && styles.tabTxtActive]}>{z.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Canvas */}
      <View style={styles.canvas}>
        {/* Floor plan image */}
        {activeZone.floor_plan_image_url && (
          <>
            {!imgLoaded && (
              <View style={styles.imgLoading}>
                <ActivityIndicator color={PRIMARY} />
              </View>
            )}
            <Image
              source={{ uri: activeZone.floor_plan_image_url }}
              style={[styles.img, imgLoaded ? styles.imgVisible : styles.imgHidden]}
              resizeMode="contain"
              onLoad={() => setImgLoaded(true)}
            />
          </>
        )}

        {/* Grid overlay */}
        {Array.from({ length: GRID_N }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, styles.gridV, { left: i * CELL_PX }]} />
        ))}
        {Array.from({ length: GRID_N }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, styles.gridH, { top: i * CELL_PX }]} />
        ))}

        {/* Polygon outline */}
        {lines.map((seg, i) => {
          const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
          const len = Math.hypot(dx, dy);
          if (len < 1) return null;
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View key={i} style={{
              position:        'absolute',
              width:           len,
              height:          2,
              backgroundColor: PRIMARY,
              opacity:         0.8,
              left:            (seg.x1 + seg.x2) / 2 - len / 2,
              top:             (seg.y1 + seg.y2) / 2 - 1,
              transform:       [{ rotate: `${angle}deg` }],
            }} />
          );
        })}

        {/* Scale labels */}
        {Array.from({ length: Math.floor(INNER / CELL_PX) + 1 }).map((_, i) => (
          <Text key={i} style={[styles.scaleLabel, { left: i * CELL_PX + 2, bottom: 2 }]}>
            {(i * cellM).toFixed(1)}
          </Text>
        ))}
      </View>

      {/* Scale info */}
      <View style={styles.infoRow}>
        <Text style={styles.infoTxt}>Width: <Text style={styles.infoBold}>{scaleM} m</Text></Text>
        <Text style={styles.infoTxt}>Grid cell: <Text style={styles.infoBold}>{cellM.toFixed(2)} m</Text></Text>
      </View>

      <TouchableOpacity style={styles.continueBtn} onPress={onContinue}>
        <Text style={styles.continueTxt}>Continue to Element Placement →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  header:      { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  sub:         { fontSize: 13, color: '#6B7280', marginBottom: 12 },
  tabs:        { flexDirection: 'row', marginBottom: 12 },
  tab:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  tabActive:   { backgroundColor: PRIMARY },
  tabTxt:      { fontSize: 13, color: '#374151' },
  tabTxtActive:{ color: '#fff', fontWeight: '600' },
  canvas:      { width: CANVAS, height: CANVAS, alignSelf: 'center',
                 backgroundColor: '#fafafa', borderRadius: 8, overflow: 'hidden',
                 borderWidth: 1, borderColor: '#E5E7EB' },
  img:         { position: 'absolute', top: 0, left: 0, width: CANVAS, height: CANVAS },
  imgVisible:  { opacity: 1 },
  imgHidden:   { opacity: 0 },
  imgLoading:  { position: 'absolute', top: 0, left: 0, width: CANVAS, height: CANVAS,
                 alignItems: 'center', justifyContent: 'center' },
  gridLine:    { position: 'absolute', backgroundColor: 'rgba(229,231,235,0.6)' },
  gridV:       { width: 1, height: CANVAS },
  gridH:       { height: 1, width: CANVAS },
  scaleLabel:  { position: 'absolute', fontSize: 7, color: '#9CA3AF' },
  infoRow:     { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 12 },
  infoTxt:     { fontSize: 12, color: '#6B7280' },
  infoBold:    { fontWeight: '700', color: PRIMARY },
  continueBtn: { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14,
                 alignItems: 'center', marginTop: 20 },
  continueTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
