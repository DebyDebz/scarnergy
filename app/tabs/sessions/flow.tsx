import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, Zone } from '../../../lib/supabase';
import { DrawingCanvas } from '../../../components/inspection/DrawingCanvas';
import { ZoneManager } from '../../../components/inspection/ZoneManager';
import { GridCanvas } from '../../../components/inspection/GridCanvas';
import { ElementPlacer } from '../../../components/inspection/ElementPlacer';

const PRIMARY = '#1E3A5F';

type Stage = 1 | 2 | 3 | 4 | 5;

const STAGE_LABELS: Record<Stage, string> = {
  1: 'Checking…',
  2: 'Draw Floor Plan',
  3: 'Define Zones',
  4: 'Grid Analysis',
  5: 'Place Elements',
};

export default function InspectionFlowScreen() {
  const { id: sessionId, buildingId } = useLocalSearchParams<{ id: string; buildingId: string }>();
  const router = useRouter();

  const [stage, setStage]         = useState<Stage>(1);
  const [zones, setZones]         = useState<Zone[]>([]);
  const [drawingZoneId,   setDrawingZoneId]   = useState<string | null>(null);
  const [drawingZoneName, setDrawingZoneName] = useState<string>('');
  const [loading, setLoading]     = useState(true);

  // ─── Stage 1: check for pre-existing zones + elements ─────────────────────
  const runCheck = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('zones')
      .select('*, building_elements(id)')
      .eq('building_id', buildingId)
      .eq('is_active', true);

    if (error || !data) {
      setLoading(false);
      setStage(2);
      return;
    }

    const fetchedZones = data as (Zone & { building_elements: { id: string }[] })[];
    const totalElements = fetchedZones.reduce((n, z) => n + z.building_elements.length, 0);

    // Restore existing zone shape (strip the building_elements join before storing)
    const cleanZones: Zone[] = fetchedZones.map(({ building_elements: _be, ...z }) => z as Zone);
    setZones(cleanZones);

    if (cleanZones.length > 0 && totalElements > 0) {
      // Already fully set up → skip wizard entirely, go straight to measurement
      setLoading(false);
      router.replace(`/tabs/sessions/${sessionId}`);
      return;
    } else if (cleanZones.length > 0) {
      // Zones exist but no elements → skip drawing to zone manager
      await advanceTo(3);
    } else {
      // Nothing exists → create zones first, then draw
      await advanceTo(3);
    }
    setLoading(false);
  }, [buildingId, sessionId, router]);

  useEffect(() => { runCheck(); }, [runCheck]);

  // ─── Persist stage to DB so session can be resumed ────────────────────────
  const advanceTo = async (next: Stage) => {
    setStage(next);
    await supabase.from('inspection_sessions')
      .update({ flow_stage: next })
      .eq('id', sessionId);
  };

  // ─── Stage 2 complete: floor plan saved for a zone ────────────────────────
  const handlePlanSaved = async () => {
    // Refresh zone data to get updated floor_plan_points
    const { data } = await supabase
      .from('zones')
      .select('*')
      .eq('building_id', buildingId)
      .eq('is_active', true);
    if (data) setZones(data as Zone[]);
    setDrawingZoneId(null);
    await advanceTo(3);
  };

  // ─── Stage 3: trigger drawing for a specific zone ─────────────────────────
  const handleDrawZone = (zoneId: string, zoneName: string) => {
    setDrawingZoneId(zoneId);
    setDrawingZoneName(zoneName);
    setStage(2);
  };

  // ─── Stage 5 complete: elements saved → land on session detail ─────────────
  const handleFlowComplete = () => {
    router.replace(`/tabs/sessions/${sessionId}`);
  };

  // ─── Progress bar ──────────────────────────────────────────────────────────
  const progressSteps: Stage[] = [2, 3, 4, 5];
  const progressPct = stage <= 1 ? 0
    : stage >= 5 ? 1
    : (progressSteps.indexOf(stage) + 1) / progressSteps.length;

  // ─── Render ────────────────────────────────────────────────────────────────
  const renderStage = () => {
    if (loading || stage === 1) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={PRIMARY} size="large" />
          <Text style={styles.loadingText}>Preparing inspection…</Text>
        </View>
      );
    }

    if (stage === 2) {
      const zoneId   = drawingZoneId ?? (zones[0]?.id ?? '');
      const zoneName = drawingZoneName || zones[0]?.name || 'Zone';
      return (
        <DrawingCanvas
          zoneId={zoneId}
          zoneName={zoneName}
          onSaved={handlePlanSaved}
        />
      );
    }

    if (stage === 3) {
      return (
        <ZoneManager
          buildingId={buildingId}
          zones={zones}
          onZonesChange={setZones}
          onDrawZone={handleDrawZone}
          onContinue={() => advanceTo(4)}
        />
      );
    }

    if (stage === 4) {
      return (
        <GridCanvas
          zones={zones}
          onConfirmed={updatedZones => { setZones(updatedZones); advanceTo(5); }}
        />
      );
    }

    if (stage === 5) {
      return (
        <ElementPlacer
          zones={zones}
          sessionId={sessionId}
          onSaved={handleFlowComplete}
        />
      );
    }

    return null;
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{stage > 1 ? STAGE_LABELS[stage] : 'Inspection Setup'}</Text>
        <Text style={styles.headerStage}>{stage > 1 ? `Step ${progressSteps.indexOf(stage as any) + 1} of ${progressSteps.length}` : ''}</Text>
      </View>

      {/* Progress bar */}
      {stage > 1 && (
        <View style={styles.progressWrap}>
          <View style={[styles.progressBar, { width: `${progressPct * 100}%` }]} />
        </View>
      )}

      {/* Stage labels strip */}
      {stage > 1 && (
        <View style={styles.stageStrip}>
          {progressSteps.map((s, i) => (
            <View key={s} style={styles.stepWrap}>
              <View style={[styles.stepDot, stage >= s && styles.stepDotActive]}>
                <Text style={[styles.stepNum, stage >= s && styles.stepNumActive]}>{i + 1}</Text>
              </View>
              <Text style={[styles.stepLabel, stage >= s && styles.stepLabelActive]}>
                {STAGE_LABELS[s]}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Main content */}
      <View style={styles.content}>
        {renderStage()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: '#F9FAFB' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                     paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
                     borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle:     { fontSize: 17, fontWeight: '700', color: PRIMARY },
  headerStage:     { fontSize: 12, color: '#6B7280' },
  progressWrap:    { height: 3, backgroundColor: '#E5E7EB' },
  progressBar:     { height: 3, backgroundColor: PRIMARY },
  stageStrip:      { flexDirection: 'row', justifyContent: 'space-around',
                     paddingVertical: 10, backgroundColor: '#fff',
                     borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  stepWrap:        { alignItems: 'center', gap: 4 },
  stepDot:         { width: 22, height: 22, borderRadius: 11, backgroundColor: '#E5E7EB',
                     alignItems: 'center', justifyContent: 'center' },
  stepDotActive:   { backgroundColor: PRIMARY },
  stepNum:         { fontSize: 11, color: '#9CA3AF', fontWeight: '700' },
  stepNumActive:   { color: '#fff' },
  stepLabel:       { fontSize: 9, color: '#9CA3AF', textAlign: 'center', maxWidth: 60 },
  stepLabelActive: { color: PRIMARY, fontWeight: '600' },
  content:         { flex: 1 },
  centered:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:     { fontSize: 14, color: '#6B7280' },
});
