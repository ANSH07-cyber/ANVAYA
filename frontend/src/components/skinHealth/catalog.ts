import { supportedModel, classCodes, type SkinClass, hasVerifiedSkinPrediction, type SkinLesionAnalysis, type SkinLesionClassesResponse } from '../../types/skinLesion.ts';

export const locales = ['en', 'hi', 'hi-Latn'] as const;
export type EducationLocale = typeof locales[number];

export const localeNames = { en: 'English', hi: 'हिंदी', 'hi-Latn': 'Hinglish' } satisfies Record<EducationLocale, string>;

export { classCodes, supportedModel, type SkinClass } from '../../types/skinLesion.ts';

const editorialSource = 'ANVAYA ML Stage 2B / patient_education_spec.md';
const taxonomySource = 'https://doi.org/10.1038/sdata.2018.161';

export function resolveEducationLocale(requested: string): EducationLocale {
  return locales.find((locale) => locale.toLowerCase() === requested.trim().toLowerCase()) ?? 'en';
}

export function legacyScreeningLanguage(locale: EducationLocale): 'en' | 'hi' {
  return locale === 'hi' ? 'hi' : 'en';
}

function hasSupportedClass(result: { predicted_class: string }): result is { predicted_class: SkinClass } {
  return classCodes.some((code) => code === result.predicted_class);
}

export function educationPrediction(
  result: SkinLesionAnalysis | null,
  model: Pick<SkinLesionClassesResponse, 'available' | 'model_version'> | null,
) {
  if (model?.available !== true || model.model_version !== supportedModel.version ||
      !result || !hasVerifiedSkinPrediction(result) ||
      result.model_version !== supportedModel.version || result.checkpoint_sha256 !== supportedModel.sha256 ||
      !result.predicted_label.trim() || !hasSupportedClass(result)) {
    return null;
  }
  return result;
}

export const topicFields = {
  what: ['whatIsIt'],
  why: ['possibleCausesAndRiskFactors'],
  how: ['howItGenerallyDevelops', 'commonVisibleCharacteristics'],
  next: ['warningSigns', 'whenToSeekMedicalAttention', 'commonClinicalEvaluationApproaches'],
} as const;

export type EducationTopic = keyof typeof topicFields;
export const educationTopics = ['what', 'why', 'how', 'next'] as const;
export const topicLabels = {
  en: { what: 'What is it?', why: 'Why can it develop?', how: 'How does it appear?', next: 'What next?' },
  hi: { what: 'यह क्या है?', why: 'यह क्यों हो सकता है?', how: 'यह कैसा दिख सकता है?', next: 'आगे क्या करें?' },
  'hi-Latn': { what: 'Yeh kya hai?', why: 'Yeh kyun ho sakta hai?', how: 'Yeh kaisa dikh sakta hai?', next: 'Aage kya karein?' },
} satisfies Record<EducationLocale, Record<EducationTopic, string>>;

type TopicField = typeof topicFields[EducationTopic][number];
export type EducationTranslation = Record<TopicField, string> & {
  categoryTitle: string;
  whatTheAIResultCannotTellYou: string;
  doctorReviewReminder: string;
  reviewedNarrationScript: Record<EducationTopic, string>;
  approvedVideoAssetReference: string | null;
};

type PendingReview = { status: 'draft' | 'clinical_review_required' };
type Approval = {
  status: 'approved';
  category: SkinClass;
  contentVersion: string;
  reviewedOn: string;
  reviewReference: string;
};
type LocaleApproval = Approval & { locale: EducationLocale; localeRevision: string };

export interface CategoryEducation {
  code: SkinClass;
  referenceName: string;
  contentVersion: string;
  references: readonly string[];
  review: PendingReview | Approval;
  translations: Record<EducationLocale, null | {
    localeRevision: string;
    review: PendingReview | LocaleApproval;
    copy: EducationTranslation;
  }>;
}

const names = {
  akiec: 'Actinic keratoses and intraepithelial carcinoma',
  bcc: 'Basal cell carcinoma',
  bkl: 'Benign keratosis-like lesions',
  df: 'Dermatofibroma',
  mel: 'Melanoma',
  nv: 'Melanocytic nevi',
  vasc: 'Vascular lesions',
} satisfies Record<SkinClass, string>;

function pendingCategory(code: SkinClass): CategoryEducation {
  return {
    code,
    referenceName: names[code],
    contentVersion: 'skin-health-3a1.1',
    references: [editorialSource, taxonomySource],
    review: { status: 'clinical_review_required' },
    translations: { en: null, hi: null, 'hi-Latn': null },
  };
}

export const categoryEducation: Readonly<Record<SkinClass, CategoryEducation>> = {
  akiec: pendingCategory('akiec'),
  bcc: pendingCategory('bcc'),
  bkl: pendingCategory('bkl'),
  df: pendingCategory('df'),
  mel: pendingCategory('mel'),
  nv: pendingCategory('nv'),
  vasc: pendingCategory('vasc'),
};

function matchesVersion(review: Approval, entry: CategoryEducation) {
  return review.category === entry.code && review.contentVersion === entry.contentVersion &&
    Boolean(review.reviewReference.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(review.reviewedOn);
}

export function approvedTranslation(entry: CategoryEducation, locale: EducationLocale) {
  if (entry.review.status !== 'approved' || !matchesVersion(entry.review, entry)) return null;
  const translation = entry.translations[locale];
  if (!translation || translation.review.status !== 'approved') return null;
  const review = translation.review;
  if (!matchesVersion(review, entry) || review.locale !== locale ||
      !translation.localeRevision.trim() || review.localeRevision !== translation.localeRevision) return null;
  return translation.copy;
}

export const generalEducation = {
  contentVersion: 'skin-health-general-stage3a',
  references: [editorialSource, 'ANVAYA ML Stage 2A / evaluation_report.html'],
  translations: {
    en: {
      title: 'Skin Health education',
      description: 'An AI screening result is separate from a clinician’s assessment.',
      modelLimits: 'The model can make mistakes. Its scores cannot tell you your health risk or how urgently you need care.',
      doctorReview: 'A clinician can assess a skin change that concerns you.',
      read: 'Read', listen: 'Listen', watch: 'Watch',
      play: 'Play narration', pause: 'Pause narration', resume: 'Resume narration', stop: 'Stop narration',
      noVoice: 'A compatible local voice is unavailable. The explanation is available to read.',
      audioError: 'Narration could not play. Try again or read the explanation.',
      noVideo: 'A captioned video is currently unavailable.',
      videoError: 'The video or its captions could not load. The explanation is available to read.',
    },
    hi: {
      title: 'त्वचा स्वास्थ्य की जानकारी',
      description: 'एआई स्क्रीनिंग का परिणाम और डॉक्टर का आकलन अलग-अलग हैं।',
      modelLimits: 'मॉडल से गलती हो सकती है। इसके स्कोर से स्वास्थ्य जोखिम या देखभाल की ज़रूरत कितनी जल्दी है, इसका पता नहीं चलता।',
      doctorReview: 'त्वचा में किसी बदलाव को लेकर चिंता हो तो डॉक्टर उसका आकलन कर सकते हैं।',
      read: 'पढ़ें', listen: 'सुनें', watch: 'देखें',
      play: 'जानकारी सुनें', pause: 'कुछ देर रोकें', resume: 'फिर से सुनें', stop: 'सुनना बंद करें',
      noVoice: 'इस भाषा में डिवाइस की आवाज़ उपलब्ध नहीं है। आप जानकारी पढ़ सकते हैं।',
      audioError: 'आवाज़ नहीं चल पाई। फिर कोशिश करें या जानकारी पढ़ें।',
      noVideo: 'कैप्शन वाला वीडियो अभी उपलब्ध नहीं है।',
      videoError: 'वीडियो या कैप्शन लोड नहीं हुए। आप जानकारी पढ़ सकते हैं।',
    },
    'hi-Latn': {
      title: 'Skin health ki jaankari',
      description: 'AI screening ka result aur doctor ka assessment alag hain.',
      modelLimits: 'Model se galti ho sakti hai. Iske scores se health risk ya kitni jaldi care chahiye, iska pata nahi chalta.',
      doctorReview: 'Skin mein kisi badlav ko lekar chinta ho to doctor uska assessment kar sakte hain.',
      read: 'Padhein', listen: 'Sunein', watch: 'Dekhein',
      play: 'Jaankari sunein', pause: 'Thodi der rokein', resume: 'Phir se sunein', stop: 'Sunna band karein',
      noVoice: 'Is language mein device ki voice available nahi hai. Aap jaankari padh sakte hain.',
      audioError: 'Audio play nahi hua. Phir koshish karein ya jaankari padhein.',
      noVideo: 'Captions wala video abhi available nahi hai.',
      videoError: 'Video ya captions load nahi hue. Aap jaankari padh sakte hain.',
    },
  },
} as const;
