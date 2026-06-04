import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, Zone } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { FloorPlanDetection, elementsToDrafts } from '../../../lib/floorplanDetect';
import { uploadImageToStorage } from '../../../lib/uploadImage';
import { FloorPlanImageUpload } from '../../../components/inspection/FloorPlanImageUpload';
import { ZoneManager } from '../../../components/inspection/ZoneManager';
import { GridCanvas } from '../../../components/inspection/GridCanvas';
import { ElementPlacer } from '../../../components/inspection/ElementPlacer';
import { FloorPlanViewer } from '../../../components/inspection/FloorPlanViewer';

const PRIMARY = '#1E3A5F';

type Stage = 1 | 2 | 3 | 4 | 5 | 6;

const STAGE_LABELS: Record<Stage, string> = {
  1: 'Checking…',
  2: 'Draw Floor Plan',
  3: 'Define Zones',
  4: 'Grid Analysis',
  5: 'Place Elements',
  6: 'View Floor Plan',
};

export default function InspectionFlowScreen() {
  const { id: sessionId, buildingId, forceStage } = useLocalSearchParams<{ id: string; buildingId: string; forceStage?: string }>();
  const router = useRouter();
  const { profile } = useAuthStore();

  const [stage, setStage]               = useState<Stage>(1);
  const [zones, setZones]               = useState<Zone[]>([]);
  const [drawingZoneId,   setDrawingZoneId]   = useState<string | null>(null);
  const [drawingZoneName, setDrawingZoneName] = useState<string>('');
  const [loading, setLoading]           = useState(true);

  // ─── Stage 1: determine starting point ────────────────────────────────────
  const runCheck = useCallback(async () => {
    setLoading(true);

    // forceStage=5 lets session detail bypass runCheck and land directly on
    // ElementPlacer — used when some zones have elements but others don't.
    if (forceStage === '5') {
      // Still need to load zones so ElementPlacer has zone data
      const { data: zData } = await supabase
        .from('zones')
        .select('*')
        .eq('building_id', buildingId)
        .eq('is_active', true);
      setZones((zData ?? []) as Zone[]);
      setStage(5);
      setLoading(false);
      return;
    }

    // Fetch session flow_stage (for resume) + zones with element counts
    const [sessionRes, zonesRes] = await Promise.all([
      supabase
        .from('inspection_sessions')
        .select('flow_stage')
        .eq('id', sessionId)
        .single(),
      supabase
        .from('zones')
        .select('*, building_elements(id)')
        .eq('building_id', buildingId)
        .eq('is_active', true),
    ]);

    const savedStage = sessionRes.data?.flow_stage as Stage | null | undefined;
    const rawZones   = (zonesRes.data ?? []) as (Zone & { building_elements: { id: string }[] })[];

    const cleanZones: Zone[] = rawZones.map(({ building_elements: _be, ...z }) => z as Zone);
    const totalElements      = rawZones.reduce((n, z) => n + z.building_elements.length, 0);
    const zonesWithPlan      = cleanZones.filter(z => z.floor_plan_points && z.floor_plan_points.length >= 3);

    setZones(cleanZones);

    // ── Unified routing ──────────────────────────────────────────────────────
    // Image-upload and manually-drawn zones now follow the SAME path. Every zone
    // with a traced outline (whether it has a background image or not) routes
    // through Grid Analysis, where scale is set/confirmed on the image-backed
    // grid. There is no longer a separate "image + scale → viewer" shortcut that
    // bypassed the grid — supervisor-pre-configured zones carry points + scale +
    // image and land on the same grid (scale pre-filled) as everyone else.

    // ── Fully set up: every zone-with-floor-plan has ≥1 element → skip wizard
    // (Changed from "any elements" to "all zones covered" so partial setups
    //  don't lock users out of adding elements to remaining zones.)
    const allZonesCovered =
      zonesWithPlan.length > 0 &&
      zonesWithPlan.every(z => rawZones.find(r => r.id === z.id)!.building_elements.length > 0);

    if (allZonesCovered) {
      router.replace(`/tabs/sessions/${sessionId}`);
      return;
    }

    // ── Admin pre-uploaded zones + floor plans (no elements yet) → Grid ─────
    if (zonesWithPlan.length > 0 && totalElements === 0) {
      await advanceTo(4);
      setLoading(false);
      return;
    }

    // ── Resume in-progress session at the saved stage ────────────────────────
    // Only restore stages 3-5 (stages that have saved state worth resuming).
    // Stage 2 (draw) is not restored because drawn points are in-memory only.
    if (savedStage && savedStage >= 3 && savedStage <= 5 && cleanZones.length > 0) {
      setStage(savedStage);
      setLoading(false);
      return;
    }

    // ── Default routing ───────────────────────────────────────────────────────
    // No zones at all → Stage 2 so user draws + names the first zone inline.
    // Zones exist but none drawn → Stage 3 (Zone Manager) so user picks which to draw.
    if (cleanZones.length === 0) {
      await advanceTo(2);
    } else {
      await advanceTo(3);
    }
    setLoading(false);
  }, [buildingId, sessionId, forceStage, router]);

  useEffect(() => { runCheck(); }, [runCheck]);

  // ─── Persist stage to DB so session can be resumed ────────────────────────
  const advanceTo = async (next: Stage) => {
    setStage(next);
    await supabase.from('inspection_sessions')
      .update({ flow_stage: next })
      .eq('id', sessionId);
  };

  // ─── Stage 2 complete: floor plan saved (possibly with a new zone) ─────────
  const handlePlanSaved = async (newZone?: Zone) => {
    // Refresh zones to include any newly created zone
    const { data } = await supabase
      .from('zones')
      .select('*')
      .eq('building_id', buildingId)
      .eq('is_active', true);

    const updated = (data ?? []) as Zone[];
    setZones(updated);
    setDrawingZoneId(null);
    setDrawingZoneName('');
    await advanceTo(3);
  };

  // ─── Auto-detect: create one zone per detected room + draft elements ───────
  // Drafts only — the inspector reviews/edits in ZoneManager, Grid (manual
  // scale) and ElementPlacer, which loads the inserted elements automatically.
  const handleDetected = async (
    det: FloorPlanDetection,
    image: { uri: string; mime: string; ext: string },
  ) => {
    if (!profile) return;
    const usableRooms = det.rooms.filter(r => r.polygon && r.polygon.length >= 3);
    if (!usableRooms.length) {
      Alert.alert('Nothing detected', 'Could not find an outline. Trace it manually instead.');
      return;
    }

    // Auto-detect "owns" the zones it creates (tagged metadata.auto_detected).
    // A prior auto-detect run for this building is replaced — manually created
    // zones are never touched — so re-running is idempotent instead of piling up
    // duplicate "Room N" zones.
    const { data: priorAuto } = await supabase
      .from('zones')
      .select('id')
      .eq('building_id', buildingId)
      .eq('is_active', true)
      .eq('metadata->>auto_detected', 'true');
    const priorAutoIds = (priorAuto ?? []).map((z: { id: string }) => z.id);

    if (priorAutoIds.length > 0) {
      const replace = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Re-run detection?',
          `This replaces the ${priorAutoIds.length} previously auto-detected zone${priorAutoIds.length > 1 ? 's' : ''}. Manually added zones are kept.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Replace', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!replace) return;
    }

    setLoading(true);
    try {
      // Soft-delete the prior auto set (and its elements) so they vanish from the
      // wizard (queries filter is_active) without destroying manual work.
      if (priorAutoIds.length > 0) {
        await supabase.from('building_elements').update({ is_active: false }).in('zone_id', priorAutoIds);
        await supabase.from('zones').update({ is_active: false }).in('id', priorAutoIds);
      }
      // Number new zones after the remaining (manual) zones only.
      const manualCount = zones.filter(z => !priorAutoIds.includes(z.id)).length;

      for (let i = 0; i < usableRooms.length; i++) {
        const room = usableRooms[i];
        const zoneCode = `Z${String(manualCount + i + 1).padStart(2, '0')}`;
        const name = usableRooms.length > 1 ? `Room ${i + 1}` : 'Floor plan';

        const { data: zoneRow, error: zErr } = await supabase
          .from('zones')
          .insert({ org_id: profile.org_id, building_id: buildingId, zone_code: zoneCode, name, floor_level: 0, metadata: { auto_detected: true } })
          .select()
          .single();
        if (zErr || !zoneRow) continue;
        const zone = zoneRow as Zone;

        const path = `${buildingId}/${zone.id}/floor_plan.${image.ext}`;
        let imageUrl: string | null = null;
        const { error: upErr } = await uploadImageToStorage(
          'floor-plans', path, image.uri, image.mime, { upsert: true },
        );
        if (!upErr) {
          imageUrl = supabase.storage.from('floor-plans').getPublicUrl(path).data.publicUrl;
        }

        const payload: Record<string, unknown> = { floor_plan_points: room.polygon };
        if (imageUrl) payload.floor_plan_image_url = imageUrl;
        await supabase.from('zones').update(payload).eq('id', zone.id);

        const drafts = elementsToDrafts(room, zone.id, profile.org_id);
        if (drafts.length) await supabase.from('building_elements').insert(drafts);
      }

      // Reload zones and hand off to the review wizard.
      const { data } = await supabase
        .from('zones').select('*').eq('building_id', buildingId).eq('is_active', true);
      setZones((data ?? []) as Zone[]);
      setDrawingZoneId(null);
      setDrawingZoneName('');
      await advanceTo(3);
    } catch (e: any) {
      Alert.alert('Auto-detect failed', e?.message ?? 'Could not apply the detection.');
    } finally {
      setLoading(false);
    }
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
  // Both entry modes (image upload + manual draw) share the same four setup
  // steps: Draw → Zones → Grid → Place. (Measurement is the separate inspect
  // screen, launched per element from the session detail.)
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
      // If we're drawing a specific existing zone (from ZoneManager), pass its id.
      // Otherwise (fresh start), pass buildingId so the component creates the zone.
      if (drawingZoneId) {
        // Stage 3 sub-regions: show the main floor-plan outline (the largest
        // already-drawn polygon of another zone) as a backdrop so this zone is
        // traced as a sub-region within it.
        const area = (pts: { x: number; y: number }[]) => {
          let a = 0;
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length;
            a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
          }
          return Math.abs(a) / 2;
        };
        const mainShape = zones
          .filter(z => z.id !== drawingZoneId && z.floor_plan_points && z.floor_plan_points.length >= 3)
          .sort((a, b) => area(b.floor_plan_points!) - area(a.floor_plan_points!))[0];
        return (
          <FloorPlanImageUpload
            zoneId={drawingZoneId}
            zoneName={drawingZoneName}
            buildingId={buildingId}
            onSaved={handlePlanSaved}
            backdropPoints={mainShape?.floor_plan_points ?? null}
          />
        );
      }
      return (
        <FloorPlanImageUpload
          buildingId={buildingId}
          onSaved={handlePlanSaved}
          onDetected={handleDetected}
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

    if (stage === 6) {
      return (
        <FloorPlanViewer
          zones={zones}
          onContinue={() => advanceTo(5)}
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
