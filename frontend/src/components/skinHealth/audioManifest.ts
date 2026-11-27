import {
  classCodes,
  educationTopics,
  generalEducation,
  locales,
  type EducationLocale,
  type EducationTopic,
  type SkinClass,
} from './catalog.ts';

export type AudioReview = {
  status: 'approved' | 'clinical_review_required';
  reference: string;
  // Immutable release identity copied from the accountable review record.
  identity: string;
};

export type AudioFileFormat = 'mp3' | 'm4a' | 'wav' | 'ogg';

export type EducationAudioAsset = {
  id: string;
  locale: EducationLocale;
  contentVersion: string;
  assetVersion: string;
  audio: string;
  audioSha256: string;
  textSha256: string;
  clinicalReview: AudioReview;
  localeReview: AudioReview;
} & (
  | { scope: 'category'; category: SkinClass; topic: EducationTopic }
  | { scope: 'general' }
);

const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

// Trusted only as part of the reviewed application release.
// Production remains empty until bilingual clinical & audio reviews are recorded.
export const educationAudioAssets: readonly EducationAudioAsset[] = [];

export function audioMimeType(path: string): string | null {
  const lower = path.toLowerCase();
  for (const [ext, mime] of Object.entries(AUDIO_EXTENSIONS)) {
    if (lower.endsWith(ext)) return mime;
  }
  return null;
}

export function audioIdentity(a: EducationAudioAsset): string {
  const target =
    a.scope === 'category'
      ? [a.scope, a.category, a.topic]
      : [a.scope];
  return JSON.stringify([
    a.id,
    ...target,
    a.locale,
    a.contentVersion,
    a.assetVersion,
    a.audio,
    a.audioSha256,
    a.textSha256,
  ]);
}

function validAudioAsset(a: EducationAudioAsset): boolean {
  const token = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  const digest = /^[a-f0-9]{64}$/;
  if (!a || !locales.includes(a.locale)) return false;
  if (![a.id, a.contentVersion, a.assetVersion].every((s) => typeof s === 'string' && token.test(s))) {
    return false;
  }
  if (!digest.test(a.audioSha256) || !digest.test(a.textSha256)) return false;
  const mime = audioMimeType(a.audio);
  if (!mime) return false;
  const ext = Object.keys(AUDIO_EXTENSIONS).find((candidate) => a.audio.toLowerCase().endsWith(candidate));
  if (!ext) return false;

  if (a.scope === 'category') {
    if (!classCodes.includes(a.category) || !educationTopics.includes(a.topic)) return false;
    const expectedDir = `/education/skin-health/${a.category}/${a.contentVersion}/${a.assetVersion}/`;
    if (a.audio !== `${expectedDir}${a.topic}-${a.locale}${ext}`) return false;
  } else if (a.scope === 'general') {
    if (a.contentVersion !== generalEducation.contentVersion) return false;
    const expectedDir = `/education/skin-health/general/${a.contentVersion}/${a.assetVersion}/`;
    if (a.audio !== `${expectedDir}${a.locale}${ext}`) return false;
  } else {
    return false;
  }

  const identity = audioIdentity(a);
  return [a.clinicalReview, a.localeReview].every(
    (review) =>
      review?.status === 'approved' &&
      typeof review.reference === 'string' &&
      review.reference.trim() !== '' &&
      review.identity === identity,
  );
}

export function validAudioManifest(manifest: readonly EducationAudioAsset[]): boolean {
  const ids = new Set<string>();
  const releases = new Set<string>();
  return (
    Array.isArray(manifest) &&
    manifest.every((asset) => {
      if (!validAudioAsset(asset)) return false;
      const releaseKey =
        asset.scope === 'category'
          ? JSON.stringify([asset.scope, asset.category, asset.topic, asset.locale, asset.contentVersion])
          : JSON.stringify([asset.scope, asset.locale, asset.contentVersion]);
      if (ids.has(asset.id) || releases.has(releaseKey)) return false;
      ids.add(asset.id);
      releases.add(releaseKey);
      return true;
    })
  );
}

export function resolveEducationAudio(
  query:
    | {
        scope: 'category';
        category: SkinClass;
        topic: EducationTopic;
        locale: EducationLocale;
        contentVersion: string;
        textSha256: string;
      }
    | {
        scope: 'general';
        locale: EducationLocale;
        contentVersion: string;
        textSha256: string;
      },
  manifest: readonly EducationAudioAsset[] = educationAudioAssets,
): EducationAudioAsset | null {
  if (!validAudioManifest(manifest)) return null;
  return (
    manifest.find((asset) => {
      if (
        asset.scope !== query.scope ||
        asset.locale !== query.locale ||
        asset.contentVersion !== query.contentVersion ||
        asset.textSha256 !== query.textSha256
      ) {
        return false;
      }
      if (query.scope === 'category' && asset.scope === 'category') {
        return asset.category === query.category && asset.topic === query.topic;
      }
      return true;
    }) ?? null
  );
}
