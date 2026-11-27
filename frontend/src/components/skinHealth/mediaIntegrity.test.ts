import { mediaIdentity, resolveEducationVideo, validVideoManifest, type EducationVideoAsset } from './videoManifest.ts';
import { loadVerifiedPlayback } from './verifiedPlayback.ts';

function check(ok: unknown, name: string) {
  if (!ok) throw new Error(name);
}
async function digest(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

const base = '/education/skin-health/mel/clinical-v1/asset-v1/';
const asset: EducationVideoAsset = {
  id: 'test-only', category: 'mel', locale: 'en', contentVersion: 'clinical-v1', assetVersion: 'asset-v1',
  video: base + 'en.mp4', videoSha256: await digest('sample video'),
  captions: { locale: 'en', src: base + 'en.vtt', sha256: await digest('sample captions') },
  clinicalReview: { status: 'approved', reference: 'synthetic clinical', identity: '' },
  localeReview: { status: 'approved', reference: 'synthetic language', identity: '' },
};
asset.clinicalReview.identity = asset.localeReview.identity = mediaIdentity(asset);
const resolve = (entries: EducationVideoAsset[]) => resolveEducationVideo(asset.id, 'mel', 'en', 'clinical-v1', entries);
check(resolve([asset]) === asset, 'valid release');
check(!resolveEducationVideo(asset.id, 'bcc', 'en', 'clinical-v1', [asset]), 'wrong class');
check(!resolveEducationVideo(asset.id, 'mel', 'hi', 'clinical-v1', [asset]), 'wrong locale');
check(!resolveEducationVideo(asset.id, 'mel', 'en', 'old', [asset]), 'wrong version');
check(!resolveEducationVideo(asset.id, 'mel', 'en', 'clinical-v1'), 'production manifest empty');
check(!resolve([asset,asset]), 'duplicate release');
const conflict = {...asset, id:'another'};
conflict.clinicalReview = {...asset.clinicalReview, identity: mediaIdentity(conflict)};
conflict.localeReview = {...asset.localeReview, identity: mediaIdentity(conflict)};
check(!resolve([asset, conflict]), 'conflicting release');
for (const invalid of [
  {...asset, clinicalReview:{...asset.clinicalReview,status:'clinical_review_required'}},
  {...asset, localeReview:{...asset.localeReview,status:'clinical_review_required'}},
  {...asset, clinicalReview:{...asset.clinicalReview,reference:' '}},
  {...asset, videoSha256:''}, {...asset, videoSha256:'a'.repeat(64)},
  {...asset, video:'//other.invalid/sample.mp4'}, {...asset, assetVersion:'v2'},
  {...asset, captions:{...asset.captions,locale:'hi'}},
  {...asset, captions:{...asset.captions,src:base+'../en.vtt'}},
  {...asset, captions:{...asset.captions,sha256:'a'.repeat(64)}},
] satisfies EducationVideoAsset[]) check(!validVideoManifest([invalid]), 'invalid release accepted');

const originalFetch = globalThis.fetch;
try {
  for (const change of ['none','video','caption','missing']) {
    globalThis.fetch = async (url, options) => {
      check(options?.redirect==='error' && options.mode==='same-origin', 'delivery boundary');
      const video = url === asset.video;
      return new Response((video ? 'sample video' : 'sample captions') +
        (change === (video ? 'video' : 'caption') ? ' altered' : ''), {status: change==='missing'?404:200});
    };
    let failed = false;
    try {
      const verified = await loadVerifiedPlayback(asset, new AbortController().signal);
      check(verified.video.startsWith('blob:') && verified.captions.startsWith('blob:'), 'render checked bytes');
      URL.revokeObjectURL(verified.video);
      URL.revokeObjectURL(verified.captions);
    } catch { failed = true; }
    check(failed === (change !== 'none'), 'unexpected byte verification result: '+change);
  }
} finally { globalThis.fetch = originalFetch; }
console.log('Media approval, identity, conflict and two-stream byte checks passed');
