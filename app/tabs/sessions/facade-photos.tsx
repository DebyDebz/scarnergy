import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Image, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, BuildingFacadePhoto } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';

let ImagePicker: typeof import('expo-image-picker') | null = null;
try { ImagePicker = require('expo-image-picker'); } catch { ImagePicker = null; }

type Direction = 'voor' | 'achter' | 'links' | 'rechts';

const DIRECTIONS: { key: Direction; label: string; labelNL: string }[] = [
  { key: 'voor',   label: 'Front',  labelNL: 'Voorgevel'   },
  { key: 'achter', label: 'Rear',   labelNL: 'Achtergevel' },
  { key: 'links',  label: 'Left',   labelNL: 'Linkergevel' },
  { key: 'rechts', label: 'Right',  labelNL: 'Rechtergevel'},
];

export default function FacadePhotosScreen() {
  const { sessionId, buildingId } = useLocalSearchParams<{ sessionId: string; buildingId: string }>();
  const { profile } = useAuthStore();
  const router = useRouter();

  const [photos, setPhotos]   = useState<Record<Direction, BuildingFacadePhoto | null>>({
    voor: null, achter: null, links: null, rechts: null,
  });
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState<Direction | null>(null);

  // Load any existing facade photos for this building
  useEffect(() => {
    if (!buildingId) return;
    supabase
      .from('building_facade_photos')
      .select('*')
      .eq('building_id', buildingId)
      .then(({ data }) => {
        const map: Record<Direction, BuildingFacadePhoto | null> = {
          voor: null, achter: null, links: null, rechts: null,
        };
        for (const p of data ?? []) map[p.direction as Direction] = p as BuildingFacadePhoto;
        setPhotos(map);
        setLoading(false);
      });
  }, [buildingId]);

  const capture = useCallback(async (direction: Direction) => {
    if (!ImagePicker) {
      Alert.alert('Not available', 'Photo capture requires a dev build.');
      return;
    }
    if (!profile || !buildingId) return;

    Alert.alert(
      `Capture ${DIRECTIONS.find(d => d.key === direction)?.labelNL}`,
      'Choose source',
      [
        {
          text: 'Camera',
          onPress: () => doCapture(direction, 'camera'),
        },
        {
          text: 'Library',
          onPress: () => doCapture(direction, 'library'),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [profile, buildingId]);

  const doCapture = async (direction: Direction, source: 'camera' | 'library') => {
    if (!ImagePicker || !profile || !buildingId) return;

    const permResult = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permResult.granted) {
      Alert.alert('Permission required', `Please allow ${source} access in Settings.`);
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [4, 3] })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });

    if (result.canceled || !result.assets?.[0]) return;
    const localUri = result.assets[0].uri;

    // Optimistic update — show local preview immediately
    setPhotos(prev => ({
      ...prev,
      [direction]: { direction, photo_url: localUri, building_id: buildingId } as any,
    }));
    setUploading(direction);

    try {
      const filename  = `${direction}_${Date.now()}.jpg`;
      const storagePath = `${profile.org_id}/${buildingId}/${filename}`;

      const response = await fetch(localUri);
      const blob     = await response.blob();
      const { error: upErr } = await supabase.storage
        .from('facade-photos')
        .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: true });

      if (upErr) throw upErr;

      // Upsert the row — unique index on (building_id, direction) so ON CONFLICT updates
      const { data: row, error: dbErr } = await (supabase.from('building_facade_photos') as any)
        .upsert(
          {
            org_id:      profile.org_id,
            building_id: buildingId,
            session_id:  sessionId ?? null,
            direction,
            photo_url:   storagePath,
            captured_at: new Date().toISOString(),
          },
          { onConflict: 'building_id,direction' },
        )
        .select()
        .single();

      if (dbErr) throw dbErr;
      setPhotos(prev => ({ ...prev, [direction]: row as BuildingFacadePhoto }));
    } catch (e: any) {
      Alert.alert('Upload failed', e.message ?? 'Unknown error');
      // Keep the local URI preview on failure
    } finally {
      setUploading(null);
    }
  };

  const getDisplayUri = useCallback(async (photo: BuildingFacadePhoto | null): Promise<string | null> => {
    if (!photo) return null;
    const url = photo.photo_url;
    if (url.startsWith('file://') || url.startsWith('content://') || url.startsWith('ph://') || url.startsWith('http')) {
      return url;
    }
    const { data } = await supabase.storage.from('facade-photos').createSignedUrl(url, 3600);
    return data?.signedUrl ?? null;
  }, []);

  const [signedUrls, setSignedUrls] = useState<Record<Direction, string | null>>({
    voor: null, achter: null, links: null, rechts: null,
  });

  useEffect(() => {
    Promise.all(
      DIRECTIONS.map(async ({ key }) => {
        const url = await getDisplayUri(photos[key]);
        return [key, url] as [Direction, string | null];
      })
    ).then(pairs => {
      const map: Record<Direction, string | null> = { voor: null, achter: null, links: null, rechts: null };
      for (const [key, url] of pairs) map[key] = url;
      setSignedUrls(map);
    });
  }, [photos, getDisplayUri]);

  if (loading) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;

  const capturedCount = Object.values(photos).filter(Boolean).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Gevel Foto's</Text>
          <Text style={styles.sub}>Maak 1 foto per gevel richting ({capturedCount}/4)</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {DIRECTIONS.map(({ key, labelNL }) => {
          const photo     = photos[key];
          const displayUri = signedUrls[key];
          const isUploading = uploading === key;

          return (
            <TouchableOpacity
              key={key}
              style={[styles.cell, photo && styles.cellFilled]}
              onPress={() => capture(key)}
              activeOpacity={0.75}
            >
              {displayUri ? (
                <Image source={{ uri: displayUri }} style={styles.cellImage} resizeMode="cover" />
              ) : (
                <View style={styles.cellPlaceholder}>
                  <Text style={styles.cellIcon}>📷</Text>
                </View>
              )}

              {isUploading && (
                <View style={styles.uploadOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}

              <View style={styles.cellLabel}>
                <Text style={styles.cellLabelText}>{labelNL}</Text>
                {photo && !isUploading && (
                  <Text style={styles.cellCheck}>✓</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
          <Text style={styles.doneBtnText}>
            {capturedCount === 4 ? '✓  Klaar' : `Opslaan (${capturedCount}/4)`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const PRIMARY = '#1E3A5F';

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#F5F7FA' },
  loader:         { flex: 1 },

  header:         { backgroundColor: PRIMARY, padding: 16, paddingTop: 20,
                    flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn:        { padding: 4 },
  backArrow:      { fontSize: 22, color: '#fff', fontWeight: '700' },
  title:          { fontSize: 17, fontWeight: '700', color: '#fff' },
  sub:            { fontSize: 12, color: '#A9C4E4', marginTop: 2 },

  grid:           { padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  cell:           { width: '47%', aspectRatio: 4 / 3, borderRadius: 12, overflow: 'hidden',
                    backgroundColor: '#fff', borderWidth: 2, borderColor: '#e5e7eb',
                    elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4 },
  cellFilled:     { borderColor: '#22c55e' },
  cellImage:      { width: '100%', height: '100%' },
  cellPlaceholder:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  cellIcon:       { fontSize: 32 },

  uploadOverlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)',
                    alignItems: 'center', justifyContent: 'center' },

  cellLabel:      { position: 'absolute', bottom: 0, left: 0, right: 0,
                    backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 8, paddingVertical: 5,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cellLabelText:  { color: '#fff', fontSize: 12, fontWeight: '600' },
  cellCheck:      { color: '#4ade80', fontSize: 14, fontWeight: '700' },

  footer:         { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  doneBtn:        { backgroundColor: PRIMARY, borderRadius: 12, padding: 16, alignItems: 'center' },
  doneBtnText:    { color: '#fff', fontSize: 16, fontWeight: '700' },
});
