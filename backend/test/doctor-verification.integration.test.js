import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { createApp } from "../src/app.js";

process.env.NODE_ENV = "test";

test("doctor verification workflow and booking restrictions", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const patientId = randomUUID();
  const doctorUserId = randomUUID();
  const doctorProfileId = randomUUID();
  const adminId = randomUUID();
  const credentialId = randomUUID();
  const slotId = randomUUID();
  const emailSuffix = randomUUID();

  const tokenFor = (id, role) => jwt.sign({ sub: id, role }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const app = createApp(prisma);

  const startsAt = new Date(Date.now() + 86400000);
  const endsAt = new Date(startsAt.getTime() + 1800000);

  try {
    await prisma.user.createMany({
      data: [
        { id: patientId, email: `patient-${emailSuffix}@example.test`, passwordHash: "fixture", name: "Booking Patient", role: "PATIENT" },
        { id: doctorUserId, email: `doctor-${emailSuffix}@example.test`, passwordHash: "fixture", name: "Pending Doctor", role: "DOCTOR" },
        { id: adminId, email: `admin-${emailSuffix}@example.test`, passwordHash: "fixture", name: "Admin Reviewer", role: "ADMIN" },
      ],
    });

    // Create doctor with verified = false
    await prisma.doctorProfile.create({
      data: {
        id: doctorProfileId,
        userId: doctorUserId,
        specialty: "Panchakarma",
        verified: false,
      },
    });

    await prisma.doctorCredential.create({
      data: {
        id: credentialId,
        doctorId: doctorProfileId,
        credentialType: "STATE_LICENSE",
        issuingAuthority: "State Ayurvedic Council",
        credentialReference: "SAC-2023-991",
        verificationStatus: "PENDING",
      },
    });

    await prisma.availabilitySlot.create({
      data: { id: slotId, doctorId: doctorProfileId, startsAt, endsAt, status: "AVAILABLE" },
    });

    const patientAuth = `Bearer ${tokenFor(patientId, "PATIENT")}`;
    const adminAuth = `Bearer ${tokenFor(adminId, "ADMIN")}`;

    // 1. Unverified doctor must NOT be visible in public slots
    const slotsRes = await request(app).get(`/api/v1/doctors/${doctorProfileId}/slots`);
    assert.deepEqual(slotsRes.body.data, []);

    // 2. Patient attempting to book slot of unverified doctor must fail with 409
    await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", patientAuth)
      .set("Idempotency-Key", `unverified-${emailSuffix}`)
      .send({ slotId, mode: "ONLINE" })
      .expect(409);

    // 3. Admin checks verification queue
    const queue = await request(app)
      .get("/api/v1/admin/verification-queue")
      .set("Authorization", adminAuth)
      .expect(200);

    const pending = queue.body.data.find((d) => d.id === doctorProfileId);
    assert.ok(pending);
    assert.equal(pending.verified, false);
    assert.equal(pending.credentials.length, 1);

    // 4. Admin approves doctor verification
    const verifiedRes = await request(app)
      .post(`/api/v1/doctors/${doctorProfileId}/verify`)
      .set("Authorization", adminAuth)
      .send({ verified: true, notes: "All credentials verified against state registry" })
      .expect(200);
    assert.equal(verifiedRes.body.data.verified, true);

    // 5. In-app notification sent to doctor
    const doctorNotification = await prisma.notification.findFirst({
      where: { userId: doctorUserId, type: "DOCTOR_VERIFIED" },
    });
    assert.ok(doctorNotification);

    // 6. Verified doctor's slot is now bookable!
    const bookingRes = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", patientAuth)
      .set("Idempotency-Key", `verified-${emailSuffix}`)
      .send({ slotId, mode: "ONLINE" })
      .expect(201);
    assert.equal(bookingRes.body.data.slotId, slotId);
    assert.equal(bookingRes.body.data.status, "BOOKED");
  } finally {
    await prisma.consultation.deleteMany({ where: { appointment: { slotId } } });
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointment: { slotId } } });
    await prisma.appointment.deleteMany({ where: { slotId } });
    await prisma.availabilitySlot.deleteMany({ where: { id: slotId } });
    await prisma.doctorCredential.deleteMany({ where: { id: credentialId } });
    await prisma.doctorProfile.deleteMany({ where: { id: doctorProfileId } });
    await prisma.notification.deleteMany({ where: { userId: { in: [patientId, doctorUserId, adminId] } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [patientId, doctorUserId, adminId] } } });
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: patientId } });
    await prisma.user.deleteMany({ where: { id: { in: [patientId, doctorUserId, adminId] } } });
  }
});
