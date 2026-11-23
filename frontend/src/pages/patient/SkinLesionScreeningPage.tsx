import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../app/AuthContext';
import PortalLayout from '../../layouts/PortalLayout';
import { patientNavigation } from './patientNavigation';
import { aiService } from '../../services/aiService';
import type { SkinLesionAnalysis } from '../../types/skinLesion';
import './SkinLesionScreeningPage.css';

const CLASS_DESCRIPTIONS: Record<string, string> = {
  akiec: 'Actinic keratoses & intraepithelial carcinoma',
  bcc: 'Basal cell carcinoma',
  bkl: 'Benign keratosis-like lesions',
  df: 'Dermatofibroma',
  mel: 'Melanoma',
  nv: 'Melanocytic nevi',
  vasc: 'Vascular lesions',
};

export const SkinLesionScreeningPage: React.FC = () => {
  const { user } = useAuth();
  const userName = user?.full_name?.trim() || "Aarav Sharma";
  const userMeta = "Patient · Active account";

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentAnalysis, setCurrentAnalysis] = useState<SkinLesionAnalysis | null>(null);
  const [history, setHistory] = useState<SkinLesionAnalysis[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      const res = await aiService.getMyAnalyses(1, 20);
      setHistory(res.items);
      if (res.items.length > 0 && !currentAnalysis) {
        setCurrentAnalysis(res.items[0]);
      }
    } catch (err: unknown) {
      console.error('Failed to load scan history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setError(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleRunAnalysis = async () => {
    if (!selectedFile) {
      setError('Please select or upload a dermoscopic image first.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await aiService.analyzeSkinLesion(selectedFile, language);
      setCurrentAnalysis(result);
      fetchHistory();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      const detail = error.response?.data?.detail || 'Analysis failed. Please check image format.';
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={userName}
      userMeta={userMeta}
      navItems={patientNavigation}
    >
      <div className="skin-screening-container">
        <div className="screening-header">
          <h1 className="screening-title">
            🔬 AI Skin-Lesion Health Studio
          </h1>
          <p className="screening-subtitle">
            AI-assisted dermoscopic image screening, multi-class probability breakdown, bilingual education, and doctor review tracking.
          </p>
        </div>

      <div className="screening-grid">
        {/* Left Column: Upload & Controls */}
        <div className="upload-column">
          <div className="upload-card">
            <h2 className="card-title">Upload Dermoscopic Image</h2>

            <div
              className="dropzone"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/jpeg,image/png"
                onChange={handleFileChange}
              />
              <svg className="dropzone-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <div className="dropzone-text">Click to browse or drag & drop lesion image</div>
              <div className="dropzone-hint">Supports JPEG and PNG (max 10 MB)</div>
            </div>

            {previewUrl && (
              <div className="preview-container">
                <img src={previewUrl} alt="Preview" className="image-preview" />
              </div>
            )}

            <div className="lang-selector">
              <label>Education Language:</label>
              <div className="lang-pills">
                <button
                  type="button"
                  className={`lang-pill ${language === 'en' ? 'active' : ''}`}
                  onClick={() => setLanguage('en')}
                >
                  English
                </button>
                <button
                  type="button"
                  className={`lang-pill ${language === 'hi' ? 'active' : ''}`}
                  onClick={() => setLanguage('hi')}
                >
                  हिंदी (Hindi)
                </button>
              </div>
            </div>

            {error && (
              <div style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '1rem', background: '#fef2f2', padding: '0.75rem', borderRadius: '6px' }}>
                {error}
              </div>
            )}

            <button
              type="button"
              className="action-btn-analyze"
              disabled={loading || !selectedFile}
              onClick={handleRunAnalysis}
            >
              {loading ? (
                <>
                  <span className="spinner" /> Analyzing Image...
                </>
              ) : (
                'Run AI Screening'
              )}
            </button>
          </div>

          {/* Past Scans Table */}
          <div className="history-card" style={{ marginTop: '1.5rem' }}>
            <h2 className="card-title">Previous Scans ({history.length})</h2>
            {historyLoading ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Loading scans...</p>
            ) : history.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No previous scans recorded.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Class</th>
                      <th>Risk</th>
                      <th>Doctor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr
                        key={item.id}
                        className={`history-row ${currentAnalysis?.id === item.id ? 'selected' : ''}`}
                        onClick={() => setCurrentAnalysis(item)}
                      >
                        <td>{new Date(item.created_at).toLocaleDateString()}</td>
                        <td><strong>{item.predicted_class.toUpperCase()}</strong></td>
                        <td>
                          <span className={`risk-badge ${item.risk_level}`}>
                            {item.risk_level}
                          </span>
                        </td>
                        <td>
                          {item.doctor_notes ? 'Reviewed' : 'Pending'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Screening Results & Clinical Breakdown */}
        <div className="results-column">
          {currentAnalysis ? (
            <div className="results-card">
              <div className="prediction-hero">
                <div className="prediction-meta">
                  <span className={`risk-badge ${currentAnalysis.risk_level}`} style={{ marginBottom: '0.5rem' }}>
                    Risk: {currentAnalysis.risk_level}
                  </span>
                  <h3>{currentAnalysis.predicted_label}</h3>
                  <p>Analyzed on {formatDate(currentAnalysis.created_at)}</p>
                </div>
                <div className="confidence-metric">
                  <div className="confidence-val">
                    {(currentAnalysis.confidence * 100).toFixed(1)}%
                  </div>
                  <div className="confidence-label">Confidence</div>
                </div>
              </div>

              {/* Mandatory Non-Diagnostic Disclaimer */}
              <div className="disclaimer-banner">
                <strong>⚠️ Non-Diagnostic Medical Disclaimer:</strong>
                <p>{currentAnalysis.disclaimer}</p>
              </div>

              {/* Multi-Class Probability Breakdown */}
              <h4 style={{ margin: '0 0 0.75rem 0', color: '#1e293b' }}>
                HAM10000 Class Probabilities
              </h4>
              <div className="prob-list">
                {Object.entries(currentAnalysis.probabilities)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cls, prob]) => (
                    <div key={cls} className="prob-row">
                      <div className="prob-header">
                        <span className="prob-name">
                          {CLASS_DESCRIPTIONS[cls] || cls.toUpperCase()} ({cls})
                        </span>
                        <span className="prob-percent">
                          {(prob * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="prob-bar-track">
                        <div
                          className={`prob-bar-fill ${cls === currentAnalysis.predicted_class ? 'highlight' : ''}`}
                          style={{ width: `${Math.min(100, Math.max(2, prob * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>

              {/* Bilingual Educational Content */}
              {currentAnalysis.education_content && (
                <div className="education-section">
                  <h4 className="education-title">
                    📖 {currentAnalysis.education_content.title || currentAnalysis.education_title}
                  </h4>
                  {currentAnalysis.education_content.what_it_means && (
                    <div className="education-item">
                      <strong>What this means:</strong>
                      <p>{currentAnalysis.education_content.what_it_means}</p>
                    </div>
                  )}
                  {currentAnalysis.education_content.general_background && (
                    <div className="education-item">
                      <strong>General background:</strong>
                      <p>{currentAnalysis.education_content.general_background}</p>
                    </div>
                  )}
                  {currentAnalysis.education_content.when_to_seek_care && (
                    <div className="education-item">
                      <strong>When to seek clinical care:</strong>
                      <p>{currentAnalysis.education_content.when_to_seek_care}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Doctor Review Status */}
              <div className={`doctor-review-status-box ${currentAnalysis.doctor_notes ? 'reviewed' : ''}`}>
                {currentAnalysis.doctor_notes ? (
                  <>
                    <strong>👨‍⚕️ Dermatologist Clinical Review:</strong>
                    <p style={{ fontStyle: 'italic', margin: '0.25rem 0 0.5rem 0' }}>
                      "{currentAnalysis.doctor_notes}"
                    </p>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      Reviewed on {currentAnalysis.reviewed_at ? formatDate(currentAnalysis.reviewed_at) : 'recently'}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>⏳ Pending Dermatologist Review</strong>
                    <p>
                      Your doctor can review this screening during your next consultation once data-sharing consent is granted.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="results-card" style={{ textAlign: 'center', padding: '3rem 2rem', color: '#64748b' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔬</div>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#1e293b' }}>No Screening Selected</h3>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                Upload a dermoscopic image on the left to start a new analysis or select a past scan to view details.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
    </PortalLayout>
  );
};

export default SkinLesionScreeningPage;
