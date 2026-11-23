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
  predicted_class: string;
  predicted_label: string;
  confidence: number;
  probabilities: Record<string, number>;
  risk_level: RiskLevel;
  disclaimer: string;
  education_title?: string | null;
  education_summary?: string | null;
  education_content?: SkinLesionEducation | null;
  reviewed_by_doctor_id?: string | null;
  doctor_notes?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  inference_mode?: string | null;
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
  model_version: string;
  classes: SkinLesionClassItem[];
  supported_languages: string[];
  disclaimer: string;
}

export interface SkinLesionReviewPayload {
  doctor_notes: string;
}
