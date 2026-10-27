import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { createBookingService } from "../src/booking.js";

process.env.NODE_ENV = "test";

test("appointment cancellation and rescheduling maintain database integrity", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const patientId = randomUUID();
  const doctorUserId = randomUUID();
  const doctorProfileId = randomUUID();
  const slot1Id = randomUUID();
  const slot2Id = randomUUID();
  const emailSuffix = randomUUID();

  const startsAt1 = new Date(Date.now() + 86400000);
  const endsAt1 = new Date(startsAt1.getTime() + 1800000);
  const startsAt2 = new Date(startsAt1.getTime() + 7200000);
  const endsAt2 = new Date(startsAt2.getTime() + 1800000);

  const service = createBookingService(prisma);

  try {
    // 1. Create Patient and Verified Doctor
    await prisma.user.createMany({
      data: [
        { id: patientId, email: `patient-${emailSuffix}@example.test`, passwordHash: "fixture", name: "Test Patient", role: "PATIENT" },
        { id: doctorUserId, email: `doctor-${emailSuffix}@example.test`, passwordHash: "fixture", name: "Test Doctor", role: "DOCTOR" },
      ],
    });

    await prisma.doctorProfile.create({
      data: { id: doctorProfileId, userId: doctorUserId, specialty: "Ayurveda", verified: true },
    });

    await prisma.availabilitySlot.createMany({
      data: [
        { id: slot1Id, doctorId: doctorProfileId, startsAt: startsAt1, endsAt: endsAt1, status: "AVAILABLE" },
        { id: slot2Id, doctorId: doctorProfileId, startsAt: startsAt2, endsAt: endsAt2, status: "AVAILABLE" },
      ],
    });

    // 2. Book slot 1
    const { result: appt } = await service.book({
      actor: { id: patientId },
      key: `book-${emailSuffix}`,
      body: { slotId: slot1Id, mode: "ONLINE", reasonForVisit: "Initial checkup" },
    });

    assert.equal(appt.slotId, slot1Id);
    assert.equal(appt.status, "BOOKED");

    // Verify slot 1 is BOOKED
    const slot1AfterBook = await prisma.availabilitySlot.findUnique({ where: { id: slot1Id } });
    assert.equal(slot1AfterBook.status, "BOOKED");

    // 3. Reschedule appt to slot 2
    const rescheduled = await service.reschedule({
      appointmentId: appt.id,
      actor: { id: patientId, role: "PATIENT" },
      body: { newSlotId: slot2Id, reason: "Conflict in personal schedule" },
      correlationId: `resched-${emailSuffix}`,
    });

    assert.equal(rescheduled.slotId, slot2Id);
    assert.equal(rescheduled.rescheduledFromId, slot1Id);

    // Verify slot 1 is now restored to AVAILABLE
    const slot1AfterResched = await prisma.availabilitySlot.findUnique({ where: { id: slot1Id } });
    assert.equal(slot1AfterResched.status, "AVAILABLE");

    // Verify slot 2 is now BOOKED
    const slot2AfterResched = await prisma.availabilitySlot.findUnique({ where: { id: slot2Id } });
    assert.equal(slot2AfterResched.status, "BOOKED");

    // Verify status history has both BOOKED and RESCHEDULED
    const history = await prisma.appointmentStatusHistory.findMany({
      where: { appointmentId: appt.id },
      orderBy: { timestamp: "asc" },
    });
    assert.equal(history.length >= 2, true);
    assert.equal(history[history.length - 1].newStatus, "RESCHEDULED");

    // 4. Cancel the rescheduled appointment
    const cancelled = await service.cancel({
      appointmentId: appt.id,
      actor: { id: patientId, role: "PATIENT" },
      reason: "Patient cancelled rescheduled appointment",
      correlationId: `cancel-${emailSuffix}`,
    });

    assert.equal(cancelled.status, "CANCELLED");

    // Verify slot 2 is now restored to AVAILABLE
    const slot2AfterCancel = await prisma.availabilitySlot.findUnique({ where: { id: slot2Id } });
    assert.equal(slot2AfterCancel.status, "AVAILABLE");

    // 5. Attempting to reschedule a CANCELLED appointment should fail
    await assert.rejects(
      service.reschedule({
        appointmentId: appt.id,
        actor: { id: patientId, role: "PATIENT" },
        body: { newSlotId: slot1Id, reason: "Try again" },
      }),
      { status: 409 },
    );
  } finally {
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointment: { slotId: { in: [slot1Id, slot2Id] } } } });
    await prisma.consultation.deleteMany({ where: { appointment: { slotId: { in: [slot1Id, slot2Id] } } } });
    await prisma.appointment.deleteMany({ where: { slotId: { in: [slot1Id, slot2Id] } } });
    await prisma.availabilitySlot.deleteMany({ where: { id: { in: [slot1Id, slot2Id] } } });
    await prisma.doctorProfile.deleteMany({ where: { id: doctorProfileId } });
    await prisma.notification.deleteMany({ where: { userId: { in: [patientId, doctorUserId] } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [patientId, doctorUserId] } } });
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: patientId } });
    await prisma.user.deleteMany({ where: { id: { in: [patientId, doctorUserId] } } });
  }
});
