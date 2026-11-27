import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Info,
  Scan,
  ShieldCheck,
  Stethoscope,
  Upload,
  Users,
} from 'lucide-react';
import { useAuth } from '../../app/AuthContext';
import PortalLayout from '../../layouts/PortalLayout';
import { patientNavigation } from './patientNavigation';
import { HeaderBotanicalAccent } from './PatientBotanicalArt';
import { patientReadError } from '../../services/patientReliability';
import { aiService } from '../../services/aiService';
import type { SkinLesionAnalysis, SkinLesionClassesResponse } from '../../types/skinLesion';
import {
  classCodes,
  educationPrediction,
  legacyScreeningLanguage,
  type EducationLocale,
  type SkinClass,
} from '../../components/skinHealth/catalog';
import {
  computeHistoryPageMeta,
  SKIN_HISTORY_PAGE_SIZE,
} from '../../components/skinHealth/historyPagination';
import { SkinHealthEducation } from '../../components/skinHealth/SkinHealthEducation';
import './SkinLesionScreeningPage.css';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

const CLASS_DESCRIPTIONS: Record<SkinClass, string> = {
  akiec: 'Actinic keratoses & intraepithelial carcinoma',
  bcc: 'Basal cell carcinoma',
  bkl: 'Benign keratosis-like lesions',
  df: 'Dermatofibroma',
  mel: 'Melanoma',
  nv: 'Melanocytic nevi',
  vasc: 'Vascular lesions',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoValue: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(isoValue));
  } catch {
    return isoValue;
  }
}

export const SkinLesionScreeningPage: React.FC = () => {
  const { user } = useAuth();
  return <SkinLesionScreening key={user?.id ?? 'signed-out'} userName={user?.full_name?.trim() || 'Patient'} />;
};

function SkinLesionScreening({ userName }: { userName: string }) {
  const userMeta = 'Patient account';

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [language, setLanguage] = useState<EducationLocale>('en');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisFailed, setAnalysisFailed] = useState(false);

  const [currentAnalysis, setCurrentAnalysis] = useState<SkinLesionAnalysis | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyState, setHistoryState] = useState<{
    page: number;
    revision: number;
    items: SkinLesionAnalysis[];
    total: number;
  }>({ page: 1, revision: 0, items: [], total: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [modelState, setModelState] = useState<{ revision: number; model: SkinLesionClassesResponse } | null>(null);
  const analyzing = useRef(false);
  const historyRequestSeqRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void aiService
      .getSupportedClasses()
      .then((model) => {
        if (active) setModelState({ revision: historyRevision, model });
      })
      .catch(() => {
        if (active) setModelState(null);
      });
    return () => {
      active = false;
    };
  }, [historyRevision]);

  useEffect(() => {
    let active = true;
    let clamped = false;
    const requestSeq = ++historyRequestSeqRef.current;
    const targetPage = historyPage;
    const targetRevision = historyRevision;
    setHistoryLoading(true);
    setHistoryError('');
    void aiService
      .getMyAnalyses(targetPage, SKIN_HISTORY_PAGE_SIZE)
      .then((response) => {
        if (!active || requestSeq !== historyRequestSeqRef.current) return;
        const pageMeta = computeHistoryPageMeta(targetPage, response.items.length, response.total, SKIN_HISTORY_PAGE_SIZE);
        if (pageMeta.outOfRangePage !== null && pageMeta.outOfRangePage !== targetPage) {
          clamped = true;
          setHistoryPage(pageMeta.outOfRangePage);
          return;
        }
        setHistoryState({
          page: targetPage,
          revision: targetRevision,
          items: response.items,
          total: pageMeta.total,
        });
        setCurrentAnalysis((current) => current ?? response.items[0] ?? null);
      })
      .catch((failure: unknown) => {
        if (!active || requestSeq !== historyRequestSeqRef.current) return;
        setHistoryState((prev) => ({
          page: targetPage,
          revision: targetRevision,
          items: [],
          total: prev.total,
        }));
        setHistoryError(patientReadError(failure, 'your scan history'));
      })
      .finally(() => {
        if (!clamped && active && requestSeq === historyRequestSeqRef.current) {
          setHistoryLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [historyPage, historyRevision]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function acceptCandidateFile(file: File | undefined) {
    if (!file) return;
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setError('Unsupported file format — upload a JPEG or PNG dermoscopic image (max 10 MB).');
      return;
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      setError('The selected image must be non-empty and within the 10 MB size limit.');
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setAnalysisFailed(false);
  }

  function clearSelectedFile() {
    setSelectedFile(null);
    setPreviewUrl(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    acceptCandidateFile(event.target.files?.[0]);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    acceptCandidateFile(event.dataTransfer.files?.[0]);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragActive) setIsDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const handleRunAnalysis = async () => {
    if (analyzing.current) return;
    if (!selectedFile) {
      setError('Please select a JPEG or PNG dermoscopic image first.');
      return;
    }

    analyzing.current = true;
    try {
      setLoading(true);
      setError(null);
      setAnalysisFailed(false);
      const result = await aiService.analyzeSkinLesion(selectedFile, legacyScreeningLanguage(language));
      setCurrentAnalysis(result);
      setHistoryPage(1);
      setHistoryRevision((revision) => revision + 1);
      requestAnimationFrame(() => {
        resultsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err: unknown) {
      setAnalysisFailed(true);
      const apiError = err as { response?: { status?: number; data?: { detail?: string } } };
      if (apiError.response?.status === 503) {
        setHistoryRevision((revision) => revision + 1);
      }
      const detail = apiError.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : patientReadError(err, 'your screening result'));
    } finally {
      analyzing.current = false;
      setLoading(false);
    }
  };

  const model = modelState?.revision === historyRevision ? modelState.model : null;
  const visibleAnalysis = loading || analysisFailed ? null : currentAnalysis;
  const prediction = educationPrediction(visibleAnalysis, model);
  const isCurrentHistoryLoaded =
    historyState.page === historyPage && historyState.revision === historyRevision;
  const history = isCurrentHistoryLoaded ? historyState.items : [];
  const historyMeta = computeHistoryPageMeta(
    historyPage,
    history.length,
    historyState.total,
    SKIN_HISTORY_PAGE_SIZE,
  );

  function selectAnalysis(scan: SkinLesionAnalysis) {
    setCurrentAnalysis(scan);
    setAnalysisFailed(false);
    setError(null);
    requestAnimationFrame(() => {
      resultsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const sevenClassEntries: Array<{ code: SkinClass; score: number }> = prediction
    ? classCodes.map(code => ({ code, score: prediction.probabilities[code] }))
    : [];

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={userName}
      userMeta={userMeta}
      navItems={patientNavigation}
    >
      <div className="sh-page">
        {/* Editorial Header */}
        <header className="sh-page-header">
          <HeaderBotanicalAccent />
          <div className="sh-page-heading">
            <h1 className="sh-page-title">Skin health AI</h1>
            <p className="sh-page-subtitle">
              Educational dermoscopic pattern screening across seven lesion categories, designed to support informed conversations with your dermatologist.
            </p>
          </div>
          <span className="sh-scope-chip">
            <Scan size={14} aria-hidden="true" />
            Dermoscopy-only research model
          </span>
        </header>

        {/* Explicit Domain Scope Bar */}
        <div className="sh-scope-bar">
          <div className="sh-scope-bar-copy">
            <Info size={18} aria-hidden="true" />
            <div>
              <strong>Trained strictly on clinical dermoscopy images.</strong> Ordinary smartphone or distant skin photographs are outside this model&apos;s validated domain and cannot produce reliable scores. Results are uncalibrated educational signals — never a medical diagnosis.
            </div>
          </div>
          <span className="sh-pill sh-pill--code">
            {model?.available && model.model_version ? model.model_version : 'Provenance check active'}
          </span>
        </div>

        {/* Landing & Upload Bento Row */}
        <div className="sh-bento-grid">
          {/* Left Hero Upload Surface */}
          <section className="sh-hero-shell" aria-label="Upload dermoscopic image">
            <div className="sh-hero-banner">
              <svg
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.9 }}
                viewBox="0 0 680 144"
                preserveAspectRatio="none"
                fill="none"
                aria-hidden="true"
              >
                <path d="M405 118C478 74 562 36 668 14" stroke="#86BCB6" strokeWidth="1.6" opacity="0.28" />
                <circle cx="592" cy="54" r="34" stroke="#86BCB6" strokeWidth="1" strokeDasharray="4 4" opacity="0.25" />
                <path d="M554 34C520 18 476 28 456 60C498 72 534 60 554 34Z" fill="#5D9C97" opacity="0.24" />
                <path d="M0 130C195 137 415 123 565 103C620 94 655 81 680 68V144H0V130Z" fill="#F4F2EC" opacity="0.99" />
              </svg>
              <div className="sh-hero-banner-row">
                <div className="sh-hero-banner-heading">
                  <Upload size={20} aria-hidden="true" />
                  <h2 className="sh-hero-banner-title">Submit a dermoscopic image</h2>
                </div>
                <span className={`sh-hero-pill ${model && !model.available ? 'sh-hero-pill--amber' : ''}`}>
                  {model?.available ? '7-class research model online' : model ? 'Model unavailable' : 'Checking model status'}
                </span>
              </div>
            </div>

            <div className="sh-hero-surface">
              <div
                className={`sh-dropzone ${isDragActive ? 'sh-dropzone--active' : ''}`}
                role="button"
                tabIndex={0}
                aria-label="Choose a dermoscopic JPEG or PNG image"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept="image/jpeg,image/png"
                  onChange={handleFileChange}
                />
                <div className="sh-dropzone-reticle" aria-hidden="true">
                  <Scan size={26} strokeWidth={1.8} />
                </div>
                <p className="sh-dropzone-title">Drag and drop a dermoscopic lesion image, or browse</p>
                <p className="sh-dropzone-hint">High-magnification polarized or contact dermatoscope capture only</p>
                <div className="sh-meta-chips">
                  <span className="sh-meta-chip">JPEG or PNG</span>
                  <span className="sh-meta-chip">Maximum 10 MB</span>
                  <span className="sh-meta-chip">EXIF metadata stripped on upload</span>
                </div>
                <button
                  type="button"
                  className="sh-btn sh-btn--secondary"
                  onClick={(event) => {
                    event.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  Choose dermoscopic file
                </button>
              </div>

              {selectedFile && previewUrl && (
                <div className="sh-preview-card" style={{ marginTop: '0.875rem' }}>
                  <div className="sh-preview-main">
                    <img src={previewUrl} alt="Selected dermoscopic preview" className="sh-preview-img" />
                    <div className="sh-preview-file">
                      <strong title={selectedFile.name}>{selectedFile.name}</strong>
                      <span className="sh-tabular">
                        {formatFileSize(selectedFile.size)} · {selectedFile.type === 'image/png' ? 'PNG' : 'JPEG'} · Ready for upload
                      </span>
                    </div>
                  </div>
                  <div className="sh-preview-actions">
                    <button
                      type="button"
                      className="sh-btn sh-btn--secondary"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      className="sh-btn sh-btn--secondary"
                      onClick={clearSelectedFile}
                      disabled={loading}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div role="alert" className="sh-error-banner">
                  <span>{error}</span>
                  <button
                    type="button"
                    className="sh-btn sh-btn--secondary"
                    style={{ minHeight: '2.75rem' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose another file
                  </button>
                </div>
              )}

              <div className="sh-checklist">
                <div className="sh-checklist-item">
                  <span className="sh-checklist-dot" aria-hidden="true" />
                  <span><strong>Clinical illumination:</strong> Use uniform polarized dermoscopy lighting without harsh glare.</span>
                </div>
                <div className="sh-checklist-item">
                  <span className="sh-checklist-dot" aria-hidden="true" />
                  <span><strong>Centered lesion:</strong> Frame the complete lesion border inside the central optical reticle.</span>
                </div>
                <div className="sh-checklist-item">
                  <span className="sh-checklist-dot" aria-hidden="true" />
                  <span><strong>Metadata stripped:</strong> Uploaded images are re-encoded cleanly; EXIF metadata is cleared.</span>
                </div>
                <div className="sh-checklist-item">
                  <span className="sh-checklist-dot" aria-hidden="true" />
                  <span><strong>Human review stays separate:</strong> Results remain private until you grant doctor consent.</span>
                </div>
              </div>
            </div>

            <div className="sh-hero-footer">
              <p className="sh-hero-footer-note">
                {loading
                  ? 'Running verified dermoscopy model...'
                  : selectedFile
                    ? 'Ready to analyze selected dermoscopic capture.'
                    : 'Select a valid dermoscopic JPEG/PNG to enable screening.'}
              </p>
              <button
                type="button"
                className="sh-btn sh-btn--primary"
                disabled={loading || !selectedFile}
                onClick={handleRunAnalysis}
              >
                {loading ? (
                  <>
                    <span className="sh-spinner" aria-hidden="true" />
                    Analyzing image...
                  </>
                ) : (
                  'Run AI screening'
                )}
              </button>
            </div>
          </section>

          {/* Right Rail: Clinician Review & Consent Guidance */}
          <div className="sh-stack">
            <section className="sh-card">
              <div className="sh-card-head">
                <div>
                  <h2 className="sh-card-title">Clinician review &amp; consent</h2>
                  <p className="sh-card-subtitle">How human oversight protects your screening</p>
                </div>
                <div className="sh-sage-tile" aria-hidden="true">
                  <ShieldCheck size={20} strokeWidth={1.9} />
                </div>
              </div>

              <div className="sh-guidance-item">
                <FileText size={18} aria-hidden="true" />
                <div>
                  <strong>1. Uncalibrated educational signal</strong>
                  <span>
                    Every verified run surfaces all 7 categories (akiec, bcc, bkl, df, mel, nv, vasc) rather than a binary benign/malignant claim.
                  </span>
                </div>
              </div>

              <div className="sh-guidance-item">
                <Users size={18} aria-hidden="true" />
                <div>
                  <strong>2. Consent-gated dermatologist review</strong>
                  <span>
                    Clinicians can inspect your screening history only when you grant data-sharing approval in Consent &amp; privacy.
                  </span>
                </div>
              </div>

              <div className="sh-guidance-item">
                <Info size={18} aria-hidden="true" />
                <div>
                  <strong>3. Multilingual Stage 3A guide</strong>
                  <span>
                    Read, listen, or check video availability in English, हिंदी, or Hinglish alongside any verified screening result.
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <Link to="/patient/consent" className="sh-btn sh-btn--secondary">
                  Manage consent
                </Link>
              </div>
            </section>

            <div className="sh-caution-banner" role="note" style={{ flexDirection: 'column', gap: '0.625rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <AlertTriangle size={18} style={{ flex: 'none', marginTop: '2px', color: '#8c4f19' }} aria-hidden="true" />
                <div>
                  <strong>Notice a growing, bleeding, or changing spot?</strong>
                  Do not delay in-person dermatology care based on an automated screening score.
                </div>
              </div>
              <Link to="/patient/doctors" className="sh-btn sh-btn--secondary">
                Book dermatology visit
              </Link>
            </div>
          </div>
        </div>

        {/* Active Loading or Screening Result Section */}
        <div ref={resultsAnchorRef}>
          {loading ? (
            <section className="sh-loading-card" aria-live="polite" aria-busy="true">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <span className="sh-spinner" aria-hidden="true" />
                <strong>Running verified dermoscopy model...</strong>
              </div>
              <div className="sh-skeleton-line" style={{ width: '78%' }} />
              <div className="sh-skeleton-line" style={{ width: '54%' }} />
              <p className="sh-card-subtitle" style={{ margin: 0 }}>
                Previous scan results remain hidden during active inference so scores cannot be confused.
              </p>
            </section>
          ) : visibleAnalysis ? (
            <div className="sh-stack">
              <div className="sh-result-context-strip">
                <div>
                  <strong style={{ fontSize: '0.9375rem', color: '#102a35', display: 'block' }}>
                    Selected screening analysis
                  </strong>
                  <span style={{ fontSize: '0.8125rem', color: '#52646a' }} className="sh-tabular">
                    Analyzed {formatDate(visibleAnalysis.created_at)} · Record <span className="sh-mono">{visibleAnalysis.id.slice(0, 8)}</span>
                  </span>
                </div>
                <span className={`sh-pill ${prediction ? 'sh-pill--verified' : 'sh-pill--unknown'}`}>
                  {prediction ? 'Verified model source' : 'Unverified provenance'}
                </span>
              </div>

              <div className="sh-bento-grid">
                {/* Left Column: Result Hero + Limitations + 7-Class Breakdown */}
                <div className="sh-stack">
                  {prediction ? (
                    <>
                      <section className="sh-hero-shell" aria-label="Model pattern output">
                        <div className="sh-hero-banner">
                          <svg
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.9 }}
                            viewBox="0 0 680 144"
                            preserveAspectRatio="none"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path d="M395 120C470 74 560 34 668 12" stroke="#86BCB6" strokeWidth="1.6" opacity="0.28" />
                            <path d="M564 30C530 12 486 22 464 54C506 66 544 54 564 30Z" fill="#5D9C97" opacity="0.24" />
                            <path d="M0 130C195 137 415 123 565 103C620 94 655 81 680 68V144H0V130Z" fill="#F4F2EC" opacity="0.99" />
                          </svg>
                          <div className="sh-hero-banner-row">
                            <div className="sh-hero-banner-heading">
                              <Scan size={20} aria-hidden="true" />
                              <h2 className="sh-hero-banner-title">Model pattern output (non-diagnostic)</h2>
                            </div>
                            <span className="sh-hero-pill">Verified model source</span>
                          </div>
                        </div>

                        <div className="sh-hero-surface">
                          <div className="sh-prediction-split">
                            <div>
                              <div className="sh-pred-kicker">Top model category · HAM10000 taxonomy</div>
                              <h3 className="sh-pred-title">
                                {prediction.predicted_label} (<span className="sh-mono">{prediction.predicted_class}</span>)
                              </h3>
                              <p className="sh-pred-sub">
                                Highest softmax score across the 7 supported lesion categories. Not a diagnosis or benign clearance.
                              </p>
                            </div>
                            <div className="sh-score-box">
                              <div className="sh-score-num">{(prediction.confidence * 100).toFixed(1)}%</div>
                              <div className="sh-score-caption">
                                Uncalibrated model score
                                <br />
                                (not clinical risk probability)
                              </div>
                            </div>
                          </div>

                          <div className="sh-provenance-strip">
                            <span>
                              Model: <strong className="sh-mono">{prediction.model_version}</strong>
                            </span>
                            <span>·</span>
                            <span>
                              Inference: <strong className="sh-mono">{visibleAnalysis.inference_mode}</strong>
                            </span>
                            <span>·</span>
                            <span>
                              Checkpoint SHA-256: <strong className="sh-mono">{prediction.checkpoint_sha256.slice(0, 12)}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="sh-hero-footer">
                          <p className="sh-hero-footer-note">
                            Automated scores must never replace clinical dermoscopic evaluation.
                          </p>
                          <a href="#skin-edu-read" className="sh-btn sh-btn--secondary">
                            Understand this result
                            <ArrowRight size={15} aria-hidden="true" />
                          </a>
                        </div>
                      </section>

                      <div className="sh-caution-banner" role="note">
                        <AlertTriangle size={20} style={{ flex: 'none', marginTop: '2px', color: '#8c4f19' }} aria-hidden="true" />
                        <div>
                          <strong>Clinical limitations &amp; non-diagnostic disclosure</strong>
                          <span>{prediction.disclaimer}</span>
                        </div>
                      </div>

                      <section className="sh-card" aria-label="Seven-class uncalibrated score distribution">
                        <div className="sh-card-head">
                          <div>
                            <h3 className="sh-card-title">Seven-class uncalibrated score distribution</h3>
                            <p className="sh-card-subtitle">
                              All seven HAM10000 categories remain visible; no binary benign/malignant collapse
                            </p>
                          </div>
                          <span className="sh-pill sh-pill--neutral sh-tabular">7 categories</span>
                        </div>

                        <div className="sh-prob-list">
                          {sevenClassEntries.map(({ code, score }) => {
                            const isTop = code === prediction.predicted_class;
                            return (
                              <div key={code} className={`sh-prob-row ${isTop ? 'sh-prob-row--top' : ''}`}>
                                <div className="sh-prob-head">
                                  <span className="sh-prob-name">
                                    {CLASS_DESCRIPTIONS[code]}
                                    <span className="sh-pill sh-pill--code">{code}</span>
                                  </span>
                                  <span className="sh-prob-percent">{(score * 100).toFixed(1)}%</span>
                                </div>
                                <div className="sh-prob-track">
                                  <div
                                    className={`sh-prob-fill ${isTop ? 'sh-prob-fill--top' : ''}`}
                                    style={{ width: `${score * 100}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </>
                  ) : (
                    <section className="sh-card" aria-label="Unverified screening result">
                      <div className="sh-card-head">
                        <div>
                          <h3 className="sh-card-title">Unverified screening result</h3>
                          <p className="sh-card-subtitle">
                            Analyzed {formatDate(visibleAnalysis.created_at)} · Scores unavailable
                          </p>
                        </div>
                        <span className="sh-pill sh-pill--unknown">
                          inference_mode: {visibleAnalysis.inference_mode ?? 'unknown'}
                        </span>
                      </div>

                      <div className="sh-caution-banner" role="note">
                        <AlertTriangle size={18} style={{ flex: 'none', marginTop: '2px', color: '#8c4f19' }} aria-hidden="true" />
                        <div>
                          <strong>Screening result unavailable</strong>
                          <span>
                            The model source or the complete seven-class result could not be verified. General education is available below. If a spot concerns you, arrange a clinician assessment.
                          </span>
                        </div>
                      </div>
                    </section>
                  )}
                </div>

                {/* Right Column: Independent Doctor Review & Safe Next Steps */}
                <div className="sh-stack">
                  <section className="sh-card" aria-label="Independent doctor review">
                    <div className="sh-card-head">
                      <div>
                        <h3 className="sh-card-title">Independent doctor review</h3>
                        <p className="sh-card-subtitle">Separate clinician assessment status</p>
                      </div>
                      <span className={`sh-pill ${visibleAnalysis.doctor_notes ? 'sh-pill--verified' : 'sh-pill--neutral'}`}>
                        {visibleAnalysis.doctor_notes ? 'Reviewed' : 'Pending review'}
                      </span>
                    </div>

                    <div className={`sh-review-box ${visibleAnalysis.doctor_notes ? 'sh-review-box--reviewed' : ''}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                        <div className="sh-sage-tile" style={{ width: '2.25rem', height: '2.25rem', borderRadius: '0.625rem' }} aria-hidden="true">
                          {visibleAnalysis.doctor_notes ? <CheckCircle2 size={18} /> : <Stethoscope size={18} />}
                        </div>
                        <div>
                          <strong style={{ display: 'block', fontSize: '0.875rem', color: '#102a35' }}>
                            {visibleAnalysis.doctor_notes ? 'Clinician note recorded' : 'Awaiting dermatologist review'}
                          </strong>
                          <span style={{ fontSize: '0.75rem', color: '#52646a' }}>
                            {visibleAnalysis.doctor_notes
                              ? `Reviewed ${visibleAnalysis.reviewed_at ? formatDate(visibleAnalysis.reviewed_at) : 'recently'}`
                              : 'No automated decision is sent to clinicians'}
                          </span>
                        </div>
                      </div>

                      {visibleAnalysis.doctor_notes ? (
                        <blockquote className="sh-review-quote">
                          &ldquo;{visibleAnalysis.doctor_notes}&rdquo;
                        </blockquote>
                      ) : (
                        <p style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.5, color: '#465d65' }}>
                          An approved dermatologist can review this screening during your consultation once you grant data-sharing consent.
                        </p>
                      )}

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <Link to="/patient/doctors" className="sh-btn sh-btn--primary">
                          Book dermatology visit
                        </Link>
                        <Link to="/patient/consent" className="sh-btn sh-btn--secondary">
                          Consent settings
                        </Link>
                      </div>
                    </div>
                  </section>

                  <section className="sh-card" aria-label="Safe next steps">
                    <div className="sh-card-head">
                      <div>
                        <h3 className="sh-card-title">Safe next steps</h3>
                        <p className="sh-card-subtitle">Practical follow-up guidance</p>
                      </div>
                    </div>
                    <ul className="sh-steps-list">
                      <li>
                        <span className="sh-step-num" aria-hidden="true">1</span>
                        <span><strong>Consult a clinician for any concern:</strong> Physical examination with a dermatoscope remains the standard for evaluating skin lesions.</span>
                      </li>
                      <li>
                        <span className="sh-step-num" aria-hidden="true">2</span>
                        <span><strong>Watch for clinical changes:</strong> Seek timely evaluation if a spot changes in size, shape, color, bleeds, or fails to heal.</span>
                      </li>
                      <li>
                        <span className="sh-step-num" aria-hidden="true">3</span>
                        <span><strong>Do not self-treat:</strong> Never remove, burn, or medicate a skin lesion based on a screening percentage.</span>
                      </li>
                    </ul>
                  </section>
                </div>
              </div>
            </div>
          ) : (
            <section className="sh-empty-state" aria-label="No screening selected">
              <Scan size={28} strokeWidth={1.6} color="#163c42" aria-hidden="true" />
              <strong style={{ fontSize: '1rem', color: '#102a35' }}>No screening selected</strong>
              <p style={{ margin: 0, maxWidth: '30rem', fontSize: '0.875rem', lineHeight: 1.5 }}>
                Upload a dermoscopic JPEG or PNG image above to start a new analysis, or choose any previous entry from Screening history below.
              </p>
            </section>
          )}
        </div>

        {/* Screening History Cards */}
        <section className="sh-card" aria-label="Screening history">
          <div className="sh-card-head">
            <div>
              <h2 className="sh-card-title">Screening history</h2>
              <p className="sh-card-subtitle">
                Select any past screening to inspect its seven-class scores, provenance check, and clinician review notes
              </p>
            </div>
            <span className="sh-pill sh-pill--neutral sh-tabular">
              {historyLoading ? 'Loading...' : historyError ? 'History unavailable' : historyMeta.summaryText}
            </span>
          </div>

          {historyLoading ? (
            <div style={{ display: 'grid', gap: '0.625rem' }}>
              <div className="sh-skeleton-line" style={{ width: '65%' }} />
              <div className="sh-skeleton-line" style={{ width: '42%' }} />
            </div>
          ) : historyError ? (
            <div role="alert" className="sh-error-banner" style={{ marginTop: 0 }}>
              <span>{historyError}</span>
              <button
                type="button"
                className="sh-btn sh-btn--secondary"
                onClick={() => setHistoryRevision((revision) => revision + 1)}
              >
                Retry scans
              </button>
            </div>
          ) : historyMeta.total === 0 ? (
            <div className="sh-empty-state">
              <strong style={{ color: '#102a35', fontSize: '0.9375rem' }}>No previous screenings recorded</strong>
              <span style={{ fontSize: '0.84375rem' }}>
                Your verified dermoscopic screenings will appear here once submitted.
              </span>
            </div>
          ) : (
            <div className="sh-history-grid">
              {history.map((item) => {
                const verifiedItem = educationPrediction(item, model);
                const selected = currentAnalysis?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    className="sh-history-card"
                    onClick={() => selectAnalysis(item)}
                  >
                    <div className="sh-history-top">
                      <span className="sh-history-date sh-tabular">{formatDate(item.created_at)}</span>
                      <span className={`sh-pill ${verifiedItem ? 'sh-pill--verified' : 'sh-pill--unknown'}`}>
                        {verifiedItem ? 'Verified model' : 'Unverified result'}
                      </span>
                    </div>

                    <div className="sh-history-title">
                      {verifiedItem ? (
                        <>
                          <span>{verifiedItem.predicted_label}</span>
                          <span className="sh-pill sh-pill--code">{verifiedItem.predicted_class}</span>
                        </>
                      ) : (
                        <>
                          <span>Historical record</span>
                          <span className="sh-pill sh-pill--neutral">Unverified</span>
                        </>
                      )}
                    </div>

                    <div className="sh-history-meta">
                      {verifiedItem ? (
                        <>
                          Model <span className="sh-mono">{verifiedItem.model_version}</span> · SHA{' '}
                          <span className="sh-mono">{verifiedItem.checkpoint_sha256.slice(0, 8)}</span>
                          <br />
                          Top uncalibrated score:{' '}
                          <strong className="sh-tabular">{(verifiedItem.confidence * 100).toFixed(1)}%</strong>
                        </>
                      ) : (
                        <>
                          <span className="sh-mono">inference_mode: {item.inference_mode ?? 'unknown'}</span> · Model source or score distribution could not be verified; scores withheld.
                        </>
                      )}
                    </div>

                    <div className="sh-history-footer">
                      <span>
                        {item.doctor_notes
                          ? `Reviewed${item.reviewed_at ? ` · ${formatDate(item.reviewed_at)}` : ''}`
                          : 'Pending clinician review'}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        {verifiedItem ? 'Open breakdown' : 'Inspect record'}
                        <ArrowRight size={13} aria-hidden="true" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!historyError && historyMeta.total > 0 && (
            <nav className="sh-history-pagination" aria-label="Screening history pages">
              <p className="sh-history-page-info" role="status">
                {historyMeta.pageIndicatorText} · {historyLoading ? 'Loading page...' : historyMeta.summaryText}
              </p>
              <div className="sh-history-page-controls">
                <button
                  type="button"
                  className="sh-btn sh-btn--secondary"
                  disabled={!historyMeta.canGoPrev}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                  Previous
                </button>
                <button
                  type="button"
                  className="sh-btn sh-btn--secondary"
                  disabled={!historyMeta.canGoNext}
                  onClick={() => setHistoryPage((p) => Math.min(historyMeta.totalPages, p + 1))}
                >
                  Next
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </nav>
          )}
        </section>

        {/* Integrated Stage 3A / Concept 3B Signature Education Experience */}
        <SkinHealthEducation
          locale={language}
          verifiedClass={prediction?.predicted_class as SkinClass | undefined}
          playbackContext={visibleAnalysis?.id ?? null}
          onLocaleChange={setLanguage}
          verifiedContext={
            prediction
              ? {
                  label: prediction.predicted_label,
                  code: prediction.predicted_class as SkinClass,
                  score: prediction.confidence,
                  modelVersion: prediction.model_version,
                  checkpointSha256: prediction.checkpoint_sha256,
                }
              : null
          }
        />
      </div>
    </PortalLayout>
  );
}

export default SkinLesionScreeningPage;
