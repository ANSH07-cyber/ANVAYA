import React, { useState, useEffect } from 'react';
import { aiService } from '../../../services/aiService';
import type { SkinLesionAnalysis } from '../../../types/skinLesion';
import { AlertCircle, CheckCircle2, FileText, Lock, Microscope, Send } from 'lucide-react';
import './SkinLesionReviewPanel.css';

interface SkinLesionReviewPanelProps {
  patientProfileId: string;
}

export const SkinLesionReviewPanel: React.FC<SkinLesionReviewPanelProps> = ({ patientProfileId }) => {
  const [analyses, setAnalyses] = useState<SkinLesionAnalysis[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [consentBlocked, setConsentBlocked] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Review submission state per analysis ID
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<Record<string, boolean>>({});

  const fetchAnalyses = async () => {
    setLoading(true);
    setError(null);
    setConsentBlocked(false);
    try {
      const res = await aiService.getPatientAnalyses(patientProfileId);
      setAnalyses(res.items);
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { detail?: string } } };
      if (error.response?.status === 403) {
        setConsentBlocked(true);
      } else {
        setError(error.response?.data?.detail || 'Unable to load skin lesion analyses.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientProfileId) {
      void fetchAnalyses();
    }
  }, [patientProfileId]);

  const handleReviewSubmit = async (analysisId: string) => {
    const notes = reviewNotes[analysisId]?.trim();
    if (!notes || notes.length < 2) {
      alert('Please enter at least 2 characters of clinical review notes.');
      return;
    }

    setSubmittingId(analysisId);
    try {
      const updated = await aiService.reviewAnalysis(analysisId, { doctor_notes: notes });
      setAnalyses((prev) => prev.map((item) => (item.id === analysisId ? updated : item)));
      setSubmitSuccess((prev) => ({ ...prev, [analysisId]: true }));
      setTimeout(() => {
        setSubmitSuccess((prev) => ({ ...prev, [analysisId]: false }));
      }, 3000);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      alert(error.response?.data?.detail || 'Failed to submit review notes.');
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="skin-review-panel">
      <div className="skin-review-header">
        <div className="skin-review-title-wrap">
          <Microscope size={18} className="skin-review-icon" />
          <h3 className="skin-review-title">AI Skin-Lesion Diagnostic Screenings</h3>
        </div>
        <span className="skin-review-count-badge">
          {consentBlocked ? 'Consent Required' : `${analyses.length} scan${analyses.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {loading && (
        <div className="skin-review-state-box loading">
          <p>Loading patient skin screenings...</p>
        </div>
      )}

      {consentBlocked && (
        <div className="skin-review-state-box consent-blocked">
          <Lock size={20} className="state-icon" />
          <div>
            <strong>Consent-Gated Clinical Data</strong>
            <p>
              Access to AI skin lesion scans requires active patient data-sharing consent. Ask the patient to grant diagnostic review consent in their portal.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="skin-review-state-box error">
          <AlertCircle size={20} className="state-icon" />
          <p>{error}</p>
        </div>
      )}

      {!loading && !consentBlocked && !error && analyses.length === 0 && (
        <div className="skin-review-state-box empty">
          <FileText size={20} className="state-icon" />
          <p>No skin-lesion screenings recorded for this patient.</p>
        </div>
      )}

      {!loading && !consentBlocked && analyses.length > 0 && (
        <div className="skin-analyses-list">
          {analyses.map((scan) => (
            <div key={scan.id} className="skin-analysis-card">
              <div className="analysis-card-top">
                <div>
                  <span className={`analysis-risk-pill ${scan.risk_level}`}>
                    Risk: {scan.risk_level}
                  </span>
                  <h4 className="analysis-predicted-label">{scan.predicted_label}</h4>
                  <span className="analysis-timestamp">
                    Scanned on {new Date(scan.created_at).toLocaleDateString()} at{' '}
                    {new Date(scan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="analysis-confidence-badge">
                  <span className="conf-value">{(scan.confidence * 100).toFixed(1)}%</span>
                  <span className="conf-label">Confidence</span>
                </div>
              </div>

              {/* Class probabilities */}
              <div className="analysis-probabilities-compact">
                {Object.entries(scan.probabilities)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 3)
                  .map(([cls, prob]) => (
                    <div key={cls} className="prob-compact-chip">
                      <span className="cls-code">{cls.toUpperCase()}</span>
                      <span className="cls-val">{(prob * 100).toFixed(0)}%</span>
                    </div>
                  ))}
              </div>

              {/* Doctor Review / Documentation Box */}
              <div className="analysis-review-box">
                {scan.doctor_notes ? (
                  <div className="existing-review">
                    <div className="review-status-label">
                      <CheckCircle2 size={14} className="reviewed-icon" />
                      <span>Doctor Review Documented</span>
                    </div>
                    <p className="existing-notes">"{scan.doctor_notes}"</p>
                    <span className="review-date">
                      Recorded on {scan.reviewed_at ? new Date(scan.reviewed_at).toLocaleDateString() : 'earlier'}
                    </span>
                  </div>
                ) : (
                  <div className="review-input-form">
                    <label htmlFor={`review-notes-${scan.id}`} className="review-label">
                      Record Clinical Evaluation Notes:
                    </label>
                    <textarea
                      id={`review-notes-${scan.id}`}
                      className="review-textarea"
                      placeholder="Add clinical observations, differential diagnosis, or follow-up recommendation..."
                      rows={2}
                      value={reviewNotes[scan.id] || ''}
                      onChange={(e) =>
                        setReviewNotes({ ...reviewNotes, [scan.id]: e.target.value })
                      }
                    />
                    <div className="review-form-actions">
                      {submitSuccess[scan.id] && (
                        <span className="save-success-msg">
                          <CheckCircle2 size={14} /> Review saved!
                        </span>
                      )}
                      <button
                        type="button"
                        className="submit-review-btn"
                        disabled={submittingId === scan.id || !reviewNotes[scan.id]?.trim()}
                        onClick={() => handleReviewSubmit(scan.id)}
                      >
                        <Send size={13} />
                        <span>{submittingId === scan.id ? 'Saving...' : 'Sign & Record Review'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SkinLesionReviewPanel;
