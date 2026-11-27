import api from './api';
import { skinLesionResponse } from './skinLesionJson';
import type {
  SkinLesionAnalysis,
  SkinLesionListResponse,
  SkinLesionClassesResponse,
  SkinLesionReviewPayload,
} from '../types/skinLesion';

export const aiService = {
  async getSupportedClasses(): Promise<SkinLesionClassesResponse> {
    const response = await api.get<SkinLesionClassesResponse>('/ai/skin-lesion/classes');
    return response.data;
  },

  async analyzeSkinLesion(file: File, language: 'en' | 'hi' = 'en'): Promise<SkinLesionAnalysis> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<SkinLesionAnalysis>(
      `/ai/skin-lesion/analyze?language=${language}`,
      formData,
      {
        ...skinLesionResponse,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  },

  async getMyAnalyses(page: number = 1, pageSize: number = 20): Promise<SkinLesionListResponse> {
    const response = await api.get<SkinLesionListResponse>('/ai/skin-lesion/me', {
      ...skinLesionResponse,
      params: { page, page_size: pageSize },
    });
    return response.data;
  },

  async getPatientAnalyses(patientProfileId: string): Promise<SkinLesionListResponse> {
    const response = await api.get<SkinLesionListResponse>(
      `/ai/skin-lesion/patient/${patientProfileId}`, skinLesionResponse
    );
    return response.data;
  },

  async reviewAnalysis(
    analysisId: string,
    payload: SkinLesionReviewPayload
  ): Promise<SkinLesionAnalysis> {
    const response = await api.patch<SkinLesionAnalysis>(
      `/ai/skin-lesion/${analysisId}/review`,
      payload, skinLesionResponse
    );
    return response.data;
  },
};
