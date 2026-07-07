import * as SecureStore from "expo-secure-store";

// expo-secure-store warns (and, per its own message, may soon THROW) when a
// single value exceeds ~2048 bytes. The Supabase auth session (access token +
// refresh token + user object) routinely exceeds that, so we transparently split
// large values across numbered keychain entries and reassemble them on read.
//
// Layout for a logical key K:
//   K__chunks -> "<n>"     number of parts (absent => not chunk-stored)
//   K__0 .. K__{n-1}       the parts
// A legacy single-value entry written under K directly is still read as a
// fallback, so users already signed in before this shipped aren't logged out.

// Char-based chunk size. Kept conservative so that even worst-case 2-byte UTF-8
// content (accented names in the user object) stays under the 2048-byte limit:
// 1000 chars * 2 bytes = 2000 bytes < 2048.
const CHUNK_SIZE = 1000;

const chunkKey = (key: string, i: number) => `${key}__${i}`;
const countKey = (key: string) => `${key}__chunks`;

async function getChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function getItemChunked(key: string): Promise<string | null> {
  const count = await getChunkCount(key);
  if (count === 0) {
    // Fallback: legacy single-value entry from before chunking existed.
    return SecureStore.getItemAsync(key);
  }
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    if (part === null) return null; // partial/corrupt write — treat as missing
    parts.push(part);
  }
  return parts.join("");
}

export async function setItemChunked(key: string, value: string): Promise<void> {
  const prevCount = await getChunkCount(key);
  const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));

  for (let i = 0; i < count; i++) {
    await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  }
  // Remove leftover parts if the new value is smaller than the previous one.
  for (let i = count; i < prevCount; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  await SecureStore.setItemAsync(countKey(key), String(count));
  // Drop any legacy single-value entry now that it's stored in chunks.
  await SecureStore.deleteItemAsync(key);
}

export async function removeItemChunked(key: string): Promise<void> {
  const count = await getChunkCount(key);
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  await SecureStore.deleteItemAsync(countKey(key));
  await SecureStore.deleteItemAsync(key); // legacy entry, if any
}
