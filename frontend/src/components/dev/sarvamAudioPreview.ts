export interface SarvamTrack {
  id: string;
  scope: string;
  category: string | null;
  topic: string | null;
  language: 'hi' | 'hi-Latn';
  contentVersion: string;
  localeRevision: string;
  clinicalReviewStatus: string;
  localeReviewStatus: string;
  model: string;
  speaker: string;
  sourceStage: string;
  file: string;
  textSha256: string;
  audioSha256: string;
  decodable: boolean;
  codec: string;
  sampleRateHz: number;
  durationSeconds: number;
  peakDbfs: number;
  rmsDbfs: number;
  clippedSamples: number;
  maxInteriorSilenceSeconds: number;
  bytes: number;
}

export interface SarvamInventory {
  stage: string;
  releaseStatus: string;
  productionAudioManifestModified: boolean;
  clinicalGate: string;
  model: string;
  speaker: string;
  targetCount: number;
  completedCount: number;
  totalBytes: number;
  tracks: SarvamTrack[];
}

export async function computeSha256(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyAudioBlobIntegrity(
  data: ArrayBuffer,
  expectedSha256: string,
): Promise<{ valid: boolean; actualSha256: string }> {
  const actualSha256 = await computeSha256(data);
  return {
    valid: actualSha256.toLowerCase() === expectedSha256.toLowerCase(),
    actualSha256,
  };
}

export async function fetchVerifiedAudioObjectUrl(
  track: SarvamTrack,
  signal?: AbortSignal,
): Promise<{ objectUrl: string; actualSha256: string }> {
  const fileUrl = `/internal-review-audio/file/${track.file}`;
  const response = await fetch(fileUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load audio asset (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  const { valid, actualSha256 } = await verifyAudioBlobIntegrity(bytes, track.audioSha256);
  if (!valid) {
    throw new Error(`Audio checksum mismatch: expected ${track.audioSha256}, got ${actualSha256}`);
  }
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  return {
    objectUrl: URL.createObjectURL(blob),
    actualSha256,
  };
}
