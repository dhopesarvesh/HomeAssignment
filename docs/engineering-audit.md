# Engineering Audit: Telemedicine Platform (CarePath)

**Audit Date:** October 2026  
**Auditor:** Senior Software & Security Architecture Review  
**Repository:** `@telemedicine/carepath`  
**Application Type:** Telemedicine Platform (Modular Monolith)  
**Stack:** Node.js, Express.js, Prisma ORM, PostgreSQL 16, React 18, Vite  

---

## Executive Summary

This engineering audit examines the architecture, security posture, database design, business workflows, testing coverage, and operational readiness of the existing codebase. 

The original codebase established a functional initial MVP implementing password hashing with Argon2id, JWT access/refresh token rotation, atomic slot claim with PostgreSQL `Serializable` transactions, idempotency enforcement, and preliminary audit logging. However, to operate as a reliable, secure, and production-grade telemedicine system, critical deficiencies in database normalization, clinical lifecycle management, rescheduling, doctor credentialing, role-based and object-level access controls, and administrative governance needed to be addressed.

Every finding below has been evaluated against enterprise standards and classified as **Critical**, **High**, **Medium**, or **Low**.

---

## 1. Current Architecture

### 1.1 Architectural Pattern
- **Pattern:** Modular Monolith with separate frontend and backend workspaces under npm workspaces (`/backend`, `/frontend`).
- **Backend:** Node.js (ES modules) with Express.js exposing RESTful JSON endpoints under `/api/v1`.
- **Frontend:** Single Page Application (SPA) built with React 18 and Vite, consuming backend APIs via Axios.
- **Persistence Layer:** PostgreSQL 16 via Prisma ORM 6.2.1, with declarative migrations in `backend/prisma/migrations`.
- **Infrastructure:** Docker Compose configuration providing a PostgreSQL container on port `5433` (mapped to internal `5432`), alongside containerized API and frontend development configurations.

### 1.2 Strengths
- **Transactional Slot Claim:** The initial booking implementation in `backend/src/booking.js` utilized atomic row updates (`UPDATE "AvailabilitySlot" ... WHERE status = 'AVAILABLE'`) and `Serializable` isolation level to avert double-booking.
- **Idempotency Guard:** Required `Idempotency-Key` headers on appointment creation, persisting request fingerprints in `IdempotencyRecord` to prevent duplicate billing or ghost bookings.
- **Modern Cryptography:** Passwords hashed with Argon2id; refresh tokens stored as SHA-256 HMAC digests rather than plaintext tokens.
- **Clean Aesthetic:** Established Amrutam-inspired earth-toned design identity (`#23483c` deep forest green, `#d19a50` gold accent, `#f6f7f1` warm off-white, and `#849575` sage green).

### 1.3 Architectural Bottlenecks & Weaknesses
- **Monolithic Route Clustering:** Business logic was concentrated directly inside a single 470-line `app.js` file, blending HTTP controller logic, schema validation, transaction management, and business rules.
- **Lack of Domain Layering:** No dedicated service or repository modules existed outside of `booking.js` and `auth.js`.
- **Incomplete Workflow State Machines:** Consultation states (`BOOKED` -> `IN_PROGRESS` -> `COMPLETED`) lacked robust lifecycle validation and rescheduling was entirely absent.
- **Lack of Observability:** No Prometheus metrics, latency histograms, or connection pool health instrumentation existed.

---

## 2. Existing Working Features

Prior to remediation, the following features operated in the baseline MVP:
1. **User Authentication:** Registration of patient accounts; login for patients, doctors, and admins; JWT access token generation (15m TTL) and refresh token rotation.
2. **Doctor Directory:** Public retrieval of verified doctors (`/api/v1/doctors`) with basic name search query.
3. **Availability Slots:** Retrieval of available future slots for a doctor (`/api/v1/doctors/:id/slots`).
4. **Idempotent Booking:** Transactional creation of appointments using atomic slot updates and idempotency records.
5. **Basic Appointment Listing:** Scoped appointment retrieval for patients and doctors.
6. **Cancellation:** Basic cancellation of `BOOKED` appointments releasing the slot back to `AVAILABLE`.
7. **Basic Consultation & Prescription:** Baseline endpoints to start/complete consultations, record notes, and append prescriptions.
8. **Admin Overview:** Summary counters for patients, doctors, and appointment status distribution.

---

## 3. Incomplete or Non-Functional Features

The audit identified significant gaps in expected telemedicine workflows:

### Finding 3.1: Rescheduling Workflow Completely Missing
- **Severity:** High
- **Description:** Patients had no mechanism to reschedule an appointment. Rescheduling required manual cancellation and a separate new booking, which left patients vulnerable to slot loss and created disconnected audit histories.
- **Remediation:** Implement an atomic `POST /api/v1/appointments/:id/reschedule` endpoint that swaps slots within a single transaction, records `AppointmentStatusHistory`, and notifies both patient and doctor.

### Finding 3.2: Doctor Verification & Credential Management Incomplete
- **Severity:** High
- **Description:** Doctor profiles only possessed a boolean `verified` flag. There were no models for medical licenses, degrees, issuing councils, credential reference numbers, or admin verification logs.
- **Remediation:** Introduce `DoctorCredential` model, admin approval/rejection endpoints with audit metadata, and prevent unverified or rejected doctors from appearing in search or accepting bookings.

### Finding 3.3: Doctor Specialties Non-Normalized
- **Severity:** Medium
- **Description:** `DoctorProfile.specialty` was a loose string column. Multiple specialties, standardized taxonomies (e.g., Ayurveda, Kayachikitsa, Panchakarma, Shalya Tantra), and faceted search were impossible.
- **Remediation:** Introduce a normalized `Specialty` model and `DoctorSpecialty` join relation, allowing multiple specialties per doctor and structured filtering.

### Finding 3.4: Lack of Availability Rules and Blocked Periods
- **Severity:** Medium
- **Description:** Doctors could only create individual slots one by one. There was no recurring weekly rule engine (`AvailabilityRule`) or time-off blocking (`DoctorBlockedPeriod`), forcing doctors to manually generate dozens of slots.
- **Remediation:** Implement `AvailabilityRule` for recurring schedules, `DoctorBlockedPeriod` for vacation/leave blocking, and generator routines.

### Finding 3.5: Clinical Note and Prescription Versioning Lacked Controlled Amendments
- **Severity:** High
- **Description:** Consultation notes were updated via simple `upsert`, silently overwriting clinical history. Prescriptions supported new version records, but lacked an amendment audit log tracking the amending doctor, previous version, and justification.
- **Remediation:** Enforce immutable consultation notes with version increments, and introduce `PrescriptionAmendment` tracking rationale and previous version state.

### Finding 3.6: Patient Consent and Privacy Records Absent
- **Severity:** High
- **Description:** No consent records existed to document patient agreement to telemedicine terms, data processing policies, or treatment consent versions.
- **Remediation:** Implement `ConsentRecord` domain supporting versioned policy acceptance and revocation with timestamps and IP/client metadata.

---

## 4. Database Models & Schema Gaps

| Model Domain | Existing Model | Missing Fields / Relationships | Severity |
|---|---|---|---|
| **Identity** | `User` | Lacked account suspension audit reason, last login tracking | Medium |
| **Profile** | `PatientProfile` | Only had `phone` and `birthDate`; lacked `preferredLanguage`, `emergencyContact`, `gender` | Medium |
| **Doctor Profile** | `DoctorProfile` | Lacked `qualifications`, `experienceYears`, `languages`, `consultationModes`, structured relation to `Specialty` | High |
| **Credentials** | *Missing* | `DoctorCredential` model completely absent (license number, issuing authority, verification status) | High |
| **Specialties** | *Missing* | Normalized `Specialty` and `DoctorSpecialty` absent | Medium |
| **Scheduling** | `AvailabilitySlot` | Lacked recurring rule entity (`AvailabilityRule`) and leave blocking (`DoctorBlockedPeriod`) | High |
| **Appointments** | `Appointment` | Lacked `reasonForVisit`, `cancellationReasonCategory`, status history link, and rescheduling link | High |
| **Status History**| *Missing* | `AppointmentStatusHistory` absent; status changes were not preserved with actor and reason | High |
| **Clinical** | `ConsultationNote` | Overwrote records on edit; lacked version number and author ID | High |
| **Prescriptions** | `Prescription` | Lacked explicit `PrescriptionAmendment` audit record with reason and author | Medium |
| **Consent** | *Missing* | `ConsentRecord` absent; no tracking of terms and HIPAA/telemedicine notices | High |

---

## 5. Security Weaknesses

### Finding 5.1: Missing Object-Level Access Control on Clinical Records
- **Severity:** Critical
- **Details:** While route middleware checked roles (`DOCTOR`, `PATIENT`), individual consultation notes and prescriptions were vulnerable if an actor crafted request IDs. Direct authorization checks verifying that `appointment.doctorId === req.user.id` or `appointment.patientId === req.user.id` had to be strictly asserted across all clinical endpoints.
- **Remediation:** Enforce object-level verification helpers across all clinical services.

### Finding 5.2: Public Registration Privileges
- **Severity:** Critical
- **Details:** Public registration must never allow an attacker to supply `role: "ADMIN"` or `role: "DOCTOR"`. 
- **Remediation:** Hardcode `role: "PATIENT"` on the registration service and enforce validation errors if elevated roles are requested.

### Finding 5.3: Refresh Token Replay & Session Revocation
- **Severity:** High
- **Details:** If a refresh token was compromised, rotation invalidated only the single token rather than all active sessions in an anomaly scenario.
- **Remediation:** Implement session revocation endpoints and verify active user status on every authenticated token verification.

### Finding 5.4: Secret Leakage & Logging Restrictions
- **Severity:** High
- **Details:** Unredacted request logging could inadvertently write passwords, refresh tokens, or clinical health notes into server log files.
- **Remediation:** Configure Pino with explicit redaction paths: `req.headers.authorization`, `req.body.password`, `req.body.refreshToken`, `req.body.content`.

---

## 6. Data Integrity Risks

### Finding 6.1: Concurrent Booking Race Condition
- **Severity:** Critical
- **Risk:** Multiple patients simultaneously attempting to book the same slot could cause double-booking if database isolation is insufficient.
- **Remediation:** Retain PostgreSQL `Serializable` transaction isolation combined with conditional atomic updates (`UPDATE "AvailabilitySlot" SET status = 'BOOKED' WHERE id = $1 AND status = 'AVAILABLE' RETURNING id`). Verify with 20 parallel concurrent promises in automated tests.

### Finding 6.2: Orphaned Slots on Appointment Cancellation/Rescheduling
- **Severity:** High
- **Risk:** If an appointment cancellation failed midway through updating the appointment record, the slot could remain locked in `BOOKED` or prematurely freed.
- **Remediation:** Wrap all slot status changes and appointment state transitions in atomic transactions with explicit rollback on error.

---

## 7. Frontend/Backend Integration Gaps

### Finding 7.1: Monolithic SPA with Limited Role-Based Routing
- **Severity:** High
- **Details:** The baseline frontend in `frontend/src/main.jsx` combined Patient, Doctor, and Admin interfaces in a single vertical stream without navigation tabs, doctor profile editing, credential management, rescheduling, or notification centers.
- **Remediation:** Upgrade the frontend with dedicated role-based tabs, modals for booking and rescheduling, consultation note and prescription builders, doctor availability rule editors, admin verification queues, and in-app notification centers.

### Finding 7.2: Missing Search and Filtering Controls
- **Severity:** Medium
- **Details:** Doctor directory search only supported a single `q` text query. Filters for specialty, consultation mode, and languages were not exposed.
- **Remediation:** Integrate multi-parameter filtering on the backend and wire interactive filters in the React UI.

---

## 8. Missing Tests

Prior to this upgrade, automated tests had several notable omissions:
1. **Skipped Concurrency Test:** The 20-client concurrent booking test was skipped by default unless `RUN_DB_INTEGRATION=1` was manually passed.
2. **Rescheduling & Cancellation Tests:** Zero automated tests existed for rescheduling conflicts, status history tracking, and invalid cancellation windows.
3. **Clinical Access Control Tests:** No tests checked that Doctor B cannot edit Doctor A's consultation notes or view Patient B's prescriptions.
4. **Doctor Verification Workflow:** No tests verified that an unverified doctor's slots cannot be booked.
5. **Consent Record Tests:** No tests verified privacy policy acceptance or revocation.

---

## 9. Prioritized Remediation Plan

| Priority | Phase | Actions | Status |
|---|---|---|---|
| **P0** | **Data Model & Migrations** | Normalize schema: add `Specialty`, `DoctorSpecialty`, `DoctorCredential`, `AvailabilityRule`, `DoctorBlockedPeriod`, `AppointmentStatusHistory`, `PrescriptionAmendment`, `ConsentRecord`. Run clean migrations. | **Target: Phase 4** |
| **P0** | **Core Workflows** | Implement atomic Rescheduling, Doctor Verification with credentials, Clinical Note Versioning, Prescription Amendments, and In-App Notifications. | **Target: Phase 4** |
| **P0** | **Concurrency & Security** | Ensure 20-thread concurrency test runs and passes, test idempotency replays and conflicts, enforce strict object-level access controls. | **Target: Phase 5** |
| **P1** | **Frontend Experience** | Build full interactive tabs for Patient, Doctor, and Admin with modern Amrutam design; provide complete workflows for booking, rescheduling, clinical notes, prescriptions, notifications, and verification. | **Target: Phase 6** |
| **P1** | **Automated Test Suite** | Deliver unit, integration, and security test suites covering all workflows and verify 100% test pass rate. | **Target: Phase 7** |
| **P2** | **Observability & Docs** | Add structured logging, Prometheus-compatible metrics endpoint, and complete documentation artifacts. | **Target: Phase 8** |

---

*This engineering audit establishes the baseline findings and serves as the architectural specification for the remediation implementation.*
