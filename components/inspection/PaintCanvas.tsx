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
const SYMBOL_LEN = 40; // default door/window mark length, px on the SIZE canvas

// Door/window colors match the manual element palette (ElementPlacer.tsx) so a
// sketch symbol and its later on-canvas element look like the same thing.
const DOOR_COLOR   = '#2563EB';
const DOOR_ARC     = '#93C5FD';
const WINDOW_COLOR = '#0284c7';

type Tool = 'thin' | 'thick' | 'door' | 'window';

interface StrokeAction  { kind: 'stroke'; d: string; width: number }
interface SymbolAction  { kind: 'door' | 'window'; x: number; y: number; angle: number; length: number }
type Action = StrokeAction | SymbolAction;

// What onDone hands back for placed door/window taps — shape mirrors
// lib/floorplanDetect.ts's SketchSymbol so the caller can feed it straight
// into sketchSymbolsToElements() without PaintCanvas importing that module.
export interface SketchSymbolOut { kind: 'door' | 'window'; x: number; y: number; angle: number; length: number }

interface Props {
  onDone: (result: {
    uri: string; mime: string; ext: string; width: number; height: number;
    symbols: SketchSymbolOut[];
  }) => void;
  onCancel: () => void;
  /**
   * Fires true the instant a stroke starts and false the instant it ends, so the
   * parent ScrollView can disable scrolling only for the duration of the touch.
   */
  onDrawingChange?: (drawing: boolean) => void;
}

function SymbolMark({ s }: { s: SymbolAction }) {
  const rad = (s.angle * Math.PI) / 180;
  const hx = (s.length / 2) * Math.cos(rad);
  const hy = (s.length / 2) * Math.sin(rad);
  const x1 = s.x - hx, y1 = s.y - hy, x2 = s.x + hx, y2 = s.y + hy;

  if (s.kind === 'door') {
    // Swing arc from one jamb, quarter-circle out to the door's own length —
    // the same "rectangle + arc swing" convention used by ElementPlacer's
    // DoorSwingArc, just drawn as a line-art mark instead of a filled tile.
    const px = -Math.sin(rad) * s.length;
    const py = Math.cos(rad) * s.length;
    return (
      <>
        <Path d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`}
          stroke={DOOR_COLOR} strokeWidth={4} strokeLinecap="round" />
        <Path
          d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${s.length.toFixed(1)} ${s.length.toFixed(1)} 0 0 1 ${(x1 + px).toFixed(1)} ${(y1 + py).toFixed(1)}`}
          stroke={DOOR_ARC} strokeWidth={1.5} fill="none" strokeDasharray="3,3"
        />
      </>
    );
  }

  // Window: two parallel lines (frame + sill hash), matching the "rectangle
  // with hash lines" convention from docs/INSPECTION_FLOW.md.
  const ox = -Math.sin(rad) * 3, oy = Math.cos(rad) * 3;
  return (
    <>
      <Path d={`M ${(x1 + ox).toFixed(1)} ${(y1 + oy).toFixed(1)} L ${(x2 + ox).toFixed(1)} ${(y2 + oy).toFixed(1)}`}
        stroke={WINDOW_COLOR} strokeWidth={3} strokeLinecap="round" />
      <Path d={`M ${(x1 - ox).toFixed(1)} ${(y1 - oy).toFixed(1)} L ${(x2 - ox).toFixed(1)} ${(y2 - oy).toFixed(1)}`}
        stroke={WINDOW_COLOR} strokeWidth={3} strokeLinecap="round" />
    </>
  );
}

/**
 * Freehand sketch pad for inspectors with no floor plan to photograph. Multi-stroke
 * drawing on a blank canvas, captured to a PNG via react-native-view-shot and handed
 * back exactly like a picked photo — the caller feeds it into the existing
 * image-backed polygon tracing step, so storage/DB writes and the grid/element
 * pipeline downstream are untouched.
 *
 * Door/window taps are a second, parallel channel: they're never rasterised into
 * the captured PNG (rendered in a separate, non-captured overlay), so the wall
 * outline the auto-detect CV pipeline traces from the ink is completely
 * unaffected by them. Their positions travel as plain metadata (`symbols`) and
 * get turned into real building_elements client-side — an explicit tap, not an
 * inferred ink gap.
 */
export function PaintCanvas({ onDone, onCancel, onDrawingChange }: Props) {
  const shotRef      = useRef<any>(null);
  const pointsRef    = useRef<{ x: number; y: number }[]>([]);
  const toolRef      = useRef<Tool>('thin');
  const penWidthRef  = useRef<number>(THIN);

  const [actions,   setActions]   = useState<Action[]>([]);
  const [current,   setCurrent]   = useState<string>('');
  const [tool,      setToolState] = useState<Tool>('thin');
  const [capturing, setCapturing] = useState(false);

  const setTool = (t: Tool) => {
    toolRef.current = t;
    setToolState(t);
    if (t === 'thin')  penWidthRef.current = THIN;
    if (t === 'thick') penWidthRef.current = THICK;
  };

  const strokeActions: StrokeAction[] = actions.filter((a): a is StrokeAction => a.kind === 'stroke');
  const symbolActions: SymbolAction[] = actions.filter((a): a is SymbolAction => a.kind !== 'stroke');

  const toPath = (pts: { x: number; y: number }[]) => {
    if (!pts.length) return '';
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    return d;
  };

  const commitStroke = () => {
    if (pointsRef.current.length > 1) {
      setActions(prev => [...prev, { kind: 'stroke', d: toPath(pointsRef.current), width: penWidthRef.current }]);
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
        if (toolRef.current === 'door' || toolRef.current === 'window') {
          setActions(prev => [...prev, {
            kind: toolRef.current as 'door' | 'window', x: e.x, y: e.y, angle: 0, length: SYMBOL_LEN,
          }]);
          return;
        }
        onDrawingChange?.(true);
        pointsRef.current = [{ x: e.x, y: e.y }];
        setCurrent(toPath(pointsRef.current));
      })
      .onUpdate((e) => {
        if (toolRef.current === 'door' || toolRef.current === 'window') return;
        const last = pointsRef.current[pointsRef.current.length - 1];
        if (last && Math.hypot(e.x - last.x, e.y - last.y) < 2) return;
        pointsRef.current.push({ x: e.x, y: e.y });
        setCurrent(toPath(pointsRef.current));
      })
      // Fires after the gesture ends OR is cancelled either way — commit
      // whatever was drawn so far instead of ever silently losing it.
      .onFinalize(() => {
        if (toolRef.current === 'door' || toolRef.current === 'window') return;
        commitStroke();
      }),
  ).current;

  const undo  = () => setActions(prev => prev.slice(0, -1));
  const clear = () => setActions([]);

  const finish = async () => {
    if (!actions.length) return;
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
      const symbols: SketchSymbolOut[] = symbolActions.map(s => ({
        kind: s.kind, x: s.x / SIZE, y: s.y / SIZE, angle: s.angle, length: s.length / SIZE,
      }));
      onDone({ uri, mime: 'image/png', ext: 'png', width: CAPTURE_SIZE, height: CAPTURE_SIZE, symbols });
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
        Use the Door/Window tools to tap-place openings — they're recorded as real elements, not guessed.
      </Text>

      <View style={styles.canvasWrap}>
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
                  {strokeActions.map((s, i) => (
                    <Path key={i} d={s.d} stroke="#111827" strokeWidth={s.width}
                      fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                  {!!current && (tool === 'thin' || tool === 'thick') && (
                    <Path d={current} stroke="#111827" strokeWidth={penWidthRef.current}
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

        {/* Door/window marks — a separate, non-captured overlay. They never touch
            the rasterised PNG, so the wall-outline CV pass sees exactly the same
            ink it always has; these travel to the caller as plain metadata instead. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
          <Svg width={SIZE} height={SIZE}>
            {symbolActions.map((s, i) => <SymbolMark key={i} s={s} />)}
          </Svg>
        </View>
      </View>

      <View style={styles.toolRow}>
        <TouchableOpacity
          style={[styles.toolBtn, tool === 'thin' && styles.toolBtnActive]}
          onPress={() => setTool('thin')}
        >
          <Text style={[styles.toolBtnTxt, tool === 'thin' && styles.toolBtnTxtActive]}>Thin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, tool === 'thick' && styles.toolBtnActive]}
          onPress={() => setTool('thick')}
        >
          <Text style={[styles.toolBtnTxt, tool === 'thick' && styles.toolBtnTxtActive]}>Thick</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, tool === 'door' && styles.toolBtnActive]}
          onPress={() => setTool('door')}
        >
          <Text style={[styles.toolBtnTxt, tool === 'door' && styles.toolBtnTxtActive]}>🚪 Door</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolBtn, tool === 'window' && styles.toolBtnActive]}
          onPress={() => setTool('window')}
        >
          <Text style={[styles.toolBtnTxt, tool === 'window' && styles.toolBtnTxtActive]}>🪟 Window</Text>
        </TouchableOpacity>
      </View>
      {(tool === 'door' || tool === 'window') && (
        <Text style={styles.toolHint}>
          Tap the wall where the {tool} sits. Switch back to Thin/Thick to keep drawing walls.
        </Text>
      )}

      <View style={styles.controls}>
        <TouchableOpacity style={styles.btnSec} onPress={onCancel}>
          <Text style={styles.btnSecTxt}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSec} onPress={undo} disabled={!actions.length || capturing}>
          <Text style={styles.btnSecTxt}>↩ Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSec} onPress={clear} disabled={!actions.length || capturing}>
          <Text style={styles.btnSecTxt}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPri, (!actions.length || capturing) && styles.btnDis]}
          onPress={finish}
          disabled={!actions.length || capturing}
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

  canvasWrap: { width: SIZE, height: SIZE, position: 'relative' },
  shot:   { width: SIZE, height: SIZE },
  canvas: { width: SIZE, height: SIZE, backgroundColor: '#ffffff',
            borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden' },

  toolRow:       { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' },
  toolBtn:       { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8,
                   borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#f9fafb' },
  toolBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  toolBtnTxt:       { fontSize: 13, color: '#374151', fontWeight: '600' },
  toolBtnTxtActive: { color: '#fff' },
  toolHint:      { fontSize: 11, color: '#6B7280', marginTop: 8, textAlign: 'center', paddingHorizontal: 12 },

  controls:  { flexDirection: 'row', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },
  btnSec:    { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
               borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#f9fafb' },
  btnSecTxt: { fontSize: 13, color: '#374151' },
  btnPri:    { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, backgroundColor: PRIMARY },
  btnPriTxt: { fontSize: 13, color: '#ffffff', fontWeight: '600' },
  btnDis:    { opacity: 0.5 },
});
