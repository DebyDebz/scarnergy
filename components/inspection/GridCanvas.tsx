import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator,
  ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase, Zone } from '../../lib/supabase';
import { projectPointsOnImage, fitPointsToInner } from '../../lib/floorplanGeometry';
import { ClippedGrid } from './ClippedGrid';

const PRIMARY  = '#1E3A5F';
const CANVAS   = 300;
const PADDING  = 12;
const INNER    = CANVAS - PADDING * 2;
const CELL_PX  = 20;

interface Props {
  zones: Zone[];
  onConfirmed: (updatedZones: Zone[]) => void;
}

export function GridCanvas({ zones, onConfirmed }: Props) {
  const zonesWithPlan = zones.filter(z => z.floor_plan_points && z.floor_plan_points.length >= 3);
  const [activeIdx, setActiveIdx] = useState(0);
  const [scaleInputs, setScaleInputs] = useState<Record<string, string>>(
    Object.fromEntries(zonesWithPlan.map(z => [z.id, z.floor_plan_scale_m?.toString() ?? '5']))
  );
  const [saving, setSaving] = useState(false);
  // Image background state (per active zone) — learned from Image.onLoad.
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgDims,   setImgDims]   = useState<{ w: number; h: number } | null>(null);

  const activeZone = zonesWithPlan[activeIdx];
  if (!activeZone) return null;

  // Image zones project the outline through the same contain transform as the
  // displayed image (once its dims are known); bbox-fit is the pre-load fallback
  // so it's never blank. No-image zones keep the original bbox-fit behaviour.
  const hasImage = !!activeZone.floor_plan_image_url;
  const outlinePts = hasImage && imgDims
    ? projectPointsOnImage(activeZone.floor_plan_points, imgDims, CANVAS)
    : fitPointsToInner(activeZone.floor_plan_points, CANVAS, PADDING);
  const scaleM = parseFloat(scaleInputs[activeZone.id] || '5') || 5;
  const cellM  = scaleM / (INNER / CELL_PX);

  const confirm = async () => {
    setSaving(true);
    const updates = zonesWithPlan.map(z =>
      supabase.from('zones')
        .update({ floor_plan_scale_m: parseFloat(scaleInputs[z.id] || '5') || 5 })
        .eq('id', z.id)
    );
    const results = await Promise.all(updates);
    setSaving(false);
    const err = results.find(r => r.error)?.error;
    if (err) { Alert.alert('Could not save scale', err.message); return; }
    const updated = zones.map(z => {
      const zw = zonesWithPlan.find(x => x.id === z.id);
      return zw ? { ...z, floor_plan_scale_m: parseFloat(scaleInputs[z.id] || '5') || 5 } : z;
    });
    onConfirmed(updated);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>Grid Analysis</Text>
        <Text style={styles.sub}>Confirm the floor plan and set the real-world scale.</Text>

        {zonesWithPlan.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
            {zonesWithPlan.map((z, i) => (
              <TouchableOpacity key={z.id}
                style={[styles.tab, i === activeIdx && styles.tabActive]}
                onPress={() => { setActiveIdx(i); setImgLoaded(false); setImgDims(null); }}>
                <Text style={[styles.tabTxt, i === activeIdx && styles.tabTxtActive]}>{z.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Canvas */}
        <View style={styles.canvas}>
          {/* Floor plan image background (image-upload zones only) */}
          {hasImage && (
            <>
              {!imgLoaded && (
                <View style={styles.imgLoading}>
                  <ActivityIndicator color={PRIMARY} />
                </View>
              )}
              <Image
                source={{ uri: activeZone.floor_plan_image_url! }}
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
          <ClippedGrid size={CANVAS} cellPx={CELL_PX} points={outlinePts} gridColor="#e5e7eb" />

          {/* Scale labels */}
          {Array.from({ length: Math.floor(INNER / CELL_PX) + 1 }).map((_, i) => (
            <Text key={i} style={[styles.gridLabel, { left: i * CELL_PX + 2, bottom: 2 }]}>
              {(i * cellM).toFixed(1)}
            </Text>
          ))}
        </View>

        <View style={styles.scaleRow}>
          <Text style={styles.scaleLbl}>Width of this zone:</Text>
          <TextInput
            style={[
              styles.scaleInput,
              (() => {
                const v = parseFloat(scaleInputs[activeZone.id] || '');
                return !isNaN(v) && (v < 0.5 || v > 200) ? styles.scaleInputWarn : null;
              })(),
            ]}
            value={scaleInputs[activeZone.id]}
            onChangeText={v => setScaleInputs(prev => ({ ...prev, [activeZone.id]: v }))}
            keyboardType="decimal-pad"
            placeholder="5"
            returnKeyType="done"
          />
          <Text style={styles.scaleUnit}>metres</Text>
        </View>

        {(() => {
          const v = parseFloat(scaleInputs[activeZone.id] || '');
          return !isNaN(v) && (v < 0.5 || v > 200) ? (
            <Text style={styles.scaleWarnTxt}>
              ⚠ Value seems outside normal range (0.5–200 m). Please verify.
            </Text>
          ) : null;
        })()}

        <TouchableOpacity
          style={[styles.confirmBtn, saving && styles.btnDis]}
          onPress={confirm} disabled={saving}>
          <Text style={styles.confirmTxt}>{saving ? 'Saving…' : 'Confirm Grid →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex:        { flex: 1 },
  wrap:        { padding: 16, paddingBottom: 32 },
  header:      { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  sub:         { fontSize: 13, color: '#6B7280', marginBottom: 12 },
  tabs:        { flexDirection: 'row', marginBottom: 12 },
  tab:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                 backgroundColor: '#F3F4F6', marginRight: 8 },
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
  gridLabel:   { position: 'absolute', fontSize: 7, color: '#9CA3AF' },
  scaleRow:    { flexDirection: 'row', alignItems: 'center', gap: 10,
                 marginTop: 16, justifyContent: 'center' },
  scaleLbl:    { fontSize: 14, color: '#374151' },
  scaleInput:  { width: 70, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
                 paddingHorizontal: 10, paddingVertical: 6, fontSize: 16,
                 textAlign: 'center', backgroundColor: '#fff' },
  scaleUnit:      { fontSize: 14, color: '#6B7280' },
  scaleInputWarn: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  scaleWarnTxt:   { fontSize: 11, color: '#B45309', textAlign: 'center', marginTop: 6 },
  confirmBtn:  { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14,
                 alignItems: 'center', marginTop: 24 },
  confirmTxt:  { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnDis:      { opacity: 0.45 },
});
