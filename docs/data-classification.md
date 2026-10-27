# Data Classification & Privacy Policy

CarePath categorizes all platform data into four distinct classification levels to govern storage, logging, transmission, and access control.

---

## 1. Data Classification Matrix

| Data Classification | Description | Examples | Access Controls | Retention & Handling |
|---|---|---|---|---|
| **Level 1: Public** | Information freely accessible without authentication. | Doctor name, bio, qualifications, active specialties, available slot intervals, consultation fee display. | Unauthenticated GET requests (`/doctors`, `/specialties`). | Cacheable, public indexing allowed. |
| **Level 2: Internal** | Non-sensitive operational data required for system functioning. | Slot IDs, system metrics, non-PHI audit event actions, notification message titles. | Authenticated users and administrators. | Operational logs retained for 90 days. |
| **Level 3: Confidential** | Sensitive personal data, user credentials, and account metadata. | Email addresses, phone numbers, password hashes, refresh token digests, license references. | Scoped to account owner and verified administrators. | Encrypted at rest, never logged in plaintext, Argon2/HMAC hashing. |
| **Level 4: Restricted / PHI** | Protected Health Information and confidential clinical records. | Symptoms / reason for visit, clinical consultation notes, prescription formulations, dosage instructions, patient medical history. | Strictly restricted to patient and assigned treating doctor. Administrators denied direct access. | Redacted from server logs. Version-controlled immutable clinical records. |

---

## 2. Redaction & Logging Restrictions

To prevent data leakage into monitoring systems, APMs, or log aggregators:

1. **Explicit Pino Redaction:**
   - `req.headers.authorization`
   - `req.body.password`
   - `req.body.refreshToken`
   - `req.body.content` (clinical notes)
   - `req.body.credentialReference`
2. **Metrics Label Restrictions:**
   - Prometheus metric labels strictly omit user IDs, patient names, email addresses, or clinical parameters.
   - HTTP metric paths are normalized (e.g. `/api/v1/doctors/:id`) to prevent high-cardinality and accidental parameter leaks.
