import { audioMimeType, type EducationAudioAsset } from './audioManifest.ts';
import type { EducationVideoAsset } from './videoManifest.ts';

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256TextHex(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

async function fetchVerifiedBlob(
  path: string,
  expectedSha256: string,
  mimeType: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetch(path, {
    signal,
    mode: 'same-origin',
    redirect: 'error',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('Media unavailable');
  const bytes = await response.arrayBuffer();
  const hex = await sha256Hex(bytes);
  if (hex !== expectedSha256) throw new Error('Media integrity check failed');
  return new Blob([bytes], { type: mimeType });
}

// Render the very bytes that were checked. Reusing the original network URL
// after hashing would permit a second fetch to return different content.
export async function loadVerifiedPlayback(asset: EducationVideoAsset, signal: AbortSignal) {
  const [video, captions] = await Promise.all([
    fetchVerifiedBlob(asset.video, asset.videoSha256, 'video/mp4', signal),
    fetchVerifiedBlob(asset.captions.src, asset.captions.sha256, 'text/vtt', signal),
  ]);
  signal.throwIfAborted();
  return { video: URL.createObjectURL(video), captions: URL.createObjectURL(captions) };
}

export async function loadVerifiedAudio(
  asset: EducationAudioAsset,
  expectedText: string,
  signal: AbortSignal,
): Promise<string> {
  const textDigest = await sha256TextHex(expectedText);
  if (textDigest !== asset.textSha256) {
    throw new Error('Audio text binding mismatch');
  }
  const mimeType = audioMimeType(asset.audio);
  if (!mimeType) {
    throw new Error('Unsupported audio media format');
  }
  const audioBlob = await fetchVerifiedBlob(asset.audio, asset.audioSha256, mimeType, signal);
  signal.throwIfAborted();
  return URL.createObjectURL(audioBlob);
}
