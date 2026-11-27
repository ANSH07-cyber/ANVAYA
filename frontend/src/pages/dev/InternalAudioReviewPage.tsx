import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  FileAudio,
  Languages,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Volume2,
  XCircle,
} from "lucide-react";
import {
  fetchVerifiedAudioObjectUrl,
  type SarvamInventory,
  type SarvamTrack,
} from "../../components/dev/sarvamAudioPreview";
import "./InternalAudioReviewPage.css";

const CATEGORY_LABELS: Record<string, string> = {
  general: "General Skin Health",
  akiec: "Actinic Keratosis (akiec)",
  bcc: "Basal Cell Carcinoma (bcc)",
  bkl: "Benign Keratosis (bkl)",
  df: "Dermatofibroma (df)",
  mel: "Melanoma (mel)",
  nv: "Melanocytic Nevus (nv)",
  vasc: "Vascular Lesion (vasc)",
};

const TOPIC_LABELS: Record<string, string> = {
  what: "What is it",
  why: "Why it develops",
  how: "How it progresses",
  next: "Next steps",
};

export default function InternalAudioReviewPage() {
  const [inventory, setInventory] = useState<SarvamInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  // Filters
  const [selectedLanguage, setSelectedLanguage] = useState<string>("all");
  const [selectedScope, setSelectedScope] = useState<string>("all");
  const [selectedTopic, setSelectedTopic] = useState<string>("all");

  // Active track state
  const [activeTrack, setActiveTrack] = useState<SarvamTrack | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load inventory on mount
  useEffect(() => {
    let active = true;
    async function loadInventory() {
      try {
        setLoading(true);
        const res = await fetch("/internal-review-audio/inventory.json");
        if (!res.ok) {
          throw new Error(`Failed to load audio inventory (${res.status})`);
        }
        const data = (await res.json()) as SarvamInventory;
        if (active) {
          setInventory(data);
          setInventoryError(null);
          if (data.tracks.length > 0) {
            setActiveTrack(data.tracks[0]);
          }
        }
      } catch (err) {
        if (active) {
          setInventoryError(err instanceof Error ? err.message : "Failed to load inventory");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    loadInventory();
    return () => {
      active = false;
    };
  }, []);

  // Filtered tracks
  const filteredTracks = useMemo(() => {
    if (!inventory) return [];
    return inventory.tracks.filter((t) => {
      if (selectedLanguage !== "all" && t.language !== selectedLanguage) return false;
      const trackScope = t.scope === "general" ? "general" : (t.category || t.scope);
      if (selectedScope !== "all" && trackScope !== selectedScope) return false;
      if (selectedTopic !== "all") {
        if (selectedTopic === "general" && t.scope !== "general") return false;
        if (selectedTopic !== "general" && t.topic !== selectedTopic) return false;
      }
      return true;
    });
  }, [inventory, selectedLanguage, selectedScope, selectedTopic]);

  // Load and verify audio when activeTrack changes
  useEffect(() => {
    const track = activeTrack;
    if (!track) {
      setAudioUrl(null);
      return;
    }

    let active = true;
    const controller = new AbortController();

    async function loadAudio(t: SarvamTrack) {
      setVerifying(true);
      setVerificationError(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);

      try {
        const { objectUrl } = await fetchVerifiedAudioObjectUrl(t, controller.signal);
        if (active) {
          setAudioUrl(objectUrl);
          setVerificationError(null);
        }
      } catch (err) {
        if (active) {
          setAudioUrl(null);
          setVerificationError(err instanceof Error ? err.message : "Verification error");
        }
      } finally {
        if (active) setVerifying(false);
      }
    }

    loadAudio(track);

    return () => {
      active = false;
      controller.abort();
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack?.id]);

  const handlePlayPause = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  };

  const handleReplay = () => {
    if (!audioRef.current || !audioUrl) return;
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
    audioRef.current.play().catch(() => setIsPlaying(false));
    setIsPlaying(true);
  };

  return (
    <div className="audio-review-page">
      <header className="audio-review-header">
        <div className="audio-review-brand">
          <FileAudio size={28} className="audio-review-brand-icon" aria-hidden="true" />
          <div>
            <h1>ANVAYA Internal Audio Review</h1>
            <p>Stage 3L Sarvam Synthetic Voice Quality & Integrity Review Tool</p>
          </div>
        </div>

        <div className="audio-review-status-pill">
          <span className="audio-review-dot" />
          Developer Sandbox
        </div>
      </header>

      {/* Prominent Non-Clinical Warning Banner */}
      <section className="audio-review-warning-banner" role="alert">
        <div className="audio-review-warning-icon">
          <AlertTriangle size={24} aria-hidden="true" />
        </div>
        <div className="audio-review-warning-copy">
          <h2>INTERNAL REVIEW — NOT CLINICALLY APPROVED</h2>
          <p>
            These 58 generated audio assets are for internal acoustic QA, latency benchmarking, and
            audio-text alignment review only. They have <strong>NOT</strong> received clinical sign-off
            or medical accuracy approval.
          </p>
          <p className="audio-review-warning-strict">
            DO NOT expose these assets in the patient portal. Production audio manifest remains
            strictly gated (empty) until multi-lingual clinical review is completed.
          </p>
        </div>
      </section>

      {/* Stats Summary */}
      <section className="audio-review-stats">
        <div className="audio-review-stat-card">
          <small>Total Generated Assets</small>
          <strong>{loading ? "Loading..." : `${inventory?.targetCount ?? 0} files`}</strong>
        </div>
        <div className="audio-review-stat-card">
          <small>Model & Voice</small>
          <strong>bulbul:v4-flash / shubh</strong>
        </div>
        <div className="audio-review-stat-card">
          <small>Languages</small>
          <strong>Hindi (29) + Hinglish (29)</strong>
        </div>
        <div className="audio-review-stat-card">
          <small>Production Manifest</small>
          <strong className="status-clean">0 Unapproved Assets (Safe)</strong>
        </div>
      </section>

      {inventoryError && (
        <div className="audio-review-error-block">
          <XCircle size={20} />
          <span>{inventoryError}</span>
        </div>
      )}

      {/* Main Grid: Player on left, Table on right */}
      <div className="audio-review-content-grid">
        {/* Left Column: Player & Active Track Inspection */}
        <div className="audio-review-player-pane">
          <div className="audio-player-card">
            <h3>Playback & Integrity Inspection</h3>

            {activeTrack ? (
              <div className="active-track-details">
                <div className="active-track-id">
                  <span>Track ID:</span>
                  <code>{activeTrack.id}</code>
                </div>

                <div className="active-track-meta-pills">
                  <span className="meta-pill meta-pill--lang">
                    <Languages size={14} />
                    {activeTrack.language === "hi" ? "Hindi (हिंदी)" : "Hinglish (hi-Latn)"}
                  </span>
                  <span className="meta-pill meta-pill--scope">
                    {CATEGORY_LABELS[activeTrack.scope === "general" ? "general" : (activeTrack.category || activeTrack.scope)] || activeTrack.scope}
                  </span>
                  {activeTrack.topic && (
                    <span className="meta-pill meta-pill--topic">
                      {TOPIC_LABELS[activeTrack.topic] || activeTrack.topic}
                    </span>
                  )}
                </div>

                {/* Integrity Status */}
                <div className="integrity-status-box">
                  <div className="integrity-status-header">
                    <small>SHA-256 Checksum Validation:</small>
                    {verifying ? (
                      <span className="integrity-badge verifying">Verifying...</span>
                    ) : verificationError ? (
                      <span className="integrity-badge mismatch">
                        <ShieldAlert size={14} /> FAILED
                      </span>
                    ) : (
                      <span className="integrity-badge verified">
                        <CheckCircle size={14} /> VERIFIED
                      </span>
                    )}
                  </div>
                  <code className="integrity-hash">{activeTrack.audioSha256}</code>
                  {verificationError && (
                    <div className="integrity-error-msg">{verificationError}</div>
                  )}
                </div>

                {/* Audio Element & Controls */}
                <div className="audio-controls-box">
                  {audioUrl && (
                    <audio
                      ref={audioRef}
                      src={audioUrl}
                      onTimeUpdate={() => {
                        if (audioRef.current) {
                          setCurrentTime(audioRef.current.currentTime);
                        }
                      }}
                      onLoadedMetadata={() => {
                        if (audioRef.current) {
                          setDuration(audioRef.current.duration);
                        }
                      }}
                      onEnded={() => setIsPlaying(false)}
                      onError={() => {
                        setIsPlaying(false);
                        setVerificationError("Audio playback error");
                      }}
                    />
                  )}

                  <div className="audio-time-row">
                    <span>
                      {Math.floor(currentTime / 60)}:
                      {Math.floor(currentTime % 60).toString().padStart(2, "0")}
                    </span>
                    <span>
                      {Math.floor(duration / 60)}:
                      {Math.floor(duration % 60).toString().padStart(2, "0")}
                    </span>
                  </div>

                  <div className="audio-btn-row">
                    <button
                      type="button"
                      className="audio-btn audio-btn--primary"
                      onClick={handlePlayPause}
                      disabled={!audioUrl || verifying || Boolean(verificationError)}
                    >
                      {isPlaying ? (
                        <>
                          <Pause size={18} />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play size={18} />
                          <span>Play</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      className="audio-btn audio-btn--secondary"
                      onClick={handleReplay}
                      disabled={!audioUrl || verifying || Boolean(verificationError)}
                    >
                      <RotateCcw size={16} />
                      <span>Replay</span>
                    </button>
                  </div>
                </div>

                {/* Acoustic Metrics */}
                <div className="acoustic-metrics-table">
                  <div className="metric-row">
                    <span>Duration:</span>
                    <strong>{activeTrack.durationSeconds.toFixed(2)}s</strong>
                  </div>
                  <div className="metric-row">
                    <span>File Size:</span>
                    <strong>{(activeTrack.bytes / 1024).toFixed(1)} KB</strong>
                  </div>
                  <div className="metric-row">
                    <span>Sample Rate:</span>
                    <strong>{activeTrack.sampleRateHz} Hz</strong>
                  </div>
                  <div className="metric-row">
                    <span>Peak / RMS dBFS:</span>
                    <strong>
                      {activeTrack.peakDbfs} / {activeTrack.rmsDbfs} dBFS
                    </strong>
                  </div>
                  <div className="metric-row">
                    <span>Clinical Status:</span>
                    <strong className="status-unapproved">
                      display_copy_in_catalog_audio_unapproved
                    </strong>
                  </div>
                </div>
              </div>
            ) : (
              <p className="no-track-selected">Select a track from the library table to inspect.</p>
            )}
          </div>
        </div>

        {/* Right Column: Library Filter & Table */}
        <div className="audio-review-table-pane">
          <div className="audio-filter-bar">
            <div className="filter-group">
              <label htmlFor="filter-lang">Language:</label>
              <select
                id="filter-lang"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
              >
                <option value="all">All Languages (58)</option>
                <option value="hi">Hindi (हिंदी) (29)</option>
                <option value="hi-Latn">Hinglish (hi-Latn) (29)</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-scope">Category:</label>
              <select
                id="filter-scope"
                value={selectedScope}
                onChange={(e) => setSelectedScope(e.target.value)}
              >
                <option value="all">All Categories</option>
                <option value="general">General Skin Health</option>
                <option value="akiec">Actinic Keratosis (akiec)</option>
                <option value="bcc">Basal Cell Carcinoma (bcc)</option>
                <option value="bkl">Benign Keratosis (bkl)</option>
                <option value="df">Dermatofibroma (df)</option>
                <option value="mel">Melanoma (mel)</option>
                <option value="nv">Melanocytic Nevus (nv)</option>
                <option value="vasc">Vascular Lesion (vasc)</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-topic">Topic:</label>
              <select
                id="filter-topic"
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
              >
                <option value="all">All Topics</option>
                <option value="general">General Overview</option>
                <option value="what">What is it</option>
                <option value="why">Why it develops</option>
                <option value="how">How it progresses</option>
                <option value="next">Next steps</option>
              </select>
            </div>

            <div className="filter-count">
              Showing <strong>{filteredTracks.length}</strong> of {inventory?.targetCount ?? 0}
            </div>
          </div>

          <div className="audio-table-wrapper">
            <table className="audio-review-table">
              <thead>
                <tr>
                  <th>Track ID</th>
                  <th>Scope</th>
                  <th>Topic</th>
                  <th>Lang</th>
                  <th>Duration</th>
                  <th>Size</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTracks.map((t) => {
                  const isSelected = activeTrack?.id === t.id;
                  return (
                    <tr
                      key={t.id}
                      className={isSelected ? "selected-row" : undefined}
                      onClick={() => setActiveTrack(t)}
                    >
                      <td>
                        <div className="track-name-cell">
                          <Volume2 size={15} className="track-icon" />
                          <code>{t.id}</code>
                        </div>
                      </td>
                      <td>{t.scope === "general" ? "General" : (t.category || t.scope)}</td>
                      <td>{t.topic ? TOPIC_LABELS[t.topic] || t.topic : "—"}</td>
                      <td>
                        <span className={`badge-lang badge-lang--${t.language}`}>
                          {t.language}
                        </span>
                      </td>
                      <td>{t.durationSeconds.toFixed(1)}s</td>
                      <td>{(t.bytes / 1024).toFixed(0)} KB</td>
                      <td>
                        <button
                          type="button"
                          className="table-play-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTrack(t);
                          }}
                        >
                          {isSelected && isPlaying ? "Playing" : "Inspect"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
