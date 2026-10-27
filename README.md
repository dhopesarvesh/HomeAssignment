# CarePath: Amrutam-Inspired Telemedicine Platform

CarePath is an enterprise-grade telemedicine application inspired by holistic Ayurvedic clinical practice. Built as a high-integrity modular monolith, CarePath features a React single-page frontend, a Node.js/Express.js REST API, and PostgreSQL 16 managed via Prisma ORM.

---

## Key Features & Architecture

- **Visual Identity:** Preserved Amrutam-inspired earth aesthetic (`#f6f7f1` warm background, `#23483c` herbal forest green, `#d19a50` gold accent, `#849575` sage green) with responsive layouts.
- **Role-Based Workflows:** Distinct, fully-interactive experiences for Patients, Doctors, and Administrators, plus a public guest directory.
- **Atomic Booking Concurrency Guard:** PostgreSQL `Serializable` transaction isolation combined with conditional atomic slot claims to prevent double-booking.
- **Idempotency Engine:** Prevents duplicate appointment creation on network retries using `Idempotency-Key` headers and payload SHA-256 fingerprinting.
- **Clinical Lifecycle & State Machine:** Consultation progression (`BOOKED` -> `IN_PROGRESS` -> `COMPLETED`) with immutable versioned clinical notes and prescription amendments.
- **Doctor Credentialing & Verification:** Formal `DoctorCredential` review pipeline where administrators verify practitioner licenses before doctors can publish slots or accept bookings.
- **Atomic Rescheduling & Cancellation:** Swaps appointment slots atomically within a single transaction, frees prior slots, logs status history, and dispatches in-app notifications.
- **In-App Notification Center:** PostgreSQL-backed real-time notifications with unread counts and read-state management.
- **Patient Consent & Privacy:** Version-controlled consent registry tracking telemedicine terms, privacy notices, and revocation timestamps.
- **Observability:** Prometheus-compatible metrics endpoint (`/metrics`), structured Pino JSON logging with secret redaction, and `X-Correlation-ID` tracking.
- **Zero Payment Functionality:** Scope strictly excludes payments, gateways, or billing.

---

## Quick Demo Persona Accounts

| Persona / Role | Email | Password | Description |
|---|---|---|---|
| **Patient** | `patient@example.test` | `Patient-demo-42` | Pre-seeded with consent records and completed consultation history. |
| **Verified Doctor** | `doctor@example.test` | `Doctor-demo-42` | Dr. Anaya Sharma (Ayurveda), 14y experience, verified credentials, active slots. |
| **Pending Doctor** | `dr.rajesh@example.test` | `Doctor-demo-42` | Dr. Rajesh Varma (Panchakarma), submitted credentials awaiting admin review. |
| **Administrator** | `admin@example.test` | `Admin-demo-42` | Access to verification queue, user management, audit trail, and analytics. |

*(The frontend also includes a 1-click **Quick Demo Switcher** bar at the top of the interface for instantaneous switching between roles without manual typing!)*

---

## Local Development Setup

### 1. Prerequisites
- Node.js 20+ (v22 recommended)
- Docker & Docker Compose

### 2. Environment Configuration
The project is configured out-of-the-box with `.env`:
```bash
cp .env.example .env
```

### 3. Start PostgreSQL Database
```bash
docker compose up -d postgres
```
*(PostgreSQL starts on host port `5433` mapped to internal `5432`)*

### 4. Run Database Migrations & Deterministic Seed
```bash
npm run db:deploy -w backend
npm run db:seed -w backend
```

### 5. Start the Application
Run frontend and backend concurrently:
```bash
npm run dev
```
- **Frontend Web UI:** `http://localhost:5174`
- **Backend API:** `http://localhost:3001/api/v1`
- **Prometheus Metrics:** `http://localhost:3001/metrics`
- **Health Check:** `http://localhost:3001/health`
- **Readiness Check:** `http://localhost:3001/ready`

---

## Automated Test Suite

Run the complete integration, concurrency, security, and lifecycle test suite:
```bash
RUN_DB_INTEGRATION=1 npm run test -w backend
```

### Test Suite Summary:
1. `clinical endpoints enforce patient and assigned-doctor ownership`: Object-level authorization tests.
2. `20 concurrent bookings for one slot create exactly one appointment`: 20-thread high-contention concurrency benchmark.
3. `booking rejects a missing idempotency key before touching persistence`: Idempotency guard unit test.
4. `patient consent recording, revocation, and notification management`: Consent registry and in-app notifications.
5. `consultation lifecycle, clinical note revisioning, and prescription amendments`: Consultation state transitions, note version history, and prescription amendments.
6. `doctor verification workflow and booking restrictions`: Verification queue and unverified doctor booking blocks.
7. `appointment cancellation and rescheduling maintain database integrity`: Atomic slot swap and cancellation slot restoration.

---

## Repository Documentation

- [Engineering Audit](docs/engineering-audit.md)
- [System Architecture](docs/architecture.md)
- [Database ER Diagram](docs/er-diagram.mmd)
- [Booking Sequence Diagram](docs/booking-sequence.mmd)
- [API Reference Guide](docs/api-guide.md)
- [OpenAPI Specification](docs/openapi.json)
- [Security Checklist](docs/security-checklist.md)
- [Threat Model (STRIDE)](docs/threat-model.md)
- [Data Classification](docs/data-classification.md)
- [Observability Guide](docs/observability.md)
- [Backup & Disaster Recovery](docs/backup-and-disaster-recovery.md)
- [Performance & Concurrency Testing](docs/performance-testing.md)
