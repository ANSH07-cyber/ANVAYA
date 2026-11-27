export type RiskLevel = 'low' | 'medium' | 'high';

export interface SkinLesionEducation {
  title?: string;
  what_it_means?: string;
  general_background?: string;
  when_to_seek_care?: string;
  global_cause_note?: string;
  global_disclaimer?: string;
}

export interface SkinLesionAnalysis {
  id: string;
  patient_profile_id: string;
  image_filename?: string | null;
  predicted_class: string | null;
  predicted_label: string | null;
  confidence: number | null;
  probabilities: Record<string, number>;
  risk_level: RiskLevel | null;
  disclaimer: string;
  education_title?: string | null;
  education_summary?: string | null;
  education_content?: SkinLesionEducation | null;
  reviewed_by_doctor_id?: string | null;
  doctor_notes?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  inference_mode?: 'pytorch_efficientnet_b0' | 'unknown' | null;
  model_version?: string | null;
  checkpoint_sha256?: string | null;
}

export const classCodes = ['akiec', 'bcc', 'bkl', 'df', 'mel', 'nv', 'vasc'] as const;
export type SkinClass = typeof classCodes[number];

export const supportedModel = {
  version: 'anvaya-skin-lesion-v1',
  sha256: 'eb6795596459e9436c59ef4c5628f07f1a9418688a4389024a801a5c7266babb',
} as const;

export const modelLabels: Record<SkinClass, string> = {
  akiec: 'Actinic keratoses / intraepithelial carcinoma',
  bcc: 'Basal cell carcinoma', bkl: 'Benign keratosis-like lesions', df: 'Dermatofibroma',
  mel: 'Melanoma', nv: 'Melanocytic nevi', vasc: 'Vascular lesions',
};

function matchesDistribution(scan: SkinLesionAnalysis) {
  const scores = scan.probabilities;
  if (!scores || typeof scores !== 'object' || Array.isArray(scores) ||
      Object.keys(scores).length !== classCodes.length) return false;
  let sum = 0;
  let top: SkinClass = classCodes[0];
  for (const code of classCodes) {
    const score = scores[code];
    if (!Object.hasOwn(scores, code) || !Number.isFinite(score) || score < 0 || score > 1) return false;
    sum += score;
    if (score > scores[top]) top = code;
  }
  // Match the backend float32 softmax sum tolerance and first-index tie rule.
  // The backend copies the winning probability directly into confidence.
  return Math.abs(sum - 1) <= 1e-6 && scan.predicted_class === top &&
    scan.predicted_label === modelLabels[top] && scan.confidence === scores[top];
}

type VerifiedSkinPrediction = SkinLesionAnalysis & {
  predicted_class: string;
  predicted_label: string;
  confidence: number;
  model_version: string;
  checkpoint_sha256: string;
};

export function hasVerifiedSkinPrediction(scan: SkinLesionAnalysis): scan is VerifiedSkinPrediction {
  return scan.inference_mode === 'pytorch_efficientnet_b0' &&
    scan.model_version === supportedModel.version &&
    scan.checkpoint_sha256 === supportedModel.sha256 &&
    typeof scan.predicted_class === 'string' && typeof scan.predicted_label === 'string' &&
    typeof scan.confidence === 'number' && Number.isFinite(scan.confidence) &&
    matchesDistribution(scan);
}

export interface SkinLesionListResponse {
  items: SkinLesionAnalysis[];
  total: number;
}

export interface SkinLesionClassItem {
  code: string;
  display_name: string;
}

export interface SkinLesionClassesResponse {
  model_version: string | null;
  available: boolean;
  classes: SkinLesionClassItem[];
  supported_languages: string[];
  disclaimer: string;
}

export interface SkinLesionReviewPayload {
  doctor_notes: string;
}
