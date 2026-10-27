import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { createApp } from "../src/app.js";

process.env.NODE_ENV = "test";

test("consultation lifecycle, clinical note revisioning, and prescription amendments", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const patientId = randomUUID();
  const doctorUserId = randomUUID();
  const doctorProfileId = randomUUID();
  const slotId = randomUUID();
  const appointmentId = randomUUID();
  const consultationId = randomUUID();
  const emailSuffix = randomUUID();

  const tokenFor = (id, role) => jwt.sign({ sub: id, role }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const app = createApp(prisma);

  const startsAt = new Date(Date.now() + 86400000);
  const endsAt = new Date(startsAt.getTime() + 1800000);

  try {
    await prisma.user.createMany({
      data: [
        { id: patientId, email: `patient-${emailSuffix}@example.test`, passwordHash: "fixture", name: "Clinical Patient", role: "PATIENT" },
        { id: doctorUserId, email: `doctor-${emailSuffix}@example.test`, passwordHash: "fixture", name: "Clinical Doctor", role: "DOCTOR" },
      ],
    });

    await prisma.doctorProfile.create({
      data: { id: doctorProfileId, userId: doctorUserId, specialty: "Ayurveda", verified: true },
    });

    await prisma.availabilitySlot.create({
      data: { id: slotId, doctorId: doctorProfileId, startsAt, endsAt, status: "BOOKED" },
    });

    await prisma.appointment.create({
      data: {
        id: appointmentId,
        patientId,
        doctorId: doctorUserId,
        slotId,
        status: "BOOKED",
        consultation: { create: { id: consultationId } },
      },
    });

    const doctorAuth = `Bearer ${tokenFor(doctorUserId, "DOCTOR")}`;
    const patientAuth = `Bearer ${tokenFor(patientId, "PATIENT")}`;

    // 1. Cannot complete consultation before starting it
    await request(app)
      .post(`/api/v1/consultations/${consultationId}/complete`)
      .set("Authorization", doctorAuth)
      .expect(409);

    // 2. Start consultation (BOOKED -> IN_PROGRESS)
    const started = await request(app)
      .post(`/api/v1/consultations/${consultationId}/start`)
      .set("Authorization", doctorAuth)
      .expect(200);
    assert.ok(started.body.data.startedAt);

    // Verify appointment status is now IN_PROGRESS
    const apptInProgress = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    assert.equal(apptInProgress.status, "IN_PROGRESS");

    // 3. Save initial clinical note (Version 1)
    const note1 = await request(app)
      .post(`/api/v1/consultations/${consultationId}/notes`)
      .set("Authorization", doctorAuth)
      .send({ content: "Initial clinical assessment: Vata-Pitta imbalance noted." })
      .expect(201);
    assert.equal(note1.body.data.version, 1);

    // 4. Update clinical note (Version 2) - should archive Version 1
    const note2 = await request(app)
      .post(`/api/v1/consultations/${consultationId}/notes`)
      .set("Authorization", doctorAuth)
      .send({ content: "Revised assessment: Patient reported improvement after herbal tea." })
      .expect(201);
    assert.equal(note2.body.data.version, 2);

    const noteHistories = await prisma.consultationNoteHistory.findMany({
      where: { noteId: note1.body.data.id },
    });
    assert.equal(noteHistories.length, 1);
    assert.equal(noteHistories[0].version, 1);

    // 5. Issue Prescription (Version 1)
    const rx1 = await request(app)
      .post(`/api/v1/consultations/${consultationId}/prescriptions`)
      .set("Authorization", doctorAuth)
      .send({
        items: [
          { name: "Ashwagandha Churna", dosage: "5g", frequency: "Twice daily", duration: "14 days", instructions: "With warm milk" },
        ],
      })
      .expect(201);
    assert.equal(rx1.body.data.version, 1);
    assert.equal(rx1.body.data.items.length, 1);

    // 6. Amend Prescription (Version 2)
    const rx2 = await request(app)
      .post(`/api/v1/prescriptions/${rx1.body.data.id}/amendments`)
      .set("Authorization", doctorAuth)
      .send({
        reason: "Increased dosage due to acute symptoms",
        items: [
          { name: "Ashwagandha Churna", dosage: "10g", frequency: "Twice daily", duration: "21 days", instructions: "With warm milk" },
          { name: "Triphala Vati", dosage: "1 tablet", frequency: "Bedtime", duration: "21 days", instructions: "With warm water" },
        ],
      })
      .expect(201);
    assert.equal(rx2.body.data.version, 2);
    assert.equal(rx2.body.data.items.length, 2);

    // Check amendment audit record
    const amendmentRecord = await prisma.prescriptionAmendment.findFirst({
      where: { prescriptionId: rx2.body.data.id },
    });
    assert.ok(amendmentRecord);
    assert.equal(amendmentRecord.previousVersion, 1);
    assert.equal(amendmentRecord.newVersion, 2);

    // 7. Complete consultation (IN_PROGRESS -> COMPLETED)
    const completed = await request(app)
      .post(`/api/v1/consultations/${consultationId}/complete`)
      .set("Authorization", doctorAuth)
      .expect(200);
    assert.ok(completed.body.data.completedAt);

    // 8. Patient can view consultations and issued prescription
    const patientConsultations = await request(app)
      .get("/api/v1/consultations")
      .set("Authorization", patientAuth)
      .expect(200);
    assert.equal(patientConsultations.body.data.length, 1);

    const patientPrescription = await request(app)
      .get(`/api/v1/prescriptions/${rx2.body.data.id}`)
      .set("Authorization", patientAuth)
      .expect(200);
    assert.equal(patientPrescription.body.data.version, 2);
  } finally {
    await prisma.prescriptionItem.deleteMany({ where: { prescription: { consultationId } } });
    await prisma.prescriptionAmendment.deleteMany({ where: { prescription: { consultationId } } });
    await prisma.prescription.deleteMany({ where: { consultationId } });
    await prisma.consultationNoteHistory.deleteMany({ where: { note: { consultationId } } });
    await prisma.consultationNote.deleteMany({ where: { consultationId } });
    await prisma.consultation.deleteMany({ where: { id: consultationId } });
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId } });
    await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    await prisma.availabilitySlot.deleteMany({ where: { id: slotId } });
    await prisma.doctorProfile.deleteMany({ where: { id: doctorProfileId } });
    await prisma.notification.deleteMany({ where: { userId: { in: [patientId, doctorUserId] } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [patientId, doctorUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [patientId, doctorUserId] } } });
  }
});
