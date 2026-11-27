import {
  audioIdentity,
  audioMimeType,
  educationAudioAssets,
  resolveEducationAudio,
  validAudioManifest,
  type EducationAudioAsset,
} from './audioManifest.ts';
import {
  categoryEducation,
  generalEducation,
  type EducationLocale,
  type EducationTopic,
  type SkinClass,
} from './catalog.ts';
import {
  createBrowserNarrator,
  createVerifiedBlobAudioPlayer,
  selectLocalVoice,
  type AudioElementLike,
} from './narration.ts';
import { loadVerifiedAudio, sha256Hex, sha256TextHex } from './verifiedPlayback.ts';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function checkRejects(fn: () => Promise<unknown>, expectedFragment: string, message: string) {
  let rejected = false;
  try {
    await fn();
  } catch (error) {
    rejected = true;
    const text = error instanceof Error ? error.message : String(error);
    check(text.includes(expectedFragment), `${message} (unexpected error: ${text})`);
  }
  check(rejected, `${message} (expected rejection)`);
}

async function makeApprovedCategoryAsset(options: {
  id: string;
  category: SkinClass;
  topic: EducationTopic;
  locale: EducationLocale;
  ext: '.mp3' | '.m4a' | '.wav' | '.ogg';
  text: string;
  audioBytes: Uint8Array<ArrayBuffer>;
}): Promise<EducationAudioAsset> {
  const contentVersion = categoryEducation[options.category].contentVersion;
  const assetVersion = 'v1';
  const audio = `/education/skin-health/${options.category}/${contentVersion}/${assetVersion}/${options.topic}-${options.locale}${options.ext}`;
  const audioSha256 = await sha256Hex(options.audioBytes);
  const textSha256 = await sha256TextHex(options.text);
  const base: EducationAudioAsset = {
    id: options.id,
    scope: 'category',
    category: options.category,
    topic: options.topic,
    locale: options.locale,
    contentVersion,
    assetVersion,
    audio,
    audioSha256,
    textSha256,
    clinicalReview: { status: 'approved', reference: 'QA-CLIN-AUDIO-1', identity: '' },
    localeReview: { status: 'approved', reference: 'QA-LOC-AUDIO-1', identity: '' },
  };
  const identity = audioIdentity(base);
  return {
    ...base,
    clinicalReview: { ...base.clinicalReview, identity },
    localeReview: { ...base.localeReview, identity },
  };
}

async function makeApprovedGeneralAsset(options: {
  id: string;
  locale: EducationLocale;
  ext: '.mp3' | '.m4a' | '.wav' | '.ogg';
  text: string;
  audioBytes: Uint8Array<ArrayBuffer>;
}): Promise<EducationAudioAsset> {
  const contentVersion = generalEducation.contentVersion;
  const assetVersion = 'v1';
  const audio = `/education/skin-health/general/${contentVersion}/${assetVersion}/${options.locale}${options.ext}`;
  const audioSha256 = await sha256Hex(options.audioBytes);
  const textSha256 = await sha256TextHex(options.text);
  const base: EducationAudioAsset = {
    id: options.id,
    scope: 'general',
    locale: options.locale,
    contentVersion,
    assetVersion,
    audio,
    audioSha256,
    textSha256,
    clinicalReview: { status: 'approved', reference: 'QA-CLIN-GEN-1', identity: '' },
    localeReview: { status: 'approved', reference: 'QA-LOC-GEN-1', identity: '' },
  };
  const identity = audioIdentity(base);
  return {
    ...base,
    clinicalReview: { ...base.clinicalReview, identity },
    localeReview: { ...base.localeReview, identity },
  };
}

// 1. Production state preserves clinical gates and ships no unreviewed audio assets.
check(educationAudioAssets.length === 0, 'Production audio manifest must stay empty until clinically reviewed');
check(validAudioManifest(educationAudioAssets), 'Empty production audio manifest must be valid');
check(
  Object.values(categoryEducation).every((entry) => entry.review.status === 'clinical_review_required'),
  'All 7 skin categories must retain clinical_review_required',
);

// 2. Audio MIME type detection covers approved audio extensions only.
check(audioMimeType('/education/skin-health/nv/v1/what-hi.mp3') === 'audio/mpeg', 'mp3 mime');
check(audioMimeType('/education/skin-health/nv/v1/what-hi.m4a') === 'audio/mp4', 'm4a mime');
check(audioMimeType('/education/skin-health/nv/v1/what-hi.wav') === 'audio/wav', 'wav mime');
check(audioMimeType('/education/skin-health/nv/v1/what-hi.ogg') === 'audio/ogg', 'ogg mime');
check(audioMimeType('/education/skin-health/nv/v1/what-hi.mp4') === null, 'video mp4 rejected as audio');

// 3. Synthetic approved manifest binds locale, scope, category/topic, version, and SHA-256 text+audio hashes.
const encoder = new TextEncoder();
const hiAudioBytes = encoder.encode('ID3-synthetic-hindi-audio-bytes');
const hinglishAudioBytes = encoder.encode('OggS-synthetic-hinglish-audio-bytes');
const enAudioBytes = encoder.encode('RIFF-synthetic-english-audio-bytes');
const generalHiAudioBytes = encoder.encode('ID3-synthetic-general-hindi-audio');

const hiText = 'मेलेनोसाइटिक नेवस (nv) शिक्षा सामग्री।';
const hinglishText = 'Melanocytic nevi (nv) Hinglish guidance.';
const enText = 'Melanocytic nevi (nv) English guidance.';
const generalHiText = [
  generalEducation.translations.hi.description,
  generalEducation.translations.hi.modelLimits,
  generalEducation.translations.hi.doctorReview,
].join(' ');

const syntheticCategoryHi = await makeApprovedCategoryAsset({
  id: 'qa-nv-what-hi',
  category: 'nv',
  topic: 'what',
  locale: 'hi',
  ext: '.mp3',
  text: hiText,
  audioBytes: hiAudioBytes,
});
const syntheticCategoryHinglish = await makeApprovedCategoryAsset({
  id: 'qa-nv-what-hi-latn',
  category: 'nv',
  topic: 'what',
  locale: 'hi-Latn',
  ext: '.ogg',
  text: hinglishText,
  audioBytes: hinglishAudioBytes,
});
const syntheticCategoryEn = await makeApprovedCategoryAsset({
  id: 'qa-nv-what-en',
  category: 'nv',
  topic: 'what',
  locale: 'en',
  ext: '.wav',
  text: enText,
  audioBytes: enAudioBytes,
});
const syntheticGeneralHi = await makeApprovedGeneralAsset({
  id: 'qa-general-hi',
  locale: 'hi',
  ext: '.mp3',
  text: generalHiText,
  audioBytes: generalHiAudioBytes,
});

const syntheticManifest: EducationAudioAsset[] = [
  syntheticCategoryHi,
  syntheticCategoryHinglish,
  syntheticCategoryEn,
  syntheticGeneralHi,
];
check(validAudioManifest(syntheticManifest), 'Valid synthetic manifest passes integrity checks');

// Exact resolution across all 3 locales + general fallback
check(
  resolveEducationAudio(
    {
      scope: 'category',
      category: 'nv',
      topic: 'what',
      locale: 'hi',
      contentVersion: categoryEducation.nv.contentVersion,
      textSha256: await sha256TextHex(hiText),
    },
    syntheticManifest,
  )?.id === 'qa-nv-what-hi',
  'Resolves synthetic Hindi category audio',
);
check(
  resolveEducationAudio(
    {
      scope: 'category',
      category: 'nv',
      topic: 'what',
      locale: 'hi-Latn',
      contentVersion: categoryEducation.nv.contentVersion,
      textSha256: await sha256TextHex(hinglishText),
    },
    syntheticManifest,
  )?.id === 'qa-nv-what-hi-latn',
  'Resolves synthetic Hinglish category audio',
);
check(
  resolveEducationAudio(
    {
      scope: 'category',
      category: 'nv',
      topic: 'what',
      locale: 'en',
      contentVersion: categoryEducation.nv.contentVersion,
      textSha256: await sha256TextHex(enText),
    },
    syntheticManifest,
  )?.id === 'qa-nv-what-en',
  'Resolves synthetic English category audio',
);
check(
  resolveEducationAudio(
    {
      scope: 'general',
      locale: 'hi',
      contentVersion: generalEducation.contentVersion,
      textSha256: await sha256TextHex(generalHiText),
    },
    syntheticManifest,
  )?.id === 'qa-general-hi',
  'Resolves synthetic Hindi general education audio',
);

// Mismatches & unapproved assets must return null
check(
  resolveEducationAudio(
    {
      scope: 'category',
      category: 'nv',
      topic: 'why',
      locale: 'hi',
      contentVersion: categoryEducation.nv.contentVersion,
      textSha256: await sha256TextHex(hiText),
    },
    syntheticManifest,
  ) === null,
  'Topic mismatch returns null',
);
check(
  resolveEducationAudio(
    {
      scope: 'category',
      category: 'mel',
      topic: 'what',
      locale: 'hi',
      contentVersion: categoryEducation.mel.contentVersion,
      textSha256: await sha256TextHex(hiText),
    },
    syntheticManifest,
  ) === null,
  'Category mismatch returns null',
);
check(
  resolveEducationAudio(
    {
      scope: 'category',
      category: 'nv',
      topic: 'what',
      locale: 'hi',
      contentVersion: categoryEducation.nv.contentVersion,
      textSha256: await sha256TextHex('Modified narration text'),
    },
    syntheticManifest,
  ) === null,
  'Text hash mismatch rejects audio match',
);
check(
  !validAudioManifest([
    { ...syntheticCategoryHi, clinicalReview: { ...syntheticCategoryHi.clinicalReview, status: 'clinical_review_required' } },
  ]),
  'Unapproved clinicalReview is rejected',
);
check(
  !validAudioManifest([
    { ...syntheticCategoryHi, localeReview: { ...syntheticCategoryHi.localeReview, reference: '   ' } },
  ]),
  'Blank review reference is rejected',
);
check(
  !validAudioManifest([
    { ...syntheticCategoryHi, audio: 'https://cdn.example.com/what-hi.mp3' },
  ]),
  'Cross-origin audio URL is rejected',
);
check(
  !validAudioManifest([
    { ...syntheticCategoryHi, audio: '/education/skin-health/nv/../mel/what-hi.mp3' },
  ]),
  'Path traversal audio URL is rejected',
);
check(
  !validAudioManifest([
    { ...syntheticCategoryHi },
    { ...syntheticCategoryHi, id: 'qa-duplicate-slot' },
  ]),
  'Duplicate release slot is rejected',
);

// 4. loadVerifiedAudio enforces same-origin, redirect: error, credentials: omit, text SHA-256, and byte SHA-256.
const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const createdObjectUrls: string[] = [];
let seenInit: RequestInit | undefined;
let seenUrl = '';
let responseBytes = hiAudioBytes;
let responseOk = true;

try {
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    check(blob instanceof Blob && blob.type === 'audio/mpeg', 'Creates audio/mpeg Blob');
    const url = `blob:anvaya-test/${createdObjectUrls.length + 1}`;
    createdObjectUrls.push(url);
    return url;
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = typeof input === 'string' ? input : input.toString();
    seenInit = init;
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return new Response(responseOk ? responseBytes : null, { status: responseOk ? 200 : 404 });
  }) as typeof fetch;

  const controller = new AbortController();
  const blobUrl = await loadVerifiedAudio(syntheticCategoryHi, hiText, controller.signal);
  check(blobUrl === 'blob:anvaya-test/1', 'Returns verified blob URL');
  check(seenUrl === syntheticCategoryHi.audio, 'Requests exact same-origin manifest path');
  check(
    seenInit?.mode === 'same-origin' &&
      seenInit?.redirect === 'error' &&
      seenInit?.credentials === 'omit',
    'Fetch enforces same-origin, no redirects, and omitted credentials',
  );

  // Tampered expected text rejects before fetch
  seenUrl = '';
  await checkRejects(
    () => loadVerifiedAudio(syntheticCategoryHi, 'Tampered caption text', controller.signal),
    'Audio text binding mismatch',
    'Tampered expected text rejected',
  );
  check(seenUrl === '', 'Text mismatch aborts before network fetch');

  // Tampered audio bytes reject on SHA-256 check
  responseBytes = encoder.encode('tampered-mp3-bytes');
  await checkRejects(
    () => loadVerifiedAudio(syntheticCategoryHi, hiText, controller.signal),
    'Media integrity check failed',
    'Tampered audio bytes rejected',
  );

  // HTTP error status rejects cleanly
  responseBytes = hiAudioBytes;
  responseOk = false;
  await checkRejects(
    () => loadVerifiedAudio(syntheticCategoryHi, hiText, controller.signal),
    'Media unavailable',
    '404 audio response rejected',
  );

  // Pre-aborted controller stops playback cleanly
  responseOk = true;
  const aborted = new AbortController();
  aborted.abort();
  await checkRejects(
    () => loadVerifiedAudio(syntheticCategoryHi, hiText, aborted.signal),
    'Abort',
    'Aborted fetch rejects cleanly',
  );
} finally {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
}

// 5. createVerifiedBlobAudioPlayer manages Play / Pause / Resume / Stop, error recovery, and cleanup.
{
  const elementEvents: string[] = [];
  const createdElements: AudioElementLike[] = [];
  let shouldRejectPlay = false;
  const player = createVerifiedBlobAudioPlayer((url) => {
    const mock: AudioElementLike = {
      src: url,
      currentTime: 0,
      onended: null,
      onerror: null,
      play() {
        elementEvents.push('play');
        if (shouldRejectPlay) return Promise.reject(new Error('Autoplay blocked'));
        return Promise.resolve();
      },
      pause() {
        elementEvents.push('pause');
      },
    };
    createdElements.push(mock);
    return mock;
  });

  const states: string[] = [];
  const unsubscribe = player.subscribe(() => states.push(player.state()));
  check(player.state() === 'idle', 'Initial blob player state is idle');
  player.play();
  check(player.state() === 'idle', 'Play without source stays idle');

  player.setSource('blob:anvaya-test/hi');
  player.play();
  check(player.state() === 'playing', 'Play transitions to playing');
  check(createdElements.length === 1 && elementEvents.join(',') === 'play', 'Starts underlying audio element');

  player.pause();
  check(player.state() === 'paused', 'Pause transitions to paused');
  check(elementEvents.join(',') === 'play,pause,pause' || elementEvents.join(',') === 'play,pause', 'Pauses underlying audio element');

  player.resume();
  check(player.state() === 'playing', 'Resume transitions back to playing');
  check(elementEvents.filter((event) => event === 'play').length === 2, 'Resumes underlying audio element');

  createdElements[0].currentTime = 12.5;
  player.stop();
  check(player.state() === 'idle', 'Stop transitions to idle');
  check(createdElements[0].currentTime === 0 && createdElements[0].src === '', 'Stop resets audio element');

  // Natural end returns cleanly to idle
  player.play();
  check(player.state() === 'playing', 'Re-plays after stop');
  createdElements[1].onended?.call(createdElements[1] as unknown as GlobalEventHandlers, new Event('ended'));
  check(player.state() === 'idle', 'Natural end returns to idle');

  // Element error transitions to error and cleans up
  player.play();
  createdElements[2].onerror?.call(createdElements[2] as unknown as GlobalEventHandlers, new Event('error'));
  check(player.state() === 'error', 'Audio error transitions to error state');

  // Async play() rejection transitions to error
  shouldRejectPlay = true;
  player.setSource('blob:anvaya-test/hi-2');
  player.play();
  await Promise.resolve();
  check(player.state() === 'error', 'Rejected play() promise transitions to error');

  // setSource(null) clears and resets to idle
  player.setSource(null);
  check(player.state() === 'idle', 'setSource(null) resets state to idle');
  check(states.includes('playing') && states.includes('paused'), 'Notified subscribers of transitions');
  unsubscribe();
}

// 6. Local TTS privacy guard rejects Chrome Google हिन्दी (localService: false) and allows true local Hindi voices.
{
  const chromeHindiRemote = {
    lang: 'hi-IN',
    name: 'Google हिन्दी',
    localService: false,
    default: false,
    voiceURI: 'Google हिन्दी',
  } as SpeechSynthesisVoice;
  const localEnglish = {
    lang: 'en-US',
    name: 'Microsoft David',
    localService: true,
    default: true,
    voiceURI: 'Microsoft David',
  } as SpeechSynthesisVoice;
  const localHindi = {
    lang: 'hi-IN',
    name: 'Offline Hindi',
    localService: true,
    default: false,
    voiceURI: 'Offline Hindi',
  } as SpeechSynthesisVoice;

  check(
    selectLocalVoice([chromeHindiRemote, localEnglish], 'hi') === undefined,
    'Google हिन्दी remote voice (localService: false) must never be selected',
  );
  check(
    selectLocalVoice([chromeHindiRemote, localEnglish], 'hi-Latn') === undefined,
    'Hinglish must reject remote Hindi/English fallback voices',
  );
  check(
    selectLocalVoice([chromeHindiRemote, localHindi], 'hi')?.name === 'Offline Hindi',
    'Selects genuine localService: true Hindi voice when present',
  );

  let spoke = false;
  class FakeUtterance {
    text: string;
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const fakeSynth = {
    speaking: false,
    paused: false,
    pending: false,
    onvoiceschanged: null,
    getVoices: () => [chromeHindiRemote, localEnglish],
    speak() {
      spoke = true;
    },
    cancel() {},
    pause() {},
    resume() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  } as unknown as SpeechSynthesis;

  const narrator = createBrowserNarrator(
    fakeSynth,
    FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
  );
  check(narrator.available('en'), 'English local voice remains available');
  check(!narrator.available('hi'), 'Hindi narrator unavailable when only Chrome remote Google हिन्दी exists');
  check(!narrator.available('hi-Latn'), 'Hinglish narrator unavailable without local Hinglish voice');
  narrator.play('hi', hiText);
  check(!spoke, 'Never invokes speechSynthesis.speak with remote Hindi voice');
  check(narrator.state() === 'idle', 'Retains idle Read-mode fallback state without throwing');
}

// 7. subscribeAvailability listener lifecycle and cleanup regression tests
{
  let listener1Count = 0;
  let listener2Count = 0;
  let initialHandlerCount = 0;

  const initialHandler = () => {
    initialHandlerCount++;
  };

  const attachedListeners: Record<string, ((e?: Event) => void)[]> = {};
  const removedListeners: Record<string, ((e?: Event) => void)[]> = {};

  const fakeSynth = {
    speaking: false,
    paused: false,
    pending: false,
    onvoiceschanged: initialHandler,
    getVoices: () => [],
    speak() {},
    cancel() {},
    pause() {},
    resume() {},
    addEventListener(event: string, handler: (e?: Event) => void) {
      attachedListeners[event] = attachedListeners[event] || [];
      attachedListeners[event].push(handler);
    },
    removeEventListener(event: string, handler: (e?: Event) => void) {
      removedListeners[event] = removedListeners[event] || [];
      removedListeners[event].push(handler);
    },
    dispatchEvent: () => true,
  } as unknown as SpeechSynthesis;

  const narrator = createBrowserNarrator(fakeSynth, undefined);

  // Initial state: synth.onvoiceschanged is initialHandler
  check(fakeSynth.onvoiceschanged === initialHandler, 'Initial synth.onvoiceschanged is preserved');

  // Step A: Subscribe first listener
  const unsubscribe1 = narrator.subscribeAvailability(() => {
    listener1Count++;
  });

  // Verify wrapper installed and addEventListener called once
  check(fakeSynth.onvoiceschanged !== initialHandler, 'Wrapper installed onto synth.onvoiceschanged');
  check(typeof fakeSynth.onvoiceschanged === 'function', 'Wrapper is a function');
  check(attachedListeners['voiceschanged']?.length === 1, 'voiceschanged event listener registered');
  const activeWrapper = fakeSynth.onvoiceschanged;

  // Trigger event via onvoiceschanged
  (fakeSynth.onvoiceschanged as ((e?: Event) => void) | null)?.();
  check(Boolean(initialHandlerCount === 1), 'Chained previous handler executed');
  check(Boolean(listener1Count === 1), 'First subscriber notified');

  // Step B: Subscribe second listener - should share single synth listener attachment
  const unsubscribe2 = narrator.subscribeAvailability(() => {
    listener2Count++;
  });
  check(attachedListeners['voiceschanged']?.length === 1, 'No duplicate addEventListener call for second subscriber');
  check(fakeSynth.onvoiceschanged === activeWrapper, 'Same wrapper maintained');

  // Trigger event again
  (fakeSynth.onvoiceschanged as ((e?: Event) => void) | null)?.();
  check(Boolean(initialHandlerCount === 2), 'Previous handler executed second time');
  check(Boolean(listener1Count === 2), 'First subscriber notified second time');
  check(Boolean(listener2Count === 1), 'Second subscriber notified first time');

  // Step C: Unsubscribe first listener - second remains active, cleanup should NOT occur yet
  unsubscribe1();
  check(fakeSynth.onvoiceschanged === activeWrapper, 'Wrapper maintained while second subscriber is active');
  check((removedListeners['voiceschanged'] || []).length === 0, 'No removeEventListener call while active subscribers remain');

  // Trigger event again - only listener2 should fire
  (fakeSynth.onvoiceschanged as ((e?: Event) => void) | null)?.();
  check(Boolean(listener1Count === 2), 'Unsubscribed listener1 not notified');
  check(Boolean(listener2Count === 2), 'Active listener2 notified');

  // Step D: Unsubscribe second listener - should trigger complete cleanup
  unsubscribe2();
  check(fakeSynth.onvoiceschanged === initialHandler, 'synth.onvoiceschanged exactly restored to initialHandler');
  check((removedListeners['voiceschanged'] || []).length === 1, 'removeEventListener called exactly once');
  check(removedListeners['voiceschanged'][0] === activeWrapper, 'removeEventListener passed exact wrapper function');

  // Step E: Repeated React mount/unmount cycles (5 consecutive mount/unmount cycles)
  for (let cycle = 1; cycle <= 5; cycle++) {
    let cycleFired = 0;
    const unmount = narrator.subscribeAvailability(() => {
      cycleFired++;
    });
    check(fakeSynth.onvoiceschanged !== initialHandler, `Cycle ${cycle}: wrapper attached`);
    // Trigger
    (fakeSynth.onvoiceschanged as ((e?: Event) => void) | null)?.();
    check(Boolean(cycleFired === 1), `Cycle ${cycle}: fired once`);
    // Unmount
    unmount();
    check(fakeSynth.onvoiceschanged === initialHandler, `Cycle ${cycle}: clean restoration to initialHandler`);
  }

  // After all cycles, verify initialHandler is still intact and zero leaked callbacks
  (fakeSynth.onvoiceschanged as ((e?: Event) => void) | null)?.();
  check(Boolean(initialHandlerCount === 2 + 1 + 5 + 1), 'initialHandler count verified with zero leaked callbacks');
}

console.log('audioPlayback tests passed');
