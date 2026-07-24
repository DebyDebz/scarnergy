import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  GestureResponderEvent, Alert, TextInput, ActivityIndicator,
  Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase, Zone } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import {
  detectFloorPlan, FloorPlanDetection, DetectionUnavailableError,
} from '../../lib/floorplanDetect';
import { uploadImageToStorage } from '../../lib/uploadImage';
import { PaintCanvas, isSketchAvailable } from './PaintCanvas';

let ImagePicker: typeof import('expo-image-picker') | null = null;
try { ImagePicker = require('expo-image-picker'); } catch { ImagePicker = null; }

const CANVAS    = 300;
const CLOSE_R   = 24;
const DOT_R     = 6;
const PRIMARY   = '#1E3A5F';
const GRID_STEP = 20;
const GRID_N    = Math.ceil(CANVAS / GRID_STEP);

interface Point { x: number; y: number }

interface Props {
  zoneId?: string;
  zoneName?: string;
  buildingId?: string;
  onSaved: (newZone?: Zone) => void;
  /**
   * When provided (fresh-start context), auto-detect hands the full result up
   * so the flow can create one zone per detected room + draft elements. When
   * omitted (editing a specific zone), auto-detect pre-fills this zone's
   * boundary in place for review.
   */
  onDetected?: (
    detection: FloorPlanDetection,
    image: { uri: string; mime: string; ext: string },
  ) => void;
  /**
   * Stage 3 "sub-regions" support: the main floor-plan outline (normalised points
   * of the primary zone) shown as a faint backdrop so this zone is traced as a
   * sub-region within it. Only rendered in blank-canvas (no-image) mode, where
   * points share the px/CANVAS normalisation and therefore align.
   */
  backdropPoints?: { x: number; y: number }[] | null;
}

/**
 * Letterbox offsets for an image shown `resizeMode="contain"` inside the square
 * canvas. Points are stored image-relative (canvasPx - off) / CANVAS so they can
 * be overlaid back onto the contain-fit image in FloorPlanViewer. Falls back to
 * no offset (square) when image dimensions are unknown.
 */
function containOffsets(w: number, h: number, canvas: number): { offX: number; offY: number } {
  if (!w || !h) return { offX: 0, offY: 0 };
  const cs = canvas / Math.max(w, h);
  return { offX: (canvas - w * cs) / 2, offY: (canvas - h * cs) / 2 };
}

/** Shoelace area of a normalised polygon — used to pick the largest room. */
function polyArea(poly: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a) / 2;
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

export function FloorPlanImageUpload({ zoneId, zoneName, buildingId, onSaved, onDetected, backdropPoints }: Props) {
  const { profile } = useAuthStore();
  const isNewZone = !zoneId && !!buildingId;

  // step 1 = choose image, step 2 = draw polygon. Scale is set later at the
  // shared Grid Analysis stage (GridCanvas), so both image and no-image paths
  // finish Stage 2 the same way — no inline scale step.
  const [step,         setStep]         = useState<1 | 2>(1);
  const [sketching,    setSketching]    = useState(false);
  const [sketchDrawing, setSketchDrawing] = useState(false);
  const [imgUri,       setImgUri]       = useState<string | null>(null);
  const [imgMime,      setImgMime]      = useState<string>('image/jpeg');
  const [imgExt,       setImgExt]       = useState<string>('jpg');
  const [imgW,         setImgW]         = useState<number>(0);
  const [imgH,         setImgH]         = useState<number>(0);
  const [imgLoadFailed, setImgLoadFailed] = useState(false);
  const [newZoneName,  setNewZoneName]  = useState('');
  const [points,       setPoints]       = useState<Point[]>([]);
  const [closed,       setClosed]       = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [detecting,    setDetecting]    = useState(false);

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
    setImgW(asset.width ?? 0);
    setImgH(asset.height ?? 0);
    const rawExt = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
    setImgExt(['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg');
    setPoints([]);
    setClosed(false);
    setImgLoadFailed(false);
    setStep(2);
  };

  const skipImage = () => {
    setImgUri(null);
    setStep(2);
  };

  // ─── Hand-drawn sketch: the sketch already IS the floor plan outline, so skip
  // re-tracing it point-by-point — auto-close a full-canvas rectangle so the
  // inspector only has to (optionally) name the zone and tap Save, the "draw
  // then save" feel of a paint app. Undo still re-opens it for manual adjustment
  // if the room isn't a perfect rectangle — nothing about step 2 changes. ───
  const useSketch = (res: { uri: string; mime: string; ext: string; width: number; height: number }) => {
    setImgUri(res.uri);
    setImgMime(res.mime);
    setImgW(res.width);
    setImgH(res.height);
    setImgExt(res.ext);
    setPoints([
      { x: 0, y: 0 },
      { x: CANVAS, y: 0 },
      { x: CANVAS, y: CANVAS },
      { x: 0, y: CANVAS },
    ]);
    setClosed(true);
    setSketching(false);
    setImgLoadFailed(false);
    setStep(2);
  };

  // ─── Auto-detect (OpenCV) — pre-fill, never auto-commit ────────────────────
  const autoDetect = async () => {
    if (!imgUri || detecting) return;
    setDetecting(true);
    try {
      const det = await detectFloorPlan(imgUri, { mode: 'full', mimeType: imgMime });
      if (!det.rooms.length) {
        Alert.alert(
          'Nothing detected',
          'Could not find a floor-plan outline. Trace it manually by tapping on the image.',
        );
        return;
      }
      // Fresh-start context → let the flow create zones + draft elements.
      if (onDetected) {
        onDetected(det, { uri: imgUri, mime: imgMime, ext: imgExt });
        return;
      }
      // Editing a specific zone → pre-fill the largest room's boundary for review.
      // Map normalised points back onto the contain-fit image inside the canvas so
      // the overlay lines up with what the inspector sees.
      const largest = det.rooms.reduce((a, b) => (polyArea(b.polygon) >= polyArea(a.polygon) ? b : a));
      const maxDim = Math.max(det.image_w || 1, det.image_h || 1);
      const cs   = CANVAS / maxDim;
      const offX = (CANVAS - (det.image_w || CANVAS) * cs) / 2;
      const offY = (CANVAS - (det.image_h || CANVAS) * cs) / 2;
      const pts = largest.polygon.map(p => ({
        x: Math.max(0, Math.min(CANVAS, p.x * CANVAS + offX)),
        y: Math.max(0, Math.min(CANVAS, p.y * CANVAS + offY)),
      }));
      if (pts.length < 3) {
        Alert.alert('Nothing detected', 'Could not trace a usable outline. Trace it manually.');
        return;
      }
      setPoints(pts);
      setClosed(true);
    } catch (e: unknown) {
      const msg = e instanceof DetectionUnavailableError
        ? e.message
        : 'Auto-detect failed. Trace the outline manually.';
      Alert.alert('Auto-detect unavailable', msg);
    } finally {
      setDetecting(false);
    }
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
    setSaving(true);

    // Store points image-relative (remove the contain letterbox offset) so the
    // outline can be overlaid exactly on the image later. With no image (manual
    // grid draw), offsets are 0 → same as before.
    const { offX, offY } = imgUri ? containOffsets(imgW, imgH, CANVAS) : { offX: 0, offY: 0 };
    const normalized = points.map(p => ({
      x: parseFloat(((p.x - offX) / CANVAS).toFixed(4)),
      y: parseFloat(((p.y - offY) / CANVAS).toFixed(4)),
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
        const { error: upErr } = await uploadImageToStorage(
          'floor-plans', storagePath, imgUri, imgMime, { upsert: true },
        );
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
        const { data: urlData } = supabase.storage
          .from('floor-plans')
          .getPublicUrl(storagePath);
        imageUrl = urlData.publicUrl;
      }

      // 3. Save plan data to zone. Scale is intentionally NOT written here — it is
      // set at the shared Grid Analysis stage (GridCanvas) for both image and
      // no-image zones, so the flow routes identically.
      const payload: Record<string, unknown> = { floor_plan_points: normalized };
      if (imageUrl) payload.floor_plan_image_url = imageUrl;

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
    ? 'Shape closed. Tap Save to continue.'
    : points.length === 0
    ? 'Tap on the canvas to place points.'
    : points.length < 3
    ? `${points.length} point${points.length > 1 ? 's' : ''} — add at least ${3 - points.length} more.`
    : 'Tap the first point (blue) to close the shape.';

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!sketchDrawing}
      >

        {/* ── Step 1: Choose image ── */}
        {step === 1 && !sketching && (
          <View style={styles.stepSection}>
            <Text style={styles.stepTitle}>Upload Floor Plan Image</Text>
            <Text style={styles.stepSub}>
              Upload a floor plan image and trace the zone boundary on it, sketch one by hand, or skip to draw the outline manually.
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

            <TouchableOpacity style={styles.imgBtn} onPress={() => {
              if (!isSketchAvailable) {
                Alert.alert(
                  'Dev build required',
                  'Hand-drawn sketching is not available in Expo Go. Run the app with `expo run:ios` or install the EAS dev-client build to use this feature.',
                );
                return;
              }
              setSketching(true);
            }}>
              <Text style={styles.imgBtnIcon}>✏️</Text>
              <View style={styles.imgBtnBody}>
                <Text style={styles.imgBtnLabel}>Draw Floor Plan by Hand</Text>
                <Text style={styles.imgBtnHint}>No floor plan? Sketch the layout yourself</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={skipImage}>
              <Text style={styles.skipBtnTxt}>Draw without image →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 1 (sketch mode): freehand paint pad, then hand off to tracing ── */}
        {step === 1 && sketching && (
          <PaintCanvas
            onDone={useSketch}
            onCancel={() => setSketching(false)}
            onDrawingChange={setSketchDrawing}
          />
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

            {/* Auto-detect (OpenCV) — pre-fills the outline for review */}
            {imgUri && (
              <TouchableOpacity
                style={[styles.detectBtn, detecting && styles.btnDis]}
                onPress={autoDetect}
                disabled={detecting}
              >
                {detecting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.detectBtnTxt}>✨ Auto-detect outline</Text>}
              </TouchableOpacity>
            )}

            <View
              style={[styles.canvas, closed && styles.canvasClosed]}
              onStartShouldSetResponder={() => true}
              onResponderGrant={handleTap}
            >
              {/* Floor plan image background */}
              {imgUri && !imgLoadFailed && (
                <Image
                  source={{ uri: imgUri }}
                  style={styles.canvasImg}
                  resizeMode="contain"
                  onError={(e) => {
                    setImgLoadFailed(true);
                    Alert.alert(
                      'Preview failed to load',
                      e.nativeEvent?.error || 'Could not display the image on the canvas. Try drawing or picking it again.',
                    );
                  }}
                />
              )}
              {imgUri && imgLoadFailed && (
                <View style={styles.imgErrBanner} pointerEvents="none">
                  <Text style={styles.imgErrBannerTxt}>⚠ Preview image failed to load.</Text>
                </View>
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

              {/* Main floor-plan outline as a faint backdrop (Stage 3 sub-regions).
                  Blank-canvas only — shares px/CANVAS normalisation so it aligns. */}
              {!imgUri && backdropPoints && backdropPoints.length >= 3 &&
                backdropPoints.map((bp, i) => {
                  const a = { x: bp.x * CANVAS, y: bp.y * CANVAS };
                  const n = backdropPoints[(i + 1) % backdropPoints.length];
                  const b = { x: n.x * CANVAS, y: n.y * CANVAS };
                  return <LineSegment key={`bd${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} dashed />;
                })}

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
              {/* Both paths → save directly. Real-world scale is set later at the
                  shared Grid Analysis stage (GridCanvas), so image and no-image
                  zones finish Stage 2 identically. */}
              {closed && (
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

  detectBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 8, backgroundColor: PRIMARY, borderRadius: 10,
                    paddingVertical: 11, paddingHorizontal: 16, marginBottom: 12,
                    width: CANVAS, alignSelf: 'center' },
  detectBtnTxt:   { fontSize: 14, color: '#fff', fontWeight: '700' },

  nameInput:      { width: CANVAS, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
                    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
                    backgroundColor: '#fff', marginBottom: 10 },

  canvas:         { width: CANVAS, height: CANVAS, backgroundColor: '#ffffff',
                    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden' },
  canvasClosed:   { backgroundColor: 'rgba(30,58,95,0.04)', borderColor: PRIMARY },
  canvasImg:      { position: 'absolute', top: 0, left: 0, width: CANVAS, height: CANVAS },
  imgErrBanner:   { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#FEF3C7',
                    borderBottomWidth: 1, borderColor: '#F59E0B', paddingVertical: 6, paddingHorizontal: 10 },
  imgErrBannerTxt:{ fontSize: 11, color: '#92400E', textAlign: 'center' },

  gridLine:       { position: 'absolute', backgroundColor: '#f0f0f0' },
  gridV:          { width: 1, height: CANVAS },
  gridH:          { height: 1, width: CANVAS },

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
});
