# ANVAYA Healthcare Platform — Deployment & Security Checklist

This document details the critical operational security, clinical data governance, and production readiness requirements for the ANVAYA platform.

---

## 1. Secrets Hygiene & Environment Variables

- [ ] **No Hardcoded Secrets**: All sensitive values (database credentials, JWT signing keys, Redis passwords, Firebase service accounts) MUST be injected exclusively via environment variables (`.env` or orchestrator secret managers).
- [ ] **Cryptographic Random Keys**: Ensure `JWT_SECRET_KEY` is a high-entropy string (min 64 characters) generated with `openssl rand -base64 64`.
- [ ] **File Permissions**: Ensure `.env` and `secrets/` have strict file permissions (`chmod 600` / restricted Windows ACLs) accessible only to the runtime service account.
- [ ] **Version Control Guardrail**: Confirm `.env` and `*.dump` are present in `.gitignore` and never committed.

---

## 2. Clinical Data Governance & Fail-Closed RBAC

- [ ] **Role-Based Access Control**:
  - `patient`: Allowed access only to their own profile, appointments, health records, consent records, prescriptions, and skin-lesion uploads.
  - `doctor`: Allowed access to clinical studio, appointments, and discovery only when `verification_status == 'approved'`.
  - `admin`: Restricted strictly to system management, verification, audit trail oversight, and system-wide dashboards.
- [ ] **Fail-Closed Patient Consent**:
  - Doctor access to patient EHR health records (`/health-records/...`) and skin lesion screenings (`/ai/skin-lesion/patient/{id}`) strictly requires an active `ConsentRecord` (`is_active == True`).
  - Without active consent, endpoints MUST return `HTTP 403 Forbidden` and record a security audit event (`access_denied`).
- [ ] **Tamper-Evident Forensic Audit Logging**:
  - All critical patient data access (`ehr.records.accessed`, `ai.skin_lesion.analyzed`, `ai.skin_lesion.accessed`, `ai.skin_lesion.reviewed`, `consent.granted`, `consent.revoked`) must write to `audit_logs` table.
  - Denied access attempts must persist even when the request fails or rolls back (`record_audit_log` with dedicated session).

---

## 3. AI / ML Offline Separation & Online Inference Guardrails

- [ ] **Offline Training vs. Online Inference**:
  - Offline model training (e.g., HAM10000 preprocessing, model training scripts) is completely isolated from the runtime server.
  - The online inference engine loads pre-trained PyTorch weights (`anvaya_skin_lesion_efficientnet_b0_v1.pth`) in evaluation mode (`torch.inference_mode()`) with frozen weights.
- [ ] **Strict Image Validation & Decompression Bomb Defenses**:
  - Only `image/jpeg` and `image/png` formats are accepted; any other format triggers `HTTP 415 Unsupported Media Type`.
  - Maximum upload size is strictly capped at 10 MB (`HTTP 413 Payload Too Large`).
  - Image dimensions must fall between `64x64` and `8192x8192` with maximum pixels capped at 25,000,000 (`DecompressionBombWarning` treated as error).
- [ ] **Mandatory Non-Diagnostic Disclaimer**:
  - Every AI prediction response and UI rendering MUST present the non-diagnostic clinical disclaimer:
    > *"This is an AI-assisted screening analysis, NOT a definitive diagnosis. It must be reviewed by a qualified dermatologist. Do not start, stop, or alter medical treatment based on this screening."*
- [ ] **Calibrated Fallback Resilience**:
  - If PyTorch checkpoint is missing or unreadable, the inference service gracefully switches to a calibrated estimator without server crashes.

---

## 4. Rate Limiting & Denial-of-Service (DoS) Protection

- [ ] **Sliding-Window Rate Limiting**:
  - `POST /api/v1/auth/login`: Capped at 10 requests per minute per IP.
  - `POST /api/v1/ai/skin-lesion/analyze`: Capped at 20 requests per minute per IP.
  - Exceeded rate limits return `HTTP 429 Too Many Requests` with a `Retry-After` header.
- [ ] **Redis Fault Tolerance**:
  - Redis connection failures gracefully fall back to thread-safe in-memory sliding-window caches without throwing 500 errors.

---

## 5. Database Continuity, Backups & Recovery

- [ ] **Automated Backups**:
  - Execute `scripts/backup_anvaya_db.ps1` daily or on schedule.
  - Verify SHA-256 checksum file is generated for every `.dump` file.
  - Store backups offsite in encrypted cold storage (e.g. S3 Glacier / GCS Archive).
- [ ] **Disaster Recovery Runbook**:
  - Test restoration quarterly using `scripts/restore_anvaya_db.ps1 -BackupFile <file.dump>`.
  - Verify integrity checks before overwriting production databases.

---

## 6. Frontend Production Build & Hardening

- [ ] **TypeScript Type Safety**: Run `npm run build` with zero TypeScript or ESLint errors.
- [ ] **Sanitized Render Trees**: Ensure all user-supplied text (notes, bios, summaries) is escaped to prevent Cross-Site Scripting (XSS).
- [ ] **Secure Storage**: Tokens stored securely; sensitive medical tokens cleared on logout.
