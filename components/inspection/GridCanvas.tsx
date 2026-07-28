import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator,
  ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform,
  GestureResponderEvent,
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
  // Two-point scale calibration: tap two points a known distance apart on the
  // plan, enter that real length → metres across the canvas width.
  const [calPts, setCalPts] = useState<{ x: number; y: number }[]>([]);
  const [calLen, setCalLen] = useState('');

  const activeZone = zonesWithPlan[activeIdx];
  if (!activeZone) return null;

  // Image zones project the outline through the same contain transform as the
  // displayed image (once its dims are known); bbox-fit is the pre-load fallback
  // so it's never blank. No-image zones keep the original bbox-fit behaviour.
  // A hand-drawn sketch is treated the same as "no image" here — it's a rough
  // doodle, not something worth tracing over — so it falls back to the same
  // grid-only rendering already used for blank-canvas zones; the sketch image
  // itself is untouched and still shown elsewhere (ElementPlacer, review, print).
  const isSketchZone = !!(activeZone.metadata as any)?.is_sketch;
  const hasImage = !!activeZone.floor_plan_image_url && !isSketchZone;
  // A hand-traced sketch outline is wobbly by construction — clipping the grid
  // to it (and stroking it) just makes the freehand line show through in a
  // different form. Sketch zones get a plain full-canvas grid instead, same as
  // a never-traced blank zone (ClippedGrid's own <3-points fallback).
  const outlinePts = isSketchZone
    ? []
    : hasImage && imgDims
    ? projectPointsOnImage(activeZone.floor_plan_points, imgDims, CANVAS)
    : fitPointsToInner(activeZone.floor_plan_points, CANVAS, PADDING);
  const scaleM = parseFloat(scaleInputs[activeZone.id] || '5') || 5;
  // floor_plan_scale_m is metres spanned by the full canvas width, so a grid cell
  // (CELL_PX wide) is that fraction of the canvas in metres.
  const cellM  = (CELL_PX / CANVAS) * scaleM;

  // ─── Two-point calibration ───────────────────────────────────────────────
  const onCanvasTap = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX, y = e.nativeEvent.locationY;
    if (x < 0 || y < 0 || x > CANVAS || y > CANVAS) return;
    setCalPts(prev => (prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }]));
  };

  const calDist = calPts.length === 2
    ? Math.hypot(calPts[1].x - calPts[0].x, calPts[1].y - calPts[0].y) : 0;

  // Compute metres-across-canvas from a pending two-point calibration, or null
  // if the current calibration inputs aren't valid/complete.
  const pendingCalibration = (): number | null => {
    if (calPts.length !== 2) return null;
    const R = parseFloat(calLen);
    if (calDist < 10 || isNaN(R) || R <= 0 || R > 200) return null;
    return (R * CANVAS) / calDist; // d canvas-px over R metres
  };

  const applyCalibration = () => {
    const computed = pendingCalibration();
    if (computed == null) {
      Alert.alert('Check calibration',
        'Tap two points a bit further apart, then enter a real length between 0 and 200 m.');
      return;
    }
    console.log('[GridCanvas] calibration applied:', { calDist, calLen, computed });
    setScaleInputs(prev => ({ ...prev, [activeZone.id]: computed.toFixed(2) }));
    setCalPts([]); setCalLen('');
  };

  const resetCal = () => { setCalPts([]); setCalLen(''); };

  const confirm = async () => {
    setSaving(true);
    // Honour a still-pending (un-applied) two-point calibration so the scale is
    // never silently lost if the user taps Confirm before Apply.
    const pending = pendingCalibration();
    const effective: Record<string, string> = pending != null
      ? { ...scaleInputs, [activeZone.id]: pending.toFixed(2) }
      : scaleInputs;
    const scaleFor = (id: string) => parseFloat(effective[id] || '5') || 5;
    console.log('[GridCanvas] confirm scales:', zonesWithPlan.map(z => [z.id, scaleFor(z.id)]));

    const updates = zonesWithPlan.map(z =>
      supabase.from('zones')
        .update({ floor_plan_scale_m: scaleFor(z.id) })
        .eq('id', z.id)
    );
    const results = await Promise.all(updates);
    setSaving(false);
    const err = results.find(r => r.error)?.error;
    if (err) { Alert.alert('Could not save scale', err.message); return; }
    const updated = zones.map(z => {
      const zw = zonesWithPlan.find(x => x.id === z.id);
      return zw ? { ...z, floor_plan_scale_m: scaleFor(z.id) } : z;
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
                onPress={() => { setActiveIdx(i); setImgLoaded(false); setImgDims(null); resetCal(); }}>
                <Text style={[styles.tabTxt, i === activeIdx && styles.tabTxtActive]}>{z.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Canvas — tappable for two-point scale calibration */}
        <View
          style={styles.canvas}
          onStartShouldSetResponder={() => true}
          onResponderGrant={onCanvasTap}
        >
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

          {/* Calibration overlay — tapped endpoints + the measured line */}
          {calPts.length === 2 && (() => {
            const [a, b] = calPts;
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            return (
              <View pointerEvents="none" style={{
                position: 'absolute', height: 2, width: len,
                left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - 1,
                backgroundColor: '#2563EB', transform: [{ rotate: `${angle}deg` }],
              }} />
            );
          })()}
          {calPts.map((p, i) => (
            <View key={`cp${i}`} pointerEvents="none"
              style={[styles.calDot, { left: p.x - 5, top: p.y - 5 }]} />
          ))}
        </View>

        {/* Two-point calibration controls */}
        <View style={styles.calBox}>
          <Text style={styles.calHint}>
            {calPts.length === 0
              ? '📏 Tap two points a known distance apart on the plan to set the scale.'
              : calPts.length === 1
              ? 'Tap the second point.'
              : 'Enter the real distance between the two points.'}
          </Text>
          {calPts.length === 2 && (
            <View style={styles.calRow}>
              <TextInput
                style={styles.scaleInput}
                value={calLen}
                onChangeText={setCalLen}
                keyboardType="decimal-pad"
                placeholder="length"
                returnKeyType="done"
                autoFocus
              />
              <Text style={styles.scaleUnit}>m</Text>
              <TouchableOpacity style={styles.calApply} onPress={applyCalibration}>
                <Text style={styles.calApplyTxt}>Apply</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={resetCal}>
                <Text style={styles.calReset}>Reset</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Live readout so the applied scale is never silent */}
          <Text style={styles.calCurrent}>
            Current scale: plan width ≈ <Text style={styles.calCurrentBold}>{scaleM.toFixed(2)} m</Text>
            {'  ·  '}grid cell ≈ <Text style={styles.calCurrentBold}>{cellM.toFixed(2)} m</Text>
          </Text>
        </View>

        <View style={styles.scaleRow}>
          <Text style={styles.scaleLbl}>Or set width directly:</Text>
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
  calDot:         { position: 'absolute', width: 10, height: 10, borderRadius: 5,
                    backgroundColor: '#2563EB', borderWidth: 1.5, borderColor: '#fff' },
  calBox:         { marginTop: 12, alignItems: 'center' },
  calHint:        { fontSize: 12, color: '#374151', textAlign: 'center', marginBottom: 8 },
  calRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  calApply:       { backgroundColor: PRIMARY, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  calApplyTxt:    { color: '#fff', fontSize: 13, fontWeight: '700' },
  calReset:       { color: '#6B7280', fontSize: 13, paddingHorizontal: 8, paddingVertical: 8 },
  calCurrent:     { fontSize: 12, color: '#374151', textAlign: 'center', marginTop: 10 },
  calCurrentBold: { fontWeight: '700', color: PRIMARY },
  scaleWarnTxt:   { fontSize: 11, color: '#B45309', textAlign: 'center', marginTop: 6 },
  confirmBtn:  { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14,
                 alignItems: 'center', marginTop: 24 },
  confirmTxt:  { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnDis:      { opacity: 0.45 },
});
