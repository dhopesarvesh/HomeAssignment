# Threat Model (STRIDE Framework)

**System:** CarePath Telemedicine Platform  
**Target:** Modular Monolith API, React Client & PostgreSQL Persistence  

---

## 1. Spoofing Identity

| Threat | Vulnerability / Attack Vector | Mitigation in Codebase |
|---|---|---|
| Attacker masquerades as a patient or doctor | Credential stuffing or token forgery | Argon2id password hashing; HMAC-SHA256 signature on JWT with 32+ char secrets; refresh token rotation. |
| Malicious user registers as Doctor or Admin | Tampering with request body during registration | `auth.js` enforces `role: "PATIENT"` on registration regardless of supplied role field. |
| Stolen refresh token replay | Token compromise | Tokens rotated on every refresh; old token immediately revoked; session revoked across all devices upon account suspension. |

---

## 2. Tampering with Data

| Threat | Vulnerability / Attack Vector | Mitigation in Codebase |
|---|---|---|
| Doctor overwrites historical clinical notes | Clinical malpractice / dispute | `ConsultationNote` updates archive prior note version in `ConsultationNoteHistory` and increment version number. |
| Modifying an issued prescription | Drug manipulation | Prescriptions are versioned and immutable; amendments require new version records and mandatory clinical justification in `PrescriptionAmendment`. |
| Double-booking an already reserved slot | Race condition between multiple booking requests | PostgreSQL `Serializable` transaction combined with conditional atomic write (`UPDATE ... WHERE status = 'AVAILABLE' RETURNING id`). |
| Duplicate appointment creation on client network retry | Network timeout during booking request | Mandatory `Idempotency-Key` header with SHA-256 fingerprint checking. Replays existing response if fingerprint matches; rejects conflicts. |

---

## 3. Repudiation

| Threat | Vulnerability / Attack Vector | Mitigation in Codebase |
|---|---|---|
| Doctor denies issuing a prescription | Lack of accountability | `Prescription` links to consultation and doctor user ID; immutable `AuditLog` captures doctor ID, timestamp, and correlation ID. |
| Patient denies scheduling or cancelling | Disputed consultation fees/time | `AppointmentStatusHistory` records previous and new status, actor ID, timestamp, and reason category. |
| Patient revokes consent and claims data was accessed unlawfully | Privacy compliance disputes | `ConsentRecord` stores status (`GRANTED`/`REVOKED`), policy version, and timestamps. |

---

## 4. Information Disclosure

| Threat | Vulnerability / Attack Vector | Mitigation in Codebase |
|---|---|---|
| Cross-patient consultation / prescription access | Insecure Direct Object Reference (IDOR) | Service queries enforce `appointment.patientId === req.user.id` or `appointment.doctorId === req.user.id`. Unauthorized access returns 404 or 403. |
| Sensitive credentials leaked in logs | Unredacted request logging | Pino configured to redact `authorization`, `password`, `refreshToken`, `clinicalNote`, and `credentialReference`. |
| Database errors expose schema in API responses | Unhandled exception propagation | Centralized Express error handler masks 500 errors to `"Internal server error"` and suppresses stack traces in production. |

---

## 5. Denial of Service (DoS)

| Threat | Vulnerability / Attack Vector | Mitigation in Codebase |
|---|---|---|
| Brute force password guessing | Credential spray attack | Strict rate limiting on `/auth/login` (15 requests/min per IP). |
| Resource exhaustion via large JSON payloads | Memory denial of service | `express.json({ limit: "32kb" })` rejects oversized request bodies. |
| Database connection pool exhaustion under concurrent booking spikes | Connection leaks | Dedicated Prisma connection pooling with explicit transaction timeouts and clean disconnection in finally blocks. |

---

## 6. Elevation of Privilege

| Threat | Vulnerability / Attack Vector | Mitigation in Codebase |
|---|---|---|
| Patient accesses administrative analytics | Broken object-level authorization | `requireRole("ADMIN")` middleware protects all `/admin/*` routes. |
| Doctor verifies their own account or credentials | Privilege escalation | Doctor verification endpoints (`/doctors/:doctorId/verify`) require `ADMIN` role. |
| Administrator directly browses confidential clinical notes | Excessive administrative privilege | Administrator role is restricted from reading clinical consultation notes or prescription details. |
