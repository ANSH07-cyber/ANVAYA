import { classCodes, locales, type EducationLocale, type SkinClass } from './catalog.ts';

type MediaReview = {
  status: 'approved' | 'clinical_review_required';
  reference: string;
  // Immutable release identity copied from the accountable review record.
  identity: string;
};

export interface EducationVideoAsset {
  id: string;
  category: SkinClass;
  locale: EducationLocale;
  contentVersion: string;
  assetVersion: string;
  video: string;
  videoSha256: string;
  captions: { locale: EducationLocale; src: string; sha256: string };
  clinicalReview: MediaReview;
  localeReview: MediaReview;
}

// Trusted only as part of the reviewed application release. Digests establish
// byte identity relative to this manifest; they do not authenticate a reviewer.
export const educationVideos: readonly EducationVideoAsset[] = [];

export function mediaIdentity(a: EducationVideoAsset) {
  return JSON.stringify([a.id, a.category, a.locale, a.contentVersion, a.assetVersion,
    a.video, a.videoSha256, a.captions.locale, a.captions.src, a.captions.sha256]);
}

function validAsset(a: EducationVideoAsset) {
  const token = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  const digest = /^[a-f0-9]{64}$/;
  if (!a || !classCodes.includes(a.category) || !locales.includes(a.locale) ||
      ![a.id, a.contentVersion, a.assetVersion].every(s => typeof s === 'string' && token.test(s)) ||
      a.captions?.locale !== a.locale || !digest.test(a.videoSha256) || !digest.test(a.captions.sha256)) return false;
  const dir = '/education/skin-health/' + a.category + '/' + a.contentVersion + '/' + a.assetVersion + '/';
  if (a.video !== dir + a.locale + '.mp4' || a.captions.src !== dir + a.locale + '.vtt') return false;
  const identity = mediaIdentity(a);
  return [a.clinicalReview, a.localeReview].every(review => review?.status === 'approved' &&
    typeof review.reference === 'string' && review.reference.trim() !== '' && review.identity === identity);
}

export function validVideoManifest(manifest: readonly EducationVideoAsset[]) {
  const ids = new Set<string>();
  const releases = new Set<string>();
  return Array.isArray(manifest) && manifest.every(asset => {
    if (!validAsset(asset)) return false;
    const key = JSON.stringify([asset.category, asset.locale, asset.contentVersion]);
    if (ids.has(asset.id) || releases.has(key)) return false;
    ids.add(asset.id);
    releases.add(key);
    return true;
  });
}

export function resolveEducationVideo(id: string | null, category: SkinClass, locale: EducationLocale,
  version: string, manifest: readonly EducationVideoAsset[] = educationVideos) {
  if (!id || !validVideoManifest(manifest)) return null;
  return manifest.find(a => a.id === id && a.category === category && a.locale === locale && a.contentVersion === version) ?? null;
}
