import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  GestureResponderEvent, Alert, TextInput, ActivityIndicator,
  Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase, Zone } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';

let ImagePicker: typeof import('expo-image-picker') | null = null;
try { ImagePicker = require('expo-image-picker'); } catch { ImagePicker = null; }

const CANVAS    = 300;
const CLOSE_R   = 24;
const DOT_R     = 6;
const PRIMARY   = '#1E3A5F';
const GRID_STEP = 20;
const GRID_N    = Math.ceil(CANVAS / GRID_STEP);
const CELL_PX   = 20;
const INNER     = CANVAS - 12 * 2;

interface Point { x: number; y: number }

interface Props {
  zoneId?: string;
  zoneName?: string;
  buildingId?: string;
  onSaved: (newZone?: Zone) => void;
}

function LineSegment({
  x1, y1, x2, y2, dashed,
}: { x1: number; y1: number; x2: number; y2: number; dashed?: boolean }) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (len < 1) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position:        'absolute',
        width:           len,
        height:          2,
        left:            (x1 + x2) / 2 - len / 2,
        top:             (y1 + y2) / 2 - 1,
        backgroundColor: dashed ? '#93C5FD' : PRIMARY,
        opacity:         dashed ? 0.9 : 1,
        transform:       [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export function FloorPlanImageUpload({ zoneId, zoneName, buildingId, onSaved }: Props) {
  const { profile } = useAuthStore();
  const isNewZone = !zoneId && !!buildingId;

  // step 1 = choose image, step 2 = draw polygon, step 3 = set scale (only with image)
  const [step,         setStep]         = useState<1 | 2 | 3>(1);
  const [imgUri,       setImgUri]       = useState<string | null>(null);
  const [imgMime,      setImgMime]      = useState<string>('image/jpeg');
  const [imgExt,       setImgExt]       = useState<string>('jpg');
  const [newZoneName,  setNewZoneName]  = useState('');
  const [points,       setPoints]       = useState<Point[]>([]);
  const [closed,       setClosed]       = useState(false);
  const [scaleInput,   setScaleInput]   = useState('');
  const [saving,       setSaving]       = useState(false);

  // ─── Step 1: pick image ────────────────────────────────────────────────────
  const pickImage = async (source: 'camera' | 'library') => {
    if (!ImagePicker) {
      Alert.alert(
        'Dev build required',
        'Image upload is not available in Expo Go. Run the app with `expo run:ios` or install the EAS preview build to use this feature.',
      );
      return;
    }
    const permResult = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permResult.granted) {
      Alert.alert('Permission required', `Please allow ${source} access in Settings.`);
      return;
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setImgUri(asset.uri);
    setImgMime(asset.mimeType ?? 'image/jpeg');
    const rawExt = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
    setImgExt(['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg');
    setPoints([]);
    setClosed(false);
    setStep(2);
  };

  const skipImage = () => {
    setImgUri(null);
    setStep(2);
  };

  // ─── Step 2: polygon drawing ───────────────────────────────────────────────
  const handleTap = (e: GestureResponderEvent) => {
    if (closed || saving) return;
    const tx = e.nativeEvent.locationX;
    const ty = e.nativeEvent.locationY;
    if (tx < 0 || ty < 0 || tx > CANVAS || ty > CANVAS) return;
    if (points.length >= 3) {
      const dist = Math.hypot(tx - points[0].x, ty - points[0].y);
      if (dist <= CLOSE_R) { setClosed(true); return; }
    }
    setPoints(prev => [...prev, { x: tx, y: ty }]);
  };

  const undo  = () => { if (closed) { setClosed(false); return; } setPoints(p => p.slice(0, -1)); };
  const reset = () => { setPoints([]); setClosed(false); };
  const close = () => { if (points.length >= 3) setClosed(true); };

  // ─── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!closed || points.length < 3) return;
    if (isNewZone && !newZoneName.trim()) {
      Alert.alert('Zone name required', 'Please enter a name for this zone before saving.');
      return;
    }
    const scaleVal = parseFloat(scaleInput);
    if (imgUri && (isNaN(scaleVal) || scaleVal < 0.5 || scaleVal > 200)) {
      Alert.alert('Invalid scale', 'Please enter a valid zone width between 0.5 and 200 metres.');
      return;
    }
    setSaving(true);

    const normalized = points.map(p => ({
      x: parseFloat((p.x / CANVAS).toFixed(4)),
      y: parseFloat((p.y / CANVAS).toFixed(4)),
    }));

    try {
      // 1. Create zone record if needed
      let actualZoneId = zoneId;
      let createdZone: Zone | undefined;

      if (isNewZone) {
        const { data, error } = await supabase
          .from('zones')
          .insert({
            org_id:      profile!.org_id,
            building_id: buildingId,
            zone_code:   'Z01',
            name:        newZoneName.trim(),
            floor_level: 0,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        createdZone = data as Zone;
        actualZoneId = createdZone.id;
      }

      // 2. Upload image if one was selected
      let imageUrl: string | null = null;
      if (imgUri && actualZoneId) {
        const storagePath = `${buildingId}/${actualZoneId}/floor_plan.${imgExt}`;
        const response = await fetch(imgUri);
        const blob     = await response.blob();
        const { error: upErr } = await supabase.storage
          .from('floor-plans')
          .upload(storagePath, blob, { contentType: imgMime, upsert: true });
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
        const { data: urlData } = supabase.storage
          .from('floor-plans')
          .getPublicUrl(storagePath);
        imageUrl = urlData.publicUrl;
      }

      // 3. Save plan data to zone
      const payload: Record<string, unknown> = { floor_plan_points: normalized };
      if (imageUrl)              payload.floor_plan_image_url = imageUrl;
      if (imgUri && scaleVal)    payload.floor_plan_scale_m   = scaleVal;

      const { error: planErr } = await supabase
        .from('zones')
        .update(payload)
        .eq('id', actualZoneId);
      if (planErr) throw new Error(planErr.message);

      setSaving(false);

      if (isNewZone) {
        const { data: refreshed } = await supabase
          .from('zones').select('*').eq('id', actualZoneId).single();
        onSaved((refreshed as Zone) ?? createdZone);
      } else {
        onSaved();
      }
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Error', e.message ?? 'Something went wrong.');
    }
  };

  // ─── Derived UI state ──────────────────────────────────────────────────────
  const hint = closed
    ? imgUri ? 'Shape closed. Tap Next to continue.' : 'Shape closed. Tap Save to continue.'
    : points.length === 0
    ? 'Tap on the canvas to place points.'
    : points.length < 3
    ? `${points.length} point${points.length > 1 ? 's' : ''} — add at least ${3 - points.length} more.`
    : 'Tap the first point (blue) to close the shape.';

  const scaleVal   = parseFloat(scaleInput);
  const scaleWarn  = scaleInput !== '' && (isNaN(scaleVal) || scaleVal < 0.5 || scaleVal > 200);
  const scaleValid = !isNaN(scaleVal) && scaleVal >= 0.5 && scaleVal <= 200;
  const cellM      = scaleValid ? scaleVal / (INNER / CELL_PX) : null;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">

        {/* ── Step 1: Choose image ── */}
        {step === 1 && (
          <View style={styles.stepSection}>
            <Text style={styles.stepTitle}>Upload Floor Plan Image</Text>
            <Text style={styles.stepSub}>
              Upload a floor plan image and trace the zone boundary on it, or skip to draw the outline manually.
            </Text>

            <TouchableOpacity style={styles.imgBtn} onPress={() => pickImage('camera')}>
              <Text style={styles.imgBtnIcon}>📷</Text>
              <View style={styles.imgBtnBody}>
                <Text style={styles.imgBtnLabel}>Take Photo</Text>
                <Text style={styles.imgBtnHint}>Open camera</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.imgBtn} onPress={() => pickImage('library')}>
              <Text style={styles.imgBtnIcon}>🖼</Text>
              <View style={styles.imgBtnBody}>
                <Text style={styles.imgBtnLabel}>Choose from Library</Text>
                <Text style={styles.imgBtnHint}>Browse photos &amp; files</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={skipImage}>
              <Text style={styles.skipBtnTxt}>Draw without image →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 2: Trace polygon ── */}
        {step === 2 && (
          <>
            {isNewZone ? (
              <>
                <Text style={styles.label}>Name this zone</Text>
                <TextInput
                  style={styles.nameInput}
                  placeholder="e.g. Ground Floor, Room A"
                  value={newZoneName}
                  onChangeText={setNewZoneName}
                  returnKeyType="done"
                  autoFocus={false}
                />
              </>
            ) : (
              <Text style={styles.label}>
                Draw floor plan for: <Text style={styles.bold}>{zoneName ?? 'this zone'}</Text>
              </Text>
            )}

            <Text style={styles.hint}>{hint}</Text>

            <View
              style={[styles.canvas, closed && styles.canvasClosed]}
              onStartShouldSetResponder={() => true}
              onResponderGrant={handleTap}
            >
              {/* Floor plan image background */}
              {imgUri && (
                <Image
                  source={{ uri: imgUri }}
                  style={styles.canvasImg}
                  resizeMode="contain"
                />
              )}

              {/* Grid lines (blank canvas mode only) */}
              {!imgUri && Array.from({ length: GRID_N + 1 }).map((_, i) => (
                <View key={`v${i}`} pointerEvents="none"
                  style={[styles.gridLine, styles.gridV, { left: i * GRID_STEP }]} />
              ))}
              {!imgUri && Array.from({ length: GRID_N + 1 }).map((_, i) => (
                <View key={`h${i}`} pointerEvents="none"
                  style={[styles.gridLine, styles.gridH, { top: i * GRID_STEP }]} />
              ))}

              {/* Polygon edges */}
              {points.map((p, i) => {
                if (i === 0) return null;
                return (
                  <LineSegment key={`e${i}`}
                    x1={points[i - 1].x} y1={points[i - 1].y}
                    x2={p.x} y2={p.y} />
                );
              })}
              {closed && points.length >= 3 && (
                <LineSegment
                  x1={points[points.length - 1].x} y1={points[points.length - 1].y}
                  x2={points[0].x} y2={points[0].y} />
              )}
              {!closed && points.length >= 3 && (
                <LineSegment
                  x1={points[points.length - 1].x} y1={points[points.length - 1].y}
                  x2={points[0].x} y2={points[0].y} dashed />
              )}

              {/* Vertices */}
              {points.map((p, i) => (
                <View key={`d${i}`} pointerEvents="none" style={[
                  styles.dot,
                  { left: p.x - DOT_R, top: p.y - DOT_R },
                  i === 0 && styles.dotFirst,
                ]} />
              ))}

              {closed && (
                <View style={styles.closedBadge} pointerEvents="none">
                  <Text style={styles.closedBadgeTxt}>✓ Shape closed</Text>
                </View>
              )}
            </View>

            <View style={styles.controls}>
              <TouchableOpacity style={styles.btnSec} onPress={undo} disabled={points.length === 0}>
                <Text style={styles.btnSecTxt}>↩ Undo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSec} onPress={reset} disabled={points.length === 0}>
                <Text style={styles.btnSecTxt}>Reset</Text>
              </TouchableOpacity>
              {!closed && points.length >= 3 && (
                <TouchableOpacity style={styles.btnPri} onPress={close}>
                  <Text style={styles.btnPriTxt}>Close Shape</Text>
                </TouchableOpacity>
              )}
              {/* Image path → go to scale step */}
              {closed && imgUri && (
                <TouchableOpacity style={styles.btnPri} onPress={() => setStep(3)}>
                  <Text style={styles.btnPriTxt}>Next →</Text>
                </TouchableOpacity>
              )}
              {/* No-image path → save directly (scale at GridCanvas stage 4) */}
              {closed && !imgUri && (
                <TouchableOpacity
                  style={[styles.btnPri, saving && styles.btnDis]}
                  onPress={save}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.btnPriTxt}>Save →</Text>}
                </TouchableOpacity>
              )}
            </View>

            {/* Back to image selection */}
            {imgUri && (
              <TouchableOpacity style={styles.changeImgBtn} onPress={() => setStep(1)}>
                <Text style={styles.changeImgTxt}>← Change image</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── Step 3: Set scale ── */}
        {step === 3 && (
          <View style={styles.stepSection}>
            <Text style={styles.stepTitle}>Set Scale</Text>
            <Text style={styles.stepSub}>
              Enter the real-world width of this zone so grid cells represent accurate measurements.
            </Text>

            {/* Grid preview with image background */}
            <View style={styles.canvas}>
              {imgUri && (
                <Image
                  source={{ uri: imgUri }}
                  style={[styles.canvasImg, { opacity: 0.45 }]}
                  resizeMode="contain"
                />
              )}
              {Array.from({ length: Math.ceil(CANVAS / CELL_PX) + 1 }).map((_, i) => (
                <View key={`v${i}`} pointerEvents="none"
                  style={[styles.gridLine, styles.gridV, { left: i * CELL_PX }]} />
              ))}
              {Array.from({ length: Math.ceil(CANVAS / CELL_PX) + 1 }).map((_, i) => (
                <View key={`h${i}`} pointerEvents="none"
                  style={[styles.gridLine, styles.gridH, { top: i * CELL_PX }]} />
              ))}
              {cellM && Array.from({ length: Math.floor(INNER / CELL_PX) + 1 }).map((_, i) => (
                <Text key={i} style={[styles.gridLabel, { left: i * CELL_PX + 2, bottom: 2 }]}>
                  {(i * cellM).toFixed(1)}
                </Text>
              ))}
            </View>

            <View style={styles.scaleRow}>
              <Text style={styles.scaleLbl}>Zone width:</Text>
              <TextInput
                style={[styles.scaleInput, scaleWarn && styles.scaleInputWarn]}
                value={scaleInput}
                onChangeText={setScaleInput}
                keyboardType="decimal-pad"
                placeholder="e.g. 10"
                returnKeyType="done"
                autoFocus
              />
              <Text style={styles.scaleUnit}>metres</Text>
              {cellM ? (
                <Text style={styles.cellMLabel}>≈ {cellM.toFixed(2)} m/cell</Text>
              ) : null}
            </View>

            {scaleWarn && (
              <Text style={styles.scaleWarnTxt}>
                ⚠ Value seems outside normal range (0.5–200 m). Please verify.
              </Text>
            )}

            <View style={[styles.controls, { marginTop: 20 }]}>
              <TouchableOpacity style={styles.btnSec} onPress={() => setStep(2)}>
                <Text style={styles.btnSecTxt}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPri, (!scaleValid || saving) && styles.btnDis]}
                onPress={save}
                disabled={!scaleValid || saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.btnPriTxt}>Save Floor Plan →</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap:           { alignItems: 'center', padding: 16, paddingBottom: 40 },
  stepSection:    { width: '100%', alignItems: 'center' },

  stepTitle:      { fontSize: 18, fontWeight: '700', color: PRIMARY, marginBottom: 6, textAlign: 'center' },
  stepSub:        { fontSize: 13, color: '#6B7280', marginBottom: 20, textAlign: 'center', lineHeight: 19 },

  imgBtn:         { flexDirection: 'row', alignItems: 'center', gap: 14,
                    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
                    borderRadius: 12, padding: 16, marginBottom: 12, width: '100%' },
  imgBtnIcon:     { fontSize: 28 },
  imgBtnBody:     { flex: 1 },
  imgBtnLabel:    { fontSize: 15, fontWeight: '600', color: '#111827' },
  imgBtnHint:     { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  skipBtn:        { marginTop: 8, paddingVertical: 12 },
  skipBtnTxt:     { fontSize: 14, color: PRIMARY, fontWeight: '600', textDecorationLine: 'underline' },

  label:          { fontSize: 14, color: '#374151', marginBottom: 4, textAlign: 'center' },
  bold:           { fontWeight: '700', color: PRIMARY },
  hint:           { fontSize: 12, color: '#6B7280', marginBottom: 12, textAlign: 'center' },

  nameInput:      { width: CANVAS, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
                    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
                    backgroundColor: '#fff', marginBottom: 10 },

  canvas:         { width: CANVAS, height: CANVAS, backgroundColor: '#ffffff',
                    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden' },
  canvasClosed:   { backgroundColor: 'rgba(30,58,95,0.04)', borderColor: PRIMARY },
  canvasImg:      { position: 'absolute', top: 0, left: 0, width: CANVAS, height: CANVAS },

  gridLine:       { position: 'absolute', backgroundColor: '#f0f0f0' },
  gridV:          { width: 1, height: CANVAS },
  gridH:          { height: 1, width: CANVAS },
  gridLabel:      { position: 'absolute', fontSize: 7, color: '#9CA3AF' },

  dot:            { position: 'absolute', width: DOT_R * 2, height: DOT_R * 2,
                    borderRadius: DOT_R, backgroundColor: PRIMARY,
                    borderWidth: 1.5, borderColor: '#fff' },
  dotFirst:       { backgroundColor: '#2E86C1', width: DOT_R * 2 + 4, height: DOT_R * 2 + 4,
                    borderRadius: DOT_R + 2, marginLeft: -2, marginTop: -2 },

  closedBadge:    { position: 'absolute', top: 6, right: 6, backgroundColor: '#059669',
                    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  closedBadgeTxt: { fontSize: 10, color: '#fff', fontWeight: '700' },

  controls:       { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' },

  btnSec:         { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
                    borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#f9fafb' },
  btnSecTxt:      { fontSize: 13, color: '#374151' },
  btnPri:         { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, backgroundColor: PRIMARY },
  btnPriTxt:      { fontSize: 13, color: '#ffffff', fontWeight: '600' },
  btnDis:         { opacity: 0.5 },

  changeImgBtn:   { marginTop: 12, paddingVertical: 6 },
  changeImgTxt:   { fontSize: 13, color: '#6B7280' },

  scaleRow:       { flexDirection: 'row', alignItems: 'center', gap: 10,
                    marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },
  scaleLbl:       { fontSize: 14, color: '#374151' },
  scaleInput:     { width: 70, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 6, fontSize: 16,
                    textAlign: 'center', backgroundColor: '#fff' },
  scaleUnit:      { fontSize: 14, color: '#6B7280' },
  scaleInputWarn: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  cellMLabel:     { fontSize: 12, color: '#9CA3AF' },
  scaleWarnTxt:   { fontSize: 12, color: '#B45309', textAlign: 'center', marginTop: 6 },
});
