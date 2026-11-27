import {
  INTERNAL_SARVAM_AUDIO_ASSETS,
  getInternalAudioAsset,
  getInternalAudioText,
  verifyAudioBlobIntegrity,
  loadVerifiedInternalAudio,
  type InternalAudioAsset,
} from '../internalSkinHealthAudio.ts';
import { generalEducation, classCodes, educationTopics } from '../../skinHealth/catalog.ts';
import { sha256Hex, sha256TextHex } from '../../skinHealth/verifiedPlayback.ts';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// 1. Inventory counts
assertEqual(INTERNAL_SARVAM_AUDIO_ASSETS.length, 58, 'Total Sarvam audio tracks count must be 58');

const generalTracks = INTERNAL_SARVAM_AUDIO_ASSETS.filter((a) => a.scope === 'general');
const categoryTracks = INTERNAL_SARVAM_AUDIO_ASSETS.filter((a) => a.scope === 'category');
assertEqual(generalTracks.length, 2, 'General tracks count must be 2');
assertEqual(categoryTracks.length, 56, 'Category tracks count must be 56');

// 2. Cryptographic text binding for general-hi
const generalHi = getInternalAudioAsset({ scope: 'general', locale: 'hi' });
if (!generalHi) {
  throw new Error('general-hi asset must exist');
}
assertEqual(generalHi.id, 'general-hi', 'general-hi ID matches');
assertEqual(generalHi.locale, 'hi', 'general-hi locale matches');

const expectedHiText = [
  generalEducation.translations.hi.description,
  generalEducation.translations.hi.modelLimits,
  generalEducation.translations.hi.doctorReview,
].join(' ');

const computedHiDigest = await sha256TextHex(expectedHiText);
assertEqual(computedHiDigest, generalHi.textSha256, 'general-hi text sha256 matches computed digest');
assertEqual(
  computedHiDigest,
  'e5d1b70b8c62d5e7e01d8cce779027353e805cf9cc32e5f895a8d8974745e3ed',
  'general-hi sha256 matches canonical reference'
);

// 3. Cryptographic text binding for general-hi-Latn
const generalHinglish = getInternalAudioAsset({ scope: 'general', locale: 'hi-Latn' });
if (!generalHinglish) {
  throw new Error('general-hi-Latn asset must exist');
}
assertEqual(generalHinglish.id, 'general-hi-Latn', 'general-hi-Latn ID matches');
assertEqual(generalHinglish.locale, 'hi-Latn', 'general-hi-Latn locale matches');

const expectedHinglishText = [
  generalEducation.translations['hi-Latn'].description,
  generalEducation.translations['hi-Latn'].modelLimits,
  generalEducation.translations['hi-Latn'].doctorReview,
].join(' ');

const computedHinglishDigest = await sha256TextHex(expectedHinglishText);
assertEqual(computedHinglishDigest, generalHinglish.textSha256, 'general-hi-Latn text sha256 matches computed');
assertEqual(
  computedHinglishDigest,
  'b2705cd478424e8d928df21a9b8004a8c3da7f3669882efb3ba5f177e4fed1d9',
  'general-hi-Latn sha256 matches canonical reference'
);

// 4. Check all 56 category tracks exist and match schema
for (const cat of classCodes) {
  for (const top of educationTopics) {
    for (const loc of ['hi', 'hi-Latn'] as const) {
      const asset = getInternalAudioAsset({
        scope: 'category',
        category: cat,
        topic: top,
        locale: loc,
      });
      if (!asset) {
        throw new Error(`Asset for ${cat}-${top}-${loc} must resolve`);
      }
      assertEqual(asset.category, cat, `Category matches for ${asset.id}`);
      assertEqual(asset.topic, top, `Topic matches for ${asset.id}`);
      assertEqual(asset.locale, loc, `Locale matches for ${asset.id}`);
      assert(asset.text.length > 0, `Script text non-empty for ${asset.id}`);
      assert(/^[a-f0-9]{64}$/.test(asset.audioSha256), `Audio hash is 64 hex for ${asset.id}`);
      assert(/^[a-f0-9]{64}$/.test(asset.textSha256), `Text hash is 64 hex for ${asset.id}`);
    }
  }
}

// 5. English query returns null (no Sarvam assets)
const enAsset = getInternalAudioAsset({ scope: 'general', locale: 'en' });
assertEqual(enAsset, null, 'English asset query returns null');
const enText = getInternalAudioText({ scope: 'general', locale: 'en' });
assertEqual(enText, null, 'English text query returns null');

// 6. Audio blob integrity verification
const sampleBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const sampleHash = await sha256Hex(sampleBytes);
const validResult = await verifyAudioBlobIntegrity(sampleBytes.buffer, sampleHash);
assertEqual(validResult.valid, true, 'Valid byte hash passes verification');
assertEqual(validResult.actualSha256, sampleHash, 'Reported actual hash matches');

const invalidResult = await verifyAudioBlobIntegrity(
  sampleBytes.buffer,
  '0000000000000000000000000000000000000000000000000000000000000000'
);
assertEqual(invalidResult.valid, false, 'Tampered hash fails verification');

// 7. loadVerifiedInternalAudio rejects text mismatch
let textMismatchRejected = false;
try {
  await loadVerifiedInternalAudio(generalHi, 'Mismatched audio script text');
} catch (err) {
  textMismatchRejected = true;
  assert(
    err instanceof Error && err.message.includes('Audio text binding mismatch'),
    'Expected text mismatch error message'
  );
}
assert(textMismatchRejected, 'Must reject text mismatch before audio fetch');

// 8. loadVerifiedInternalAudio rejects corrupted audio payload
let audioCorruptionRejected = false;
const corruptAsset: InternalAudioAsset = {
  id: generalHi.id,
  scope: generalHi.scope,
  category: generalHi.category,
  topic: generalHi.topic,
  locale: generalHi.locale,
  contentVersion: generalHi.contentVersion,
  localeRevision: generalHi.localeRevision,
  clinicalReviewStatus: generalHi.clinicalReviewStatus,
  audio: generalHi.audio,
  textSha256: generalHi.textSha256,
  text: generalHi.text,
  durationSeconds: generalHi.durationSeconds,
  audioSha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(new Uint8Array([10, 20, 30, 40]), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  });

try {
  await loadVerifiedInternalAudio(corruptAsset, corruptAsset.text);
} catch (err) {
  audioCorruptionRejected = true;
  assert(
    err instanceof Error && err.message.includes('Audio media integrity check failed'),
    'Expected media integrity failure error message'
  );
} finally {
  globalThis.fetch = originalFetch;
}
assert(audioCorruptionRejected, 'Must reject corrupted audio bytes');

console.log('All 8 internalSkinHealthAudio cryptographic verification tests PASSED successfully!');
