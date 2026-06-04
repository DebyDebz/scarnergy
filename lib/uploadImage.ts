/**
 * Upload a local image (from expo-image-picker) to Supabase Storage.
 *
 * On React Native, `await (await fetch(fileUri)).blob()` returns an *empty* blob
 * for `file://` URIs, so images were uploading as 0-byte files. We instead read
 * the file's real bytes via expo-file-system and upload those. On web,
 * `fetch().blob()` is correct, so we branch by platform.
 *
 * `expo-file-system` is already in the native build; its SDK-54 function API
 * lives at `expo-file-system/legacy`. `supabase.storage.upload` accepts a
 * Uint8Array, so no extra encoding dependency is needed.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

function base64ToBytes(b64: string): Uint8Array {
  // RN 0.81 / Hermes provides a global atob; fall back to a manual decode.
  const g: any = globalThis as any;
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64) as string;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (chars.indexOf(clean[i]) << 18) | (chars.indexOf(clean[i + 1]) << 12) |
      (chars.indexOf(clean[i + 2]) << 6) | chars.indexOf(clean[i + 3]);
    out[p++] = (n >> 16) & 0xff;
    if (clean[i + 2] !== undefined) out[p++] = (n >> 8) & 0xff;
    if (clean[i + 3] !== undefined) out[p++] = n & 0xff;
  }
  return out;
}

export async function uploadImageToStorage(
  bucket: string,
  path: string,
  uri: string,
  contentType: string,
  opts: { upsert?: boolean } = {},
): Promise<{ error: Error | null }> {
  try {
    let body: Blob | Uint8Array;
    if (Platform.OS === 'web') {
      body = await (await fetch(uri)).blob(); // correct in browsers
    } else {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      body = base64ToBytes(b64);
    }
    const empty = body instanceof Uint8Array ? body.length === 0 : (body as Blob).size === 0;
    if (empty) return { error: new Error('Image file is empty or unreadable') };

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, body, { contentType, upsert: opts.upsert ?? false });
    return { error: (error as Error) ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error('Image upload failed') };
  }
}
