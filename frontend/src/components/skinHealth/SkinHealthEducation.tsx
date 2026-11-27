import { loadVerifiedAudio, loadVerifiedPlayback, sha256TextHex } from './verifiedPlayback.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CaptionsOff,
  Lock,
  Scan,
  ShieldCheck,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  approvedTranslation,
  categoryEducation,
  educationTopics,
  generalEducation,
  localeNames,
  locales,
  topicFields,
  topicLabels,
  type EducationLocale,
  type EducationTopic,
  type SkinClass,
} from './catalog.ts';
import {
  educationAudioAssets,
  resolveEducationAudio,
  type EducationAudioAsset,
} from './audioManifest.ts';
import {
  createBrowserNarrator,
  createVerifiedBlobAudioPlayer,
  type NarrationAdapter,
} from './narration.ts';
import { resolveEducationVideo, type EducationVideoAsset } from './videoManifest.ts';
import { HeaderBotanicalAccent } from '../../pages/patient/PatientBotanicalArt.tsx';
import {
  getInternalAudioAsset,
  loadVerifiedInternalAudio,
  type InternalAudioAsset,
} from '../dev/internalSkinHealthAudio.ts';
import './SkinHealthEducation.css';

type Messages = typeof generalEducation.translations[EducationLocale];
type ModalityTab = 'read' | 'listen' | 'watch';

export interface VerifiedPredictionContext {
  label: string;
  code: SkinClass;
  score: number;
  modelVersion: string;
  checkpointSha256: string;
}

const WAVEFORM_HEIGHTS = [10, 16, 22, 14, 19, 11, 20, 15, 9, 17, 21, 12, 18, 13];

const REFINED_ENGLISH_TOPIC_TITLES: Record<EducationTopic, string> = {
  what: 'What is it?',
  why: 'Why can it happen?',
  how: 'How does it generally develop?',
  next: 'What should I do next?',
};

type AudioQuery =
  | { scope: 'category'; category: SkinClass; topic: EducationTopic; contentVersion: string }
  | { scope: 'general'; contentVersion: string };

type MediaPlayer = ReturnType<typeof createVerifiedBlobAudioPlayer>;

export function EducationAudio({
  locale,
  text,
  messages,
  createAdapter = createBrowserNarrator,
  createMediaPlayer = createVerifiedBlobAudioPlayer,
  audioQuery,
  audioManifest = educationAudioAssets,
  topicLabel,
  devPreviewActive = false,
  onDevPreviewChange,
  devAsset = null,
}: {
  locale: EducationLocale;
  text: string;
  messages: Messages;
  createAdapter?: () => NarrationAdapter;
  createMediaPlayer?: () => MediaPlayer;
  audioQuery?: AudioQuery;
  audioManifest?: readonly EducationAudioAsset[];
  topicLabel?: string;
  devPreviewActive?: boolean;
  onDevPreviewChange?: (active: boolean) => void;
  devAsset?: InternalAudioAsset | null;
}) {
  const [adapter] = useState(createAdapter);
  const [mediaPlayer] = useState(createMediaPlayer);
  const playButton = useRef<HTMLButtonElement>(null);
  const ttsState = useSyncExternalStore(adapter.subscribe, adapter.state, () => 'idle' as const);
  const mediaState = useSyncExternalStore(mediaPlayer.subscribe, mediaPlayer.state, () => 'idle' as const);
  const ttsAvailable = useSyncExternalStore(
    adapter.subscribeAvailability,
    () => adapter.available(locale),
    () => false,
  );
  const usingDevAudio = Boolean(
    import.meta.env.DEV &&
      devPreviewActive &&
      devAsset &&
      (locale === 'hi' || locale === 'hi-Latn')
  );
  const requestKey = JSON.stringify([locale, text, usingDevAudio ? devAsset?.id : audioQuery ?? null]);
  const [resolvedMedia, setResolvedMedia] = useState<{
    key: string;
    url: string | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;

    if (usingDevAudio && devAsset) {
      void (async () => {
        try {
          const url = await loadVerifiedInternalAudio(devAsset, text, controller.signal);
          if (controller.signal.aborted) {
            URL.revokeObjectURL(url);
            return;
          }
          objectUrl = url;
          mediaPlayer.setSource(url);
          setResolvedMedia({ key: requestKey, url, failed: false });
        } catch {
          if (!controller.signal.aborted) {
            mediaPlayer.setSource(null);
            setResolvedMedia({ key: requestKey, url: null, failed: true });
          }
        }
      })();
      return () => {
        controller.abort();
        mediaPlayer.setSource(null);
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      };
    }

    if (!audioQuery || audioManifest.length === 0) {
      return;
    }
    void (async () => {
      try {
        const textSha256 = await sha256TextHex(text);
        if (controller.signal.aborted) return;
        const matched = resolveEducationAudio(
          audioQuery.scope === 'category'
            ? {
                scope: 'category',
                category: audioQuery.category,
                topic: audioQuery.topic,
                locale,
                contentVersion: audioQuery.contentVersion,
                textSha256,
              }
            : {
                scope: 'general',
                locale,
                contentVersion: audioQuery.contentVersion,
                textSha256,
              },
          audioManifest,
        );
        if (!matched) {
          if (!controller.signal.aborted) {
            mediaPlayer.setSource(null);
            setResolvedMedia({ key: requestKey, url: null, failed: false });
          }
          return;
        }
        const url = await loadVerifiedAudio(matched, text, controller.signal);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        mediaPlayer.setSource(url);
        setResolvedMedia({ key: requestKey, url, failed: false });
      } catch {
        if (!controller.signal.aborted) {
          mediaPlayer.setSource(null);
          setResolvedMedia({ key: requestKey, url: null, failed: true });
        }
      }
    })();
    return () => {
      controller.abort();
      mediaPlayer.setSource(null);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [audioManifest, audioQuery, devAsset, locale, mediaPlayer, requestKey, text, usingDevAudio]);

  useLayoutEffect(
    () => () => {
      adapter.stop();
      mediaPlayer.stop();
    },
    [adapter, mediaPlayer, locale, text],
  );

  const activeMedia = resolvedMedia?.key === requestKey ? resolvedMedia : null;
  const activeMediaUrl = activeMedia && !activeMedia.failed ? activeMedia.url : null;
  const usingVerifiedAudio = Boolean(activeMediaUrl && !(mediaState === 'error' && ttsAvailable));
  const state = usingVerifiedAudio ? mediaState : ttsState;
  const available = usingVerifiedAudio || ttsAvailable;
  const mediaLoadFailed = Boolean(activeMedia?.failed && !ttsAvailable);

  const playing = state === 'playing';
  const paused = state === 'paused';
  const playingOrPaused = playing || paused;
  const isIndianLocale = locale === 'hi' || locale === 'hi-Latn';

  const defaultUnavailableMessage = isIndianLocale
    ? locale === 'hi'
      ? 'सर्वम एआई स्टूडियो ऑडियो तैयार और तकनीकी रूप से सत्यापित है, लेकिन चिकित्सीय समीक्षा लंबित होने के कारण सामान्य मरीज़ सत्रों के लिए अभी जारी नहीं किया गया है। आप नीचे दी गई प्रमाणित जानकारी पढ़ सकते हैं।'
      : 'Sarvam AI studio narration has been generated and technically verified, but is withheld from patient care sessions pending clinical editorial sign-off. The approved text is available to read below.'
    : 'A compatible local offline English voice is not installed on this browser. Remote cloud synthesis is disabled to protect patient privacy. The educational guide is available to read below.';

  const statusMessage =
    state === 'error' || mediaLoadFailed
      ? messages.audioError
      : !available && !playingOrPaused
        ? defaultUnavailableMessage
        : playing
          ? `${messages.listen}: ${localeNames[locale]}`
          : '';

  return (
    <article className="sh-edu-card" id="skin-edu-listen" aria-label={messages.listen}>
      {import.meta.env.DEV && (
        <div className="sh-edu-dev-toolbar">
          <label className="sh-edu-dev-toggle">
            <input
              type="checkbox"
              checked={devPreviewActive}
              onChange={(e) => onDevPreviewChange?.(e.target.checked)}
            />
            <span>Enable Sarvam Developer Preview (Local Review Only)</span>
          </label>
          {devPreviewActive && (
            <span className="sh-pill sh-pill--neutral" style={{ fontSize: '0.72rem' }}>
              Bulbul v4 Flash · 58 tracks
            </span>
          )}
        </div>
      )}

      {import.meta.env.DEV && devPreviewActive && (
        <div className="sh-edu-dev-banner" role="alert">
          <div className="sh-edu-dev-banner-head">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>INTERNAL REVIEW — NOT CLINICALLY APPROVED</span>
          </div>
          <p style={{ margin: 0 }}>
            These Sarvam Bulbul v4 Flash audio tracks are unapproved for patient care. For engineering audio-text alignment and playback testing only.
          </p>
        </div>
      )}

      <div className="sh-edu-card-head">
        <div>
          <h3 className="sh-edu-card-title">{messages.listen}</h3>
          <p className="sh-edu-card-sub">
            {topicLabel ? `${topicLabel} · ` : ''}
            {usingDevAudio && usingVerifiedAudio
              ? 'Sarvam AI v4 Flash (Internal Review)'
              : usingVerifiedAudio
                ? 'Verified offline audio'
                : available
                  ? 'Local browser speech synthesis'
                  : isIndianLocale
                    ? 'Sarvam AI v4 Flash · Pre-release quarantine'
                    : 'Local browser speech synthesis · Offline only'}
          </p>
        </div>
        <span className={`sh-pill ${available ? 'sh-pill--verified' : 'sh-pill--unknown'}`}>
          {available ? (
            <Volume2 size={13} aria-hidden="true" />
          ) : isIndianLocale ? (
            <Lock size={13} aria-hidden="true" />
          ) : (
            <VolumeX size={13} aria-hidden="true" />
          )}
          {usingDevAudio && usingVerifiedAudio
            ? 'Sarvam audio ready (Internal Review)'
            : usingVerifiedAudio
              ? 'Verified audio ready'
              : available
                ? 'Local voice ready'
                : isIndianLocale
                  ? locale === 'hi'
                    ? 'ऑडियो समीक्षाधीन (Clinical Review)'
                    : 'Studio audio in review'
                  : 'Offline voice not installed'}
        </span>
      </div>

      <div className="sh-audio-shell">
        <div className="sh-audio-meta-row">
          <span>
            Narration script ({localeNames[locale]})
          </span>
          <span className="sh-pill sh-pill--neutral">{locale}</span>
        </div>

        <div
          className={`sh-audio-wave ${playing ? 'sh-audio-wave--active' : ''}`}
          aria-hidden="true"
        >
          {WAVEFORM_HEIGHTS.map((height, index) => (
            <span
              key={index}
              className="sh-audio-stick"
              style={{ height: `${height}px` }}
            />
          ))}
          <span className="sh-audio-wave-label">
            {usingDevAudio && usingVerifiedAudio
              ? 'Sarvam AI v4 Flash · Internal review verification'
              : usingVerifiedAudio
                ? 'Verified offline audio · Same-origin'
                : available
                  ? 'Device TTS · Local only'
                  : isIndianLocale
                    ? 'Sarvam AI v4 Flash · Clinical sign-off pending'
                    : 'Device TTS · No offline voice installed'}
          </span>
        </div>

        <div className="sh-audio-controls">
          <button
            ref={playButton}
            type="button"
            className="sh-btn sh-btn--primary"
            disabled={!available && !playingOrPaused}
            title={
              !available && !playingOrPaused
                ? isIndianLocale
                  ? 'Studio narration is undergoing clinical review and is withheld from patient sessions.'
                  : 'A compatible local offline English voice is not installed on this browser.'
                : undefined
            }
            onClick={() => {
              if (usingVerifiedAudio) {
                if (playing) mediaPlayer.pause();
                else if (paused) mediaPlayer.resume();
                else mediaPlayer.play();
                return;
              }
              if (playing) adapter.pause();
              else if (paused) adapter.resume();
              else adapter.play(locale, text);
            }}
          >
            {playing ? messages.pause : paused ? messages.resume : messages.play}
          </button>
          <button
            type="button"
            className="sh-btn sh-btn--secondary"
            onClick={() => {
              if (available) playButton.current?.focus();
              mediaPlayer.stop();
              adapter.stop();
            }}
            disabled={!playingOrPaused}
          >
            {messages.stop}
          </button>
        </div>

        <p
          role="status"
          className={`sh-audio-status ${available && state !== 'error' && !mediaLoadFailed ? 'sh-audio-status--ready' : ''}`}
        >
          {statusMessage ||
            (usingVerifiedAudio
              ? 'Ready to play approved offline narration on this device.'
              : 'Ready to read approved guidance aloud on this device.')}
        </p>

        {import.meta.env.DEV && !usingVerifiedAudio && isIndianLocale && (
          <div
            className="sh-edu-dev-hint"
            style={{
              marginTop: '0.85rem',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'rgba(14, 165, 233, 0.08)',
              border: '1px solid rgba(14, 165, 233, 0.2)',
              fontSize: '0.8rem',
              color: '#38bdf8',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Lock size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>
              Developer Review: Audition all 58 Sarvam tracks across all categories at{' '}
              <Link to="/dev/skin-health-preview" style={{ color: '#ffffff', fontWeight: 600, textDecoration: 'underline' }}>
                /dev/skin-health-preview
              </Link>
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

export function EducationVideo({ asset, messages }: { asset: EducationVideoAsset | null; messages: Messages }) {
  const [failed, setFailed] = useState(false);
  const [verified, setVerified] = useState<{
    asset: EducationVideoAsset; video: string; captions: string;
  } | null>(null);
  useEffect(() => {
    if (!asset) return;
    const controller = new AbortController();
    let urls: { video: string; captions: string } | undefined;
    function release(value: { video: string; captions: string }) {
      URL.revokeObjectURL(value.video);
      URL.revokeObjectURL(value.captions);
    }
    loadVerifiedPlayback(asset, controller.signal).then(value => {
      if (controller.signal.aborted) return release(value);
      urls = value;
      setVerified({ asset, ...value });
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      if (urls) release(urls);
    };
  }, [asset]);
  const playable = verified && verified.asset === asset && !failed ? verified : null;

  return (
    <article className="sh-edu-card" id="skin-edu-watch" aria-label={messages.watch}>
      <div className="sh-edu-card-head">
        <div>
          <h3 className="sh-edu-card-title">{messages.watch}</h3>
          <p className="sh-edu-card-sub">Clinically approved local media with synchronized captions</p>
        </div>
        <span className={`sh-pill ${playable ? 'sh-pill--verified' : 'sh-pill--neutral'}`}>
          {playable ? <Video size={13} aria-hidden="true" /> : <CaptionsOff size={13} aria-hidden="true" />}
          {playable ? 'Captioned asset ready' : 'Asset unavailable'}
        </span>
      </div>

      {!asset || !playable ? (
        <div className="sh-video-stage" role="status">
          <CaptionsOff size={28} strokeWidth={1.6} aria-hidden="true" />
          <p className="sh-video-stage-title">{failed ? messages.videoError : messages.noVideo}</p>
          <p className="sh-video-stage-note">
            Captioned MP4/WebM media and WebVTT transcripts render here only after clinical content review and media asset verification.
          </p>
        </div>
      ) : (
        <video
          controls
          playsInline
          preload="none"
          src={playable.video}
          aria-label={messages.watch}
          className="sh-video-player"
          onError={() => setFailed(true)}
        >
          <track
            default
            kind="captions"
            label={localeNames[asset.captions.locale]}
            srcLang={asset.captions.locale}
            src={playable.captions}
            onErrorCapture={() => setFailed(true)}
          />
          {messages.videoError}
        </video>
      )}
    </article>
  );
}

interface EducationPanelProps {
  locale: EducationLocale;
  verifiedClass?: SkinClass;
  playbackContext: string | null;
  onLocaleChange?: (locale: EducationLocale) => void;
  verifiedContext?: VerifiedPredictionContext | null;
  audioManifest?: readonly EducationAudioAsset[];
  initialDevPreview?: boolean;
}

export function SkinHealthEducation({
  locale,
  verifiedClass,
  playbackContext,
  onLocaleChange,
  verifiedContext = null,
  audioManifest = educationAudioAssets,
  initialDevPreview = false,
}: EducationPanelProps) {
  const [topic, setTopic] = useState<EducationTopic>('what');
  const [modality, setModality] = useState<ModalityTab>('read');
  const [devPreviewActive, setDevPreviewActive] = useState<boolean>(
    Boolean(initialDevPreview && import.meta.env.DEV)
  );
  const activeDevPreview = Boolean(import.meta.env.DEV && devPreviewActive);

  const messages = generalEducation.translations[locale];
  const entry = verifiedClass ? categoryEducation[verifiedClass] : null;
  const translation = entry ? approvedTranslation(entry, locale) : null;

  const devAsset =
    activeDevPreview && (locale === 'hi' || locale === 'hi-Latn')
      ? getInternalAudioAsset({
          scope: verifiedClass ? 'category' : 'general',
          category: verifiedClass,
          topic,
          locale,
        })
      : null;

  const audioText =
    devAsset?.text ??
    translation?.reviewedNarrationScript[topic] ??
    [messages.description, messages.modelLimits, messages.doctorReview].join(' ');
  const audioQuery = useMemo<AudioQuery>(
    () =>
      translation && entry
        ? {
            scope: 'category',
            category: entry.code,
            topic,
            contentVersion: entry.contentVersion,
          }
        : {
            scope: 'general',
            contentVersion: generalEducation.contentVersion,
          },
    [entry, topic, translation],
  );
  const asset =
    translation && entry
      ? resolveEducationVideo(translation.approvedVideoAssetReference, entry.code, locale, entry.contentVersion)
      : null;
  const mediaKey = JSON.stringify([locale, playbackContext, verifiedClass, entry?.contentVersion]);

  function getTopicTitle(key: EducationTopic): string {
    return locale === 'en' ? REFINED_ENGLISH_TOPIC_TITLES[key] : topicLabels[locale][key];
  }

  function renderTopicBody(key: EducationTopic) {
    if (translation) {
      return (
        <>
          {topicFields[key].map((field) => (
            <p key={field} className="sh-edu-topic-copy">
              {translation[field]}
            </p>
          ))}
        </>
      );
    }

    if (key === 'what') {
      return (
        <>
          <p className="sh-edu-topic-copy">
            <strong>Approved general guidance:</strong> {messages.description}
          </p>
          <div className="sh-edu-topic-placeholder">
            {verifiedContext
              ? `Category-specific overview for ${verifiedContext.code} is pending clinical editorial review before publication.`
              : 'Category-specific lesion definitions remain pending clinical editorial review before publication.'}
          </div>
        </>
      );
    }

    if (key === 'why') {
      return (
        <>
          <p className="sh-edu-topic-copy">
            Automated image screening cannot identify why a skin lesion developed or assign patient-specific causes.
          </p>
          <div className="sh-edu-topic-placeholder">
            Pending clinical review — general educational risk and factor information is withheld until approved.
          </div>
        </>
      );
    }

    if (key === 'how') {
      return (
        <>
          <p className="sh-edu-topic-copy">
            Visual features and changes over time vary widely across individuals and must be evaluated in person.
          </p>
          <div className="sh-edu-topic-placeholder">
            Pending clinical review — lesion appearance and progression summaries await clinical sign-off.
          </div>
        </>
      );
    }

    return (
      <>
        <p className="sh-edu-topic-copy">
          <strong>Clinician guidance:</strong> {messages.doctorReview}
        </p>
        <div className="sh-edu-topic-placeholder">
          Category-specific warning signs and clinical evaluation notes remain gated (clinical_review_required).
        </div>
      </>
    );
  }

  function focusModality(target: ModalityTab, elementId: string) {
    setModality(target);
    const targetNode = document.getElementById(elementId);
    targetNode?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return (
    <section
      aria-label={translation?.categoryTitle ?? messages.title}
      className="sh-edu-section"
      lang={locale}
    >
      {/* Editorial Section Header */}
      <div className="sh-edu-header">
        <HeaderBotanicalAccent />
        <div className="sh-edu-header-copy">
          <h2 className="sh-edu-title">Understand your skin health</h2>
          <p className="sh-edu-subtitle">
            Structured patient education aligned with clinically reviewed messaging — presented separately from automated screening scores.
          </p>
        </div>
        <div className="sh-edu-header-badge">
          {verifiedContext ? (
            <span className="sh-pill sh-pill--verified">
              <ShieldCheck size={14} aria-hidden="true" />
              Verified provenance context
            </span>
          ) : (
            <span className="sh-pill sh-pill--neutral">
              <Lock size={13} aria-hidden="true" />
              General educational mode
            </span>
          )}
        </div>
      </div>

      {/* Distinction Strip: Model Output vs. Educational Reference */}
      <div className="sh-edu-distinction">
        <div className="sh-edu-distinction-box">
          <div className="sh-edu-distinction-tile" aria-hidden="true">
            <Scan size={18} />
          </div>
          <div>
            {verifiedContext ? (
              <>
                <div className="sh-edu-distinction-heading">
                  <span>
                    Verified model context: {verifiedContext.label} (<span className="sh-mono">{verifiedContext.code}</span>)
                  </span>
                  <span className="sh-pill sh-pill--code sh-tabular">
                    {(verifiedContext.score * 100).toFixed(1)}% uncalibrated
                  </span>
                </div>
                <p className="sh-edu-distinction-text">
                  Shown because provenance verified <span className="sh-mono">{verifiedContext.modelVersion}</span> ({verifiedContext.checkpointSha256.slice(0, 12)}). Automatically hidden on unverified historical scans.
                </p>
              </>
            ) : (
              <>
                <div className="sh-edu-distinction-heading">
                  <span>No verified model prediction active</span>
                </div>
                <p className="sh-edu-distinction-text">
                  Category context is displayed only when a scan passes model-version and checkpoint verification. General screening education remains available below.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="sh-edu-distinction-divider" aria-hidden="true" />

        <div className="sh-edu-distinction-box sh-edu-distinction-box--edu">
          <div className="sh-edu-distinction-tile sh-edu-distinction-tile--amber" aria-hidden="true">
            <BookOpen size={18} />
          </div>
          <div>
            <div className="sh-edu-distinction-heading">
              <span>Model prediction vs. educational reference</span>
            </div>
            <p className="sh-edu-distinction-text">
              {messages.description} Category-specific drafts remain gated until independent clinical approval is completed.
            </p>
          </div>
        </div>
      </div>

      {/* Signature Guided Library Hero Shell */}
      <div className="sh-edu-hero" id="skin-edu-read">
        <div className="sh-edu-banner">
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.9 }}
            viewBox="0 0 680 144"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
          >
            <path d="M405 118C478 74 562 36 668 14" stroke="#86BCB6" strokeWidth="1.6" opacity="0.28" />
            <path d="M554 34C520 18 476 28 456 60C498 72 534 60 554 34Z" fill="#5D9C97" opacity="0.24" />
            <path d="M0 130C195 137 415 123 565 103C620 94 655 81 680 68V144H0V130Z" fill="#F4F2EC" opacity="0.99" />
          </svg>

          <div className="sh-edu-banner-row">
            <div>
              <div className="sh-edu-banner-title-wrap">
                <BookOpen size={20} aria-hidden="true" />
                <h3 className="sh-edu-banner-title">{translation?.categoryTitle ?? messages.title}</h3>
              </div>
              <p className="sh-edu-banner-sub">
                {translation
                  ? 'Clinically approved category guide'
                  : 'Approved general explanation active · Category-specific topics pending clinical review'}
              </p>
            </div>

            <div className="sh-edu-locale-bar" role="group" aria-label="Education language">
              {locales.map((item) => (
                <button
                  key={item}
                  type="button"
                  lang={item}
                  aria-pressed={locale === item}
                  className="sh-edu-locale-btn"
                  disabled={!onLocaleChange && locale !== item}
                  onClick={() => onLocaleChange?.(item)}
                >
                  {localeNames[item]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sh-edu-surface">
          <div className="sh-edu-modality-bar">
            <div className="sh-edu-modality-group" role="group" aria-label="Education format controls">
              <button
                type="button"
                aria-pressed={modality === 'read'}
                className={`sh-edu-mod-btn ${modality === 'read' ? 'sh-edu-mod-btn--active' : ''}`}
                onClick={() => focusModality('read', 'skin-edu-read')}
              >
                <BookOpen size={15} aria-hidden="true" />
                {messages.read}
              </button>
              <button
                type="button"
                aria-pressed={modality === 'listen'}
                className={`sh-edu-mod-btn ${modality === 'listen' ? 'sh-edu-mod-btn--active' : ''}`}
                onClick={() => focusModality('listen', 'skin-edu-listen')}
              >
                <Volume2 size={15} aria-hidden="true" />
                {messages.listen}
              </button>
              <button
                type="button"
                aria-pressed={modality === 'watch'}
                className={`sh-edu-mod-btn ${modality === 'watch' ? 'sh-edu-mod-btn--active' : ''}`}
                onClick={() => focusModality('watch', 'skin-edu-watch')}
              >
                <Video size={15} aria-hidden="true" />
                {messages.watch}
              </button>
            </div>

            <span className={`sh-pill ${translation ? 'sh-pill--verified' : 'sh-pill--unknown'}`}>
              {translation ? 'Clinically approved guide' : 'Category drafts: clinical_review_required'}
            </span>
          </div>

          {/* 4 Distinct Topic Cards */}
          <div className="sh-edu-topics-grid" role="group" aria-label={messages.read}>
            {educationTopics.map((key, index) => (
              <button
                key={key}
                type="button"
                aria-pressed={topic === key}
                className="sh-edu-topic-card"
                onClick={() => setTopic(key)}
              >
                <div className="sh-edu-topic-top">
                  <div className="sh-edu-topic-title-wrap">
                    <span className="sh-edu-topic-num" aria-hidden="true">
                      0{index + 1}
                    </span>
                    <span className="sh-edu-topic-title">{getTopicTitle(key)}</span>
                  </div>
                  <span
                    className={`sh-pill ${
                      translation || key === 'next' ? 'sh-pill--verified' : 'sh-pill--unknown'
                    }`}
                  >
                    {translation ? 'Approved' : key === 'next' ? 'General guidance' : 'Pending clinical review'}
                  </span>
                </div>
                {renderTopicBody(key)}
              </button>
            ))}
          </div>
        </div>

        <div className="sh-edu-hero-footer">
          <span>
            {translation
              ? 'Approved Stage 3A category copy active.'
              : 'Stage 3A.1 editorial gate active · Unapproved category drafts are never shown.'}
          </span>
          <span className="sh-tabular">
            Topic {educationTopics.indexOf(topic) + 1} selected · {localeNames[locale]}
          </span>
        </div>
      </div>

      {/* Audio / Video + Separate Clinical Safeguards Bento Row */}
      <div className="sh-edu-media-grid">
        <div className="sh-edu-stack">
          <EducationAudio
            key={'audio:' + mediaKey + (activeDevPreview ? ':dev' : '')}
            locale={locale}
            text={audioText}
            messages={messages}
            audioQuery={audioQuery}
            audioManifest={audioManifest}
            topicLabel={getTopicTitle(topic)}
            devPreviewActive={activeDevPreview}
            onDevPreviewChange={setDevPreviewActive}
            devAsset={devAsset}
          />
          <EducationVideo key={'video:' + mediaKey} asset={asset} messages={messages} />
        </div>

        <div className="sh-edu-stack">
          <div className="sh-edu-limitations" role="note">
            <AlertTriangle size={20} strokeWidth={2} style={{ flex: 'none', marginTop: '2px', color: '#8c4f19' }} aria-hidden="true" />
            <div>
              <strong>Medical limitations (always visible)</strong>
              <span>{translation?.whatTheAIResultCannotTellYou ?? messages.modelLimits}</span>
            </div>
          </div>

          <div className="sh-edu-card">
            <div className="sh-edu-card-head">
              <div>
                <h3 className="sh-edu-card-title">Independent doctor review</h3>
                <p className="sh-edu-card-sub">Clinician assessment stays separate from education</p>
              </div>
              <span className="sh-pill sh-pill--neutral">Consent-gated</span>
            </div>
            <p className="sh-edu-topic-copy">
              {translation?.doctorReviewReminder ?? messages.doctorReview}{' '}
              Manage clinical record sharing under Consent &amp; privacy or schedule an in-person dermatology visit.
            </p>
            <div className="sh-edu-actions-row">
              <Link to="/patient/doctors" className="sh-btn sh-btn--primary">
                Book dermatology visit
              </Link>
              <Link to="/patient/consent" className="sh-btn sh-btn--secondary">
                Consent &amp; privacy
              </Link>
            </div>
          </div>

          <div className="sh-edu-card">
            <div className="sh-edu-card-head">
              <h3 className="sh-edu-card-title" style={{ fontSize: '1rem' }}>
                Language parity ({localeNames.en} · {localeNames.hi} · {localeNames['hi-Latn']})
              </h3>
            </div>
            <div className="sh-edu-parity-list">
              <div className="sh-edu-parity-item" lang="hi">
                <strong>हिंदी (hi) · Approved general guidance</strong>
                <span>{generalEducation.translations.hi.description}</span>
              </div>
              <div className="sh-edu-parity-item" lang="hi-Latn">
                <strong>Hinglish (hi-Latn) · Approved general guidance</strong>
                <span>{generalEducation.translations['hi-Latn'].description}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
