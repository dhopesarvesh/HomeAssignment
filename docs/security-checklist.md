# Security Checklist & Hardening Guide

## 1. Authentication & Session Management
- [x] **Password Hashing:** Passwords hashed with Argon2id using recommended memory, time, and parallelism parameters. Plaintext passwords never logged or persisted.
- [x] **Token Lifetimes:** Short-lived JWT access tokens (15-minute TTL).
- [x] **Cryptographic Secret Validation:** Minimum 32-character requirement enforced at server startup for both `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
- [x] **Refresh Token Rotation & Hashing:** Refresh tokens are never stored in plaintext; SHA-256 HMAC digests are stored at rest. Replaced atomically during rotation.
- [x] **Session Revocation:** Logout explicitly revokes the refresh token; admin account suspension revokes all active refresh tokens for the target user.

## 2. Authorization & Access Control
- [x] **Server-Side Role Guards:** Protected endpoints verify authenticated role (`PATIENT`, `DOCTOR`, `ADMIN`).
- [x] **Registration Hardening:** Public registration endpoint hardcodes `role: "PATIENT"`. Any attempt to request elevated privileges (`DOCTOR` or `ADMIN`) is ignored/rejected.
- [x] **Object-Level Authorization:**
  - Patients can only view/cancel/reschedule their own appointments and read their own prescriptions/consultation summaries.
  - Doctors can only view appointments assigned to them, start consultations for their own patients, write notes for their own appointments, and amend their own prescriptions.
  - Administrators are explicitly restricted from viewing clinical medical notes or prescription details without a documented clinical purpose.
- [x] **Active Account Enforcement:** All authenticated requests query `user.isActive` in the database. Suspended accounts are rejected immediately even if an unexpired JWT is presented.

## 3. Data Protection & Sensitive Data Redaction
- [x] **Structured Logging Redaction:** Pino configured to redact:
  - `req.headers.authorization`
  - `req.body.password`
  - `req.body.refreshToken`
  - `req.body.content` (clinical consultation notes)
  - `req.body.credentialReference`
- [x] **Data Minimization:** Public doctor profiles expose only verified credential types and authorities; credential numbers and registration references are restricted.
- [x] **Safe Error Responses:** Internal stack traces, database schema details, and SQL queries suppressed in production. Standardized JSON error response format returned.

## 4. Network & Application Defense
- [x] **Security Headers:** Helmet enabled to set `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and remove `X-Powered-By`.
- [x] **CORS Configuration:** Explicit origin matching against `FRONTEND_ORIGIN` (default `http://localhost:5173`).
- [x] **Rate Limiting:** Global rate limiting (150 requests/min) and strict authentication rate limiting (15 login attempts/min).
- [x] **Payload Size Limits:** JSON request body limited to `32kb` to mitigate denial-of-service payload attacks.
- [x] **SQL & Parameter Injection Defense:** Prisma ORM parameterizes all database interactions. Raw queries use tagged template literals (`tx.$queryRaw`) to enforce parameterized bindings.
