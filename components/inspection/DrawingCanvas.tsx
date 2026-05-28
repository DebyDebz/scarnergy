import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  GestureResponderEvent, Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const CANVAS    = 300;
const CLOSE_R   = 24;
const DOT_R     = 6;
const PRIMARY   = '#1E3A5F';
const GRID_STEP = 20;
const GRID_N    = Math.ceil(CANVAS / GRID_STEP);

interface Point { x: number; y: number }

interface Props {
  zoneId: string;
  zoneName: string;
  onSaved: () => void;
}

function LineSegment({ x1, y1, x2, y2, dashed }: { x1:number; y1:number; x2:number; y2:number; dashed?:boolean }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
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
        backgroundColor: PRIMARY,
        opacity:         dashed ? 0.3 : 1,
        transform:       [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export function DrawingCanvas({ zoneId, zoneName, onSaved }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const undo   = () => { if (closed) { setClosed(false); return; } setPoints(p => p.slice(0, -1)); };
  const reset  = () => { setPoints([]); setClosed(false); };
  const close  = () => { if (points.length >= 3) setClosed(true); };

  const save = async () => {
    if (!closed || points.length < 3) return;
    setSaving(true);
    const normalized = points.map(p => ({
      x: parseFloat((p.x / CANVAS).toFixed(4)),
      y: parseFloat((p.y / CANVAS).toFixed(4)),
    }));
    const { error } = await supabase.from('zones')
      .update({ floor_plan_points: normalized })
      .eq('id', zoneId);
    setSaving(false);
    if (error) { Alert.alert('Could not save floor plan', error.message); return; }
    onSaved();
  };

  const hint = closed
    ? 'Shape closed. Tap Save to continue.'
    : points.length === 0
    ? 'Tap on the canvas to place points.'
    : points.length < 3
    ? `${points.length} point${points.length > 1 ? 's' : ''} — add at least ${3 - points.length} more.`
    : 'Tap the first point (blue) to close the shape.';

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>
        Draw floor plan for: <Text style={styles.bold}>{zoneName}</Text>
      </Text>
      <Text style={styles.hint}>{hint}</Text>

      <View
        style={[styles.canvas, closed && styles.canvasClosed]}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handleTap}
      >
        {/* Grid */}
        {Array.from({ length: GRID_N + 1 }).map((_, i) => (
          <View key={`v${i}`} pointerEvents="none" style={[styles.gridLine, styles.gridV, { left: i * GRID_STEP }]} />
        ))}
        {Array.from({ length: GRID_N + 1 }).map((_, i) => (
          <View key={`h${i}`} pointerEvents="none" style={[styles.gridLine, styles.gridH, { top: i * GRID_STEP }]} />
        ))}

        {/* Edges */}
        {points.map((p, i) => {
          if (i === 0) return null;
          return <LineSegment key={`e${i}`} x1={points[i - 1].x} y1={points[i - 1].y} x2={p.x} y2={p.y} />;
        })}
        {/* Closing edge */}
        {closed && points.length >= 3 && (
          <LineSegment x1={points[points.length - 1].x} y1={points[points.length - 1].y}
            x2={points[0].x} y2={points[0].y} />
        )}
        {/* Guide line (dashed last→first) */}
        {!closed && points.length >= 3 && (
          <LineSegment x1={points[points.length - 1].x} y1={points[points.length - 1].y}
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
        {closed && (
          <TouchableOpacity style={[styles.btnPri, saving && styles.btnDis]} onPress={save} disabled={saving}>
            <Text style={styles.btnPriTxt}>{saving ? 'Saving…' : 'Save →'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap:        { alignItems: 'center', padding: 16, paddingBottom: 32 },
  label:       { fontSize: 14, color: '#374151', marginBottom: 4, textAlign: 'center' },
  bold:        { fontWeight: '700', color: PRIMARY },
  hint:        { fontSize: 12, color: '#6B7280', marginBottom: 12, textAlign: 'center' },
  canvas:      { width: CANVAS, height: CANVAS, backgroundColor: '#ffffff',
                 borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden' },
  canvasClosed:{ backgroundColor: 'rgba(30,58,95,0.04)', borderColor: PRIMARY },
  gridLine:    { position: 'absolute', backgroundColor: '#f0f0f0' },
  gridV:       { width: 1, height: CANVAS },
  gridH:       { height: 1, width: CANVAS },
  dot:         { position: 'absolute', width: DOT_R * 2, height: DOT_R * 2,
                 borderRadius: DOT_R, backgroundColor: PRIMARY,
                 borderWidth: 1.5, borderColor: '#fff' },
  dotFirst:    { backgroundColor: '#2E86C1', width: DOT_R * 2 + 4, height: DOT_R * 2 + 4,
                 borderRadius: DOT_R + 2, marginLeft: -2, marginTop: -2 },
  controls:    { flexDirection: 'row', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },
  btnSec:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
                 borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#f9fafb' },
  btnSecTxt:   { fontSize: 13, color: '#374151' },
  btnPri:      { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, backgroundColor: PRIMARY },
  btnPriTxt:   { fontSize: 13, color: '#ffffff', fontWeight: '600' },
  btnDis:      { opacity: 0.5 },
});
