import {
  approvedTranslation, categoryEducation, educationTopics, topicFields, type CategoryEducation, classCodes, educationPrediction, generalEducation,
  legacyScreeningLanguage, locales, resolveEducationLocale, supportedModel,
} from './catalog.ts';
import { createBrowserNarrator, selectLocalVoice } from './narration.ts';
import { modelLabels } from '../../types/skinLesion.ts';
import type { SkinLesionAnalysis } from '../../types/skinLesion.ts';

function check(value: unknown, description: string) {
  if (!value) throw new Error(description);
}

const scan = {
  id: 'synthetic', patient_profile_id: 'synthetic', predicted_class: 'mel',
  predicted_label: 'Melanoma', confidence: 1, probabilities: { akiec: 0, bcc: 0, bkl: 0, df: 0, mel: 1, nv: 0, vasc: 0 }, risk_level: null,
  disclaimer: 'Synthetic fixture', created_at: '2026-01-01T00:00:00Z',
  inference_mode: 'pytorch_efficientnet_b0', model_version: supportedModel.version,
  checkpoint_sha256: supportedModel.sha256,
} satisfies SkinLesionAnalysis;
const model = { available: true, model_version: supportedModel.version };

check(classCodes.join() === 'akiec,bcc,bkl,df,mel,nv,vasc', 'All seven inference classes');
check(locales.join() === 'en,hi,hi-Latn', 'All three locale tags');
for (const locale of locales) {
  check(generalEducation.translations[locale].modelLimits.length > 0, 'General safety copy in every locale');
  check(legacyScreeningLanguage(locale) === (locale === 'hi' ? 'hi' : 'en'), 'API language allowlist');
  for (const code of classCodes) {
    check(educationPrediction({ ...scan, predicted_class: code, predicted_label: modelLabels[code], probabilities: { ...scan.probabilities, mel: 0, [code]: 1 } }, model)?.predicted_class === code, 'Supported class');
    const entry = categoryEducation[code];
    check(entry.contentVersion === categoryEducation.nv.contentVersion && entry.references.length === 2, 'Shared version and references');
    check(entry.review.status === 'clinical_review_required' && approvedTranslation(entry, locale) === null,
      'Category copy withheld in every locale');
  }
}
check(resolveEducationLocale(' HI-latn ') === 'hi-Latn', 'Match supported locale case-insensitively');
check(resolveEducationLocale('fr-CA') === 'en', 'Unsupported locale uses general English');
for (const result of [
  null, { ...scan, inference_mode: 'unknown' }, { ...scan, inference_mode: undefined },
  { ...scan, model_version: null }, { ...scan, model_version: 'unreviewed-model' },
  { ...scan, checkpoint_sha256: 'a'.repeat(64) }, { ...scan, checkpoint_sha256: null },
  { ...scan, predicted_label: '   ' }, { ...scan, predicted_class: '__proto__' },
  { ...scan, confidence: Number.NaN },
] satisfies (SkinLesionAnalysis | null)[]) {
  check(educationPrediction(result, model) === null, 'Unknown, invalid or unsupported provenance uses general education');
}
check(educationPrediction(scan, null) === null, 'Unconfirmed model availability');
check(educationPrediction(scan, { ...model, available: false }) === null, 'Unavailable model');
check(educationPrediction(scan, { ...model, model_version: 'another-model' }) === null, 'Mismatched availability version');
const fixtureCopy = {
  categoryTitle: 'Fixture title', whatIsIt: 'Fixture definition', possibleCausesAndRiskFactors: 'Fixture factors',
  howItGenerallyDevelops: 'Fixture course', commonVisibleCharacteristics: 'Fixture appearance',
  warningSigns: 'Fixture warning', whenToSeekMedicalAttention: 'Fixture action',
  commonClinicalEvaluationApproaches: 'Fixture evaluation', whatTheAIResultCannotTellYou: 'Fixture limits',
  doctorReviewReminder: 'Fixture reminder', reviewedNarrationScript: { what: 'W', why: 'Y', how: 'H', next: 'N' },
  approvedVideoAssetReference: null,
};
const base = categoryEducation.mel;
const approval = { status: 'approved', category: base.code, contentVersion: base.contentVersion,
  reviewedOn: '2026-01-01', reviewReference: 'synthetic-test-only' } as const;
const localized = { copy: fixtureCopy, localeRevision: '1', review: { ...approval, locale: 'hi', localeRevision: '1' } } as const;
const candidate: CategoryEducation = {
  ...base, review: approval, translations: { en: null, hi: localized, 'hi-Latn': null },
};
check(approvedTranslation(candidate, 'hi') === fixtureCopy, 'Independent approval for requested locale');
check(approvedTranslation(candidate, 'en') === null && approvedTranslation(candidate, 'hi-Latn') === null,
  'No cross-language approval fallback');
for (const review of [
  { status: 'clinical_review_required' }, { ...approval, contentVersion: 'old' },
  { ...approval, category: 'df' }, { ...approval, reviewedOn: '' }, { ...approval, reviewReference: ' ' },
] satisfies CategoryEducation['review'][]) {
  check(approvedTranslation({ ...candidate, review }, 'hi') === null, 'Clinical approval must match source');
}
for (const review of [
  { status: 'draft' }, { status: 'clinical_review_required' }, { ...localized.review, locale: 'en' },
  { ...localized.review, localeRevision: 'old' }, { ...localized.review, contentVersion: 'old' },
  { ...localized.review, category: 'nv' }, { ...localized.review, reviewReference: ' ' },
] satisfies NonNullable<CategoryEducation['translations']['hi']>['review'][]) {
  check(approvedTranslation({ ...candidate, translations: { ...candidate.translations, hi: { ...localized, review } } }, 'hi') === null,
    'Locale approval must match class, language, clinical version and locale revision');
}
for (const topic of educationTopics) {
  check(topicFields[topic].every((field) => fixtureCopy[field].length > 0) && fixtureCopy.reviewedNarrationScript[topic],
    'Every approved topic resolves reading and narration');
}

function voice(lang: string, localService: boolean): SpeechSynthesisVoice {
  return { lang, localService, name: lang, voiceURI: lang, default: false };
}
const localHindi = voice('hi-IN', true);
const localEnglish = voice('en-US', true);
const latinHindi = voice('hi-Latn-IN', true);
const remoteHindi = voice('hi', false);
const remoteLatinHindi = voice('hi-Latn', false);
check(selectLocalVoice([remoteHindi, localEnglish, localHindi], 'hi') === localHindi, 'Use compatible local Hindi');
check(!selectLocalVoice([localHindi, localEnglish, remoteLatinHindi], 'hi-Latn'), 'Hinglish needs compatible local voice');
check(selectLocalVoice([latinHindi], 'hi-Latn') === latinHindi, 'Recognize explicit Roman Hindi voice');
check(!selectLocalVoice([latinHindi], 'hi'), 'Hindi does not use Roman Hindi voices');
check(!selectLocalVoice([voice('en', false)], 'en'), 'Remote speech refused');

class MockUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
}
let voices: SpeechSynthesisVoice[] = [];
let spoken: MockUtterance[] = [];
let cancelled = 0;
const events = new EventTarget();
const actions: string[] = [];
const speech = {
  getVoices: () => voices,
  speak: (utterance: MockUtterance) => { spoken = [...spoken, utterance]; },
  pause: () => actions.push('pause'),
  resume: () => actions.push('resume'),
  cancel: () => { cancelled++; spoken.at(-1)?.onerror?.(); },
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
};
const narrator = createBrowserNarrator(speech as unknown as SpeechSynthesis,
  MockUtterance as unknown as typeof SpeechSynthesisUtterance);
const updates: string[] = [];
const unsubscribe = narrator.subscribe(() => updates.push(narrator.state()));
let voiceUpdates = 0;
const stopWatching = narrator.subscribeAvailability(() => { voiceUpdates++; });
check(narrator.state() === 'idle' && !narrator.available('en') && spoken.length === 0, 'Initial state never autoplays');
voices = [localEnglish];
events.dispatchEvent(new Event('voiceschanged'));
check(voiceUpdates === 1 && narrator.available('en') && spoken.length === 0, 'Voice discovery never autoplays');
stopWatching();
events.dispatchEvent(new Event('voiceschanged'));
check(voiceUpdates === 1, 'Voice listener cleaned up');
narrator.play('hi-Latn', 'Synthetic text');
check(spoken.length === 0, 'Unavailable voice never speaks');
narrator.play('en', 'Synthetic text');
narrator.play('en', 'Repeated request');
check(narrator.state() === 'playing' && spoken.length === 1 && spoken[0].voice === localEnglish, 'One local utterance');
narrator.pause();
check(narrator.state() === 'paused', 'Pause');
narrator.resume();
check(narrator.state() === 'playing' && actions.join() === 'pause,resume', 'Resume');
narrator.stop();
check(cancelled === 1 && narrator.state() === 'idle', 'Stop ignores cancellation callbacks');
narrator.play('en', 'Second request');
spoken[0].onend?.();
check(narrator.state() === 'playing', 'Late callbacks do not finish newer speech');
spoken[1].onerror?.();
check(narrator.state() === 'error', 'Playback error exposed');
narrator.play('en', 'Retry');
spoken[2].onend?.();
check(narrator.state() === 'idle', 'Playback completion resets state');
unsubscribe();
const updateCount = updates.length;
narrator.stop();
check(updates.length === updateCount && cancelled === 1, 'Teardown without an active utterance does not cancel global audio');
console.log('Stage 3A education catalog, provenance, caption and audio state checks passed');
