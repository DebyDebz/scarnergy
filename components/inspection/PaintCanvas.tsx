import { useRef, useState } from 'react';
import {
  View, TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path, Rect } from 'react-native-svg';

// Native module — absent until the app is rebuilt with a dev client that
// includes it (same constraint as expo-image-picker's camera path below).
// A static import would throw at module-load time and crash the whole
// inspection flow screen before the sketch feature is ever touched.
let ViewShot: typeof import('react-native-view-shot').default | null = null;
try { ViewShot = require('react-native-view-shot').default; } catch { ViewShot = null; }
export const isSketchAvailable = !!ViewShot;

const SIZE         = 300; // matches FloorPlanImageUpload's CANVAS so the handoff to step 2 is seamless
const CAPTURE_SIZE = 900; // explicit output resolution — gives auto-detect enough
                          // detail regardless of the device's pixel ratio
const PRIMARY = '#1E3A5F';
const THIN    = 2;
const THICK   = 5;

interface Stroke { d: string; width: number }

interface Props {
  onDone: (result: { uri: string; mime: string; ext: string; width: number; height: number }) => void;
  onCancel: () => void;
  /**
   * Fires true the instant a stroke starts and false the instant it ends, so the
   * parent ScrollView can disable scrolling only for the duration of the touch.
   */
  onDrawingChange?: (drawing: boolean) => void;
}

/**
 * Freehand sketch pad for inspectors with no floor plan to photograph. Multi-stroke
 * drawing on a blank canvas, captured to a PNG via react-native-view-shot and handed
 * back exactly like a picked photo — the caller feeds it into the existing
 * image-backed polygon tracing step, so storage/DB writes and the grid/element
 * pipeline downstream are untouched.
 */
export function PaintCanvas({ onDone, onCancel, onDrawingChange }: Props) {
  const shotRef      = useRef<any>(null);
  const pointsRef     = useRef<{ x: number; y: number }[]>([]);
  const penWidthRef   = useRef<number>(THIN);

  const [strokes,   setStrokes]   = useState<Stroke[]>([]);
  const [current,   setCurrent]   = useState<string>('');
  const [penWidth,  setPenWidthState] = useState<number>(THIN);
  const [capturing, setCapturing] = useState(false);

  const setPenWidth = (w: number) => { penWidthRef.current = w; setPenWidthState(w); };

  const toPath = (pts: { x: number; y: number }[]) => {
    if (!pts.length) return '';
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    return d;
  };

  const commitStroke = () => {
    if (pointsRef.current.length > 1) {
      setStrokes(prev => [...prev, { d: toPath(pointsRef.current), width: penWidthRef.current }]);
    }
    pointsRef.current = [];
    setCurrent('');
    onDrawingChange?.(false);
  };

  // react-native-gesture-handler's Pan gesture is a native UIGestureRecognizer /
  // Android GestureDetector under the hood, so it correctly negotiates with the
  // parent ScrollView instead of racing it through the JS-bridge touch responder
  // system the way PanResponder does — that race is what was dropping strokes
  // the instant a finger lifted (the gesture got silently cancelled before our
  // release handler ever ran).
  const pan = useRef(
    Gesture.Pan()
      .maxPointers(1)
      .minDistance(0)
      .shouldCancelWhenOutside(false)
      .onBegin((e) => {
        onDrawingChange?.(true);
        pointsRef.current = [{ x: e.x, y: e.y }];
        setCurrent(toPath(pointsRef.current));
      })
      .onUpdate((e) => {
        const last = pointsRef.current[pointsRef.current.length - 1];
        if (last && Math.hypot(e.x - last.x, e.y - last.y) < 2) return;
        pointsRef.current.push({ x: e.x, y: e.y });
        setCurrent(toPath(pointsRef.current));
      })
      // Fires after the gesture ends OR is cancelled either way — commit
      // whatever was drawn so far instead of ever silently losing it.
      .onFinalize(() => {
        commitStroke();
      }),
  ).current;

  const undo  = () => setStrokes(prev => prev.slice(0, -1));
  const clear = () => setStrokes([]);

  const finish = async () => {
    if (!strokes.length) return;
    if (!ViewShot || !shotRef.current) {
      Alert.alert(
        'Dev build required',
        'Capturing a sketch is not available in Expo Go. Run the app with `expo run:ios` or install the EAS dev-client build to use this feature.',
      );
      return;
    }
    setCapturing(true);
    try {
      const uri = await shotRef.current.capture();
      if (!uri) throw new Error('Capture returned no image.');
      setCapturing(false);
      onDone({ uri, mime: 'image/png', ext: 'png', width: CAPTURE_SIZE, height: CAPTURE_SIZE });
    } catch (e: any) {
      setCapturing(false);
      Alert.alert(
        'Could not save sketch',
        e?.message ? String(e.message) : 'Something went wrong while saving your drawing. Please try again.',
      );
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Draw Floor Plan by Hand</Text>
      <Text style={styles.sub}>
        No floor plan on file? Sketch the layout with your finger, then trace the room outline on top of it.
      </Text>

      {(() => {
        const surface = (
          <GestureDetector gesture={pan}>
            <View style={styles.canvas}>
              <Svg width={SIZE} height={SIZE}>
                {/* Explicit opaque background baked into the SVG itself — the auto-detect
                    pipeline reads the captured PNG and needs a true white background to
                    tell ink from empty space; SVG natively defaults to transparent, and
                    relying solely on the parent View's backgroundColor risks the
                    view-shot snapshot not compositing it (which would make the whole
                    capture read as "ink" and silently break detection). */}
                <Rect x={0} y={0} width={SIZE} height={SIZE} fill="#ffffff" />
                {strokes.map((s, i) => (
                  <Path key={i} d={s.d} stroke="#111827" strokeWidth={s.width}
                    fill="none" strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {!!current && (
                  <Path d={current} stroke="#111827" strokeWidth={penWidth}
                    fill="none" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </Svg>
            </View>
          </GestureDetector>
        );
        if (!ViewShot) return surface;
        return (
          <ViewShot
            ref={shotRef}
            style={styles.shot}
            options={{ format: 'png', quality: 1, width: CAPTURE_SIZE, height: CAPTURE_SIZE }}
          >
            {surface}
          </ViewShot>
        );
      })()}

      <View style={styles.toolRow}>
        <TouchableOpacity
          style={[styles.toolBtn, penWidth === THIN && styles.toolBtnActive]}
          onPress={() => setPenWidth(THIN)}
        >
          <Text style={[styles.toolBtnTxt, penWidth === THIN && styles.toolBtnTxtActive]}>Thin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, penWidth === THICK && styles.toolBtnActive]}
          onPress={() => setPenWidth(THICK)}
        >
          <Text style={[styles.toolBtnTxt, penWidth === THICK && styles.toolBtnTxtActive]}>Thick</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.btnSec} onPress={onCancel}>
          <Text style={styles.btnSecTxt}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSec} onPress={undo} disabled={!strokes.length || capturing}>
          <Text style={styles.btnSecTxt}>↩ Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSec} onPress={clear} disabled={!strokes.length || capturing}>
          <Text style={styles.btnSecTxt}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPri, (!strokes.length || capturing) && styles.btnDis]}
          onPress={finish}
          disabled={!strokes.length || capturing}
        >
          {capturing
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.btnPriTxt}>Use Sketch →</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:  { width: '100%', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: PRIMARY, marginBottom: 6, textAlign: 'center' },
  sub:   { fontSize: 13, color: '#6B7280', marginBottom: 16, textAlign: 'center', lineHeight: 19, paddingHorizontal: 8 },

  shot:   { width: SIZE, height: SIZE },
  canvas: { width: SIZE, height: SIZE, backgroundColor: '#ffffff',
            borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden' },

  toolRow:       { flexDirection: 'row', gap: 8, marginTop: 14 },
  toolBtn:       { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8,
                   borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#f9fafb' },
  toolBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  toolBtnTxt:       { fontSize: 13, color: '#374151', fontWeight: '600' },
  toolBtnTxtActive: { color: '#fff' },

  controls:  { flexDirection: 'row', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },
  btnSec:    { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
               borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#f9fafb' },
  btnSecTxt: { fontSize: 13, color: '#374151' },
  btnPri:    { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, backgroundColor: PRIMARY },
  btnPriTxt: { fontSize: 13, color: '#ffffff', fontWeight: '600' },
  btnDis:    { opacity: 0.5 },
});
