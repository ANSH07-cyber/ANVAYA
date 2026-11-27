import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Volume2,
  ArrowLeft,
  FileAudio,
  CheckCircle2,
  Languages,
} from 'lucide-react';
import { SkinHealthEducation } from '../../components/skinHealth/SkinHealthEducation';
import {
  classCodes,
  locales,
  localeNames,
  type EducationLocale,
  type SkinClass,
} from '../../components/skinHealth/catalog';
import { getInternalAudioAsset } from '../../components/dev/internalSkinHealthAudio';

const CATEGORY_NAMES: Record<SkinClass, string> = {
  akiec: 'Actinic Keratosis (akiec)',
  bcc: 'Basal Cell Carcinoma (bcc)',
  bkl: 'Benign Keratosis (bkl)',
  df: 'Dermatofibroma (df)',
  mel: 'Melanoma (mel)',
  nv: 'Melanocytic Nevus (nv)',
  vasc: 'Vascular Lesion (vasc)',
};

export default function SkinHealthDevPreviewPage() {
  const [selectedClass, setSelectedClass] = useState<SkinClass | 'general'>('general');
  const [locale, setLocale] = useState<EducationLocale>('hi');

  const verifiedClass = selectedClass === 'general' ? undefined : selectedClass;

  // Active track info preview
  const currentAsset =
    locale === 'hi' || locale === 'hi-Latn'
      ? getInternalAudioAsset({
          scope: selectedClass === 'general' ? 'general' : 'category',
          category: verifiedClass,
          topic: 'what',
          locale,
        })
      : null;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      {/* Top Dev Header */}
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem',
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: '10px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <span
              style={{
                display: 'inline-flex',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                background: '#0d9488',
                color: '#ffffff',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Stage 4C.4
            </span>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
              Sarvam AI Skin Health Voice Preview
            </h1>
          </div>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            Audition all 58 Sarvam Bulbul v4 Flash tracks directly inside the real SkinHealthEducation UI with cryptographic binding.
          </p>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            to="/patient/skin-health"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '6px',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#334155',
              fontSize: '0.8125rem',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <ArrowLeft size={14} />
            Patient View
          </Link>
          <Link
            to="/dev/audio-review"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '6px',
              background: '#0f172a',
              color: '#ffffff',
              fontSize: '0.8125rem',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <FileAudio size={14} />
            Audio Inventory Table
          </Link>
        </nav>
      </header>

      {/* Dev Configuration Controls */}
      <section
        style={{
          display: 'grid',
          gap: '1rem',
          padding: '1.25rem',
          marginBottom: '2rem',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}
        aria-label="Developer Preview Controls"
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Volume2 size={18} color="#0d9488" />
            <strong style={{ fontSize: '0.9rem', color: '#1e293b' }}>Select Lesion Condition to Audition:</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Languages size={16} color="#64748b" />
            <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>Locale:</span>
            <div style={{ display: 'flex', gap: '0.375rem' }}>
              {locales.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLocale(loc)}
                  style={{
                    padding: '0.25rem 0.625rem',
                    borderRadius: '4px',
                    border: '1px solid',
                    borderColor: locale === loc ? '#0d9488' : '#cbd5e1',
                    background: locale === loc ? '#0d9488' : '#ffffff',
                    color: locale === loc ? '#ffffff' : '#334155',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {localeNames[loc]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Category Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setSelectedClass('general')}
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '999px',
              border: '1px solid',
              borderColor: selectedClass === 'general' ? '#0d9488' : '#e2e8f0',
              background: selectedClass === 'general' ? '#f0fdfa' : '#f8fafc',
              color: selectedClass === 'general' ? '#0f766e' : '#475569',
              fontWeight: selectedClass === 'general' ? 700 : 500,
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            General Skin Health Guidance
          </button>
          {classCodes.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setSelectedClass(code)}
              style={{
                padding: '0.4rem 0.85rem',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: selectedClass === code ? '#0d9488' : '#e2e8f0',
                background: selectedClass === code ? '#f0fdfa' : '#f8fafc',
                color: selectedClass === code ? '#0f766e' : '#475569',
                fontWeight: selectedClass === code ? 700 : 500,
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
            >
              {CATEGORY_NAMES[code]}
            </button>
          ))}
        </div>

        {/* Status Callout Bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: '0.625rem 0.875rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '0.75rem',
            color: '#475569',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 size={14} color="#0d9488" />
            <span>
              Target Track:{' '}
              <strong style={{ color: '#0f172a' }}>
                {currentAsset ? currentAsset.id : 'No Sarvam track (English)'}
              </strong>
            </span>
          </div>
          {currentAsset && (
            <div style={{ display: 'flex', gap: '1rem', fontFamily: 'monospace' }}>
              <span>Duration: {currentAsset.durationSeconds.toFixed(1)}s</span>
              <span>Audio SHA: {currentAsset.audioSha256.slice(0, 10)}...</span>
              <span>Text SHA: {currentAsset.textSha256.slice(0, 10)}...</span>
            </div>
          )}
        </div>
      </section>

      {/* Real Skin Health Education Component Under Review */}
      <SkinHealthEducation
        locale={locale}
        verifiedClass={verifiedClass}
        playbackContext={`dev-preview-${selectedClass}`}
        onLocaleChange={setLocale}
        initialDevPreview={true}
        verifiedContext={
          verifiedClass
            ? {
                label: CATEGORY_NAMES[verifiedClass],
                code: verifiedClass,
                score: 0.94,
                modelVersion: 'ANVAYA-HAM10000-Stage3B',
                checkpointSha256: 'a1b2c3d4e5f6789012345678abcdef0123456789abcdef0123456789abcdef01',
              }
            : null
        }
      />
    </div>
  );
}
