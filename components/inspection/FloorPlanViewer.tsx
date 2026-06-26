import { useState } from 'react';
import {
  View, Text, Image, ScrollView,
  TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Zone } from '../../lib/supabase';
import { projectPointsOnImage, fitPointsToInner } from '../../lib/floorplanGeometry';
import { ClippedGrid } from './ClippedGrid';

const PRIMARY = '#1E3A5F';
const CANVAS  = 300;
const CELL_PX = 20;
const PADDING = 12;
const INNER   = CANVAS - PADDING * 2;

interface Props {
  zones: Zone[];
  onContinue: () => void;
}

export function FloorPlanViewer({ zones, onContinue }: Props) {
  const zonesWithImage = zones.filter(z => z.floor_plan_image_url && z.floor_plan_scale_m);
  const [activeIdx, setActiveIdx] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgDims,   setImgDims]   = useState<{ w: number; h: number } | null>(null);

  const activeZone = zonesWithImage[activeIdx];
  if (!activeZone) return null;

  // Overlay the outline using the image's real proportions; bbox-fit only as a
  // pre-load fallback so it's never blank.
  const outlinePts = imgDims
    ? projectPointsOnImage(activeZone.floor_plan_points ?? null, imgDims, CANVAS)
    : fitPointsToInner(activeZone.floor_plan_points ?? null, CANVAS, PADDING);
  const scaleM  = activeZone.floor_plan_scale_m ?? 5;
  // floor_plan_scale_m = metres across the full canvas width.
  const cellM   = (CELL_PX / CANVAS) * scaleM;

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
              onPress={() => { setActiveIdx(i); setImgLoaded(false); setImgDims(null); }}
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
              onLoad={(e) => {
                const src = e.nativeEvent?.source;
                if (src?.width && src?.height) setImgDims({ w: src.width, h: src.height });
                setImgLoaded(true);
              }}
            />
          </>
        )}

        {/* Grid clipped to the footprint outline (full grid when not yet traced) */}
        <ClippedGrid size={CANVAS} cellPx={CELL_PX} points={outlinePts} gridColor="rgba(229,231,235,0.6)" />

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
  scaleLabel:  { position: 'absolute', fontSize: 7, color: '#9CA3AF' },
  infoRow:     { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 12 },
  infoTxt:     { fontSize: 12, color: '#6B7280' },
  infoBold:    { fontWeight: '700', color: PRIMARY },
  continueBtn: { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14,
                 alignItems: 'center', marginTop: 20 },
  continueTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
