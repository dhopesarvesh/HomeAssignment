import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBookingService } from "../src/booking.js";
import { prisma } from "../src/db.js";

test("20 concurrent bookings for one slot create exactly one appointment", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const patientId = randomUUID();
  const doctorUserId = randomUUID();
  const slotId = randomUUID();
  const slot2Id = randomUUID();
  const doctorProfileId = randomUUID();
  const emailSuffix = randomUUID();
  const startsAt = new Date(Date.now() + 86400000);
  startsAt.setUTCMilliseconds(0);
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
  const slot2StartsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const service = createBookingService(prisma);

  try {
    await prisma.user.createMany({
      data: [
        { id: patientId, email: `patient-${emailSuffix}@example.test`, passwordHash: "synthetic", name: "Synthetic Patient", role: "PATIENT" },
        { id: doctorUserId, email: `doctor-${emailSuffix}@example.test`, passwordHash: "synthetic", name: "Synthetic Doctor", role: "DOCTOR" },
      ],
    });
    await prisma.doctorProfile.create({
      data: { id: doctorProfileId, userId: doctorUserId, specialty: "Test", verified: true },
    });
    await prisma.availabilitySlot.createMany({
      data: [
        { id: slotId, doctorId: doctorProfileId, startsAt, endsAt },
        { id: slot2Id, doctorId: doctorProfileId, startsAt: slot2StartsAt, endsAt: new Date(slot2StartsAt.getTime() + 1800000) },
      ],
    });

    const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      service.book({
        actor: { id: patientId },
        key: `concurrent-${i}-${randomUUID()}`,
        body: { slotId, mode: "ONLINE" },
      }),
    ));
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(await prisma.appointment.count({ where: { slotId } }), 1);

    const success = attempts.find((attempt) => attempt.status === "fulfilled").value.result;
    const replay = await service.book({
      actor: { id: patientId },
      key: attempts.find((attempt) => attempt.status === "fulfilled").value.result
        ? (await prisma.idempotencyRecord.findFirst({ where: { actorId: patientId }, orderBy: { createdAt: "desc" } })).key
        : "",
      body: { slotId, mode: "ONLINE" },
    });
    assert.equal(replay.replay, true);
    assert.equal(replay.result.id, success.id);
    await assert.rejects(
      service.book({
        actor: { id: patientId },
        key: (await prisma.idempotencyRecord.findFirst({ where: { actorId: patientId }, orderBy: { createdAt: "desc" } })).key,
        body: { slotId: slot2Id, mode: "ONLINE" },
      }),
      { status: 409 },
    );
  } finally {
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: patientId } });
    await prisma.auditLog.deleteMany({ where: { actorId: patientId } });
    await prisma.notification.deleteMany({ where: { userId: { in: [patientId, doctorUserId] } } });
    await prisma.consultation.deleteMany({ where: { appointment: { slotId: { in: [slotId, slot2Id] } } } });
    await prisma.appointment.deleteMany({ where: { slotId: { in: [slotId, slot2Id] } } });
    await prisma.availabilitySlot.deleteMany({ where: { id: { in: [slotId, slot2Id] } } });
    await prisma.doctorProfile.deleteMany({ where: { id: doctorProfileId } });
    await prisma.user.deleteMany({ where: { id: { in: [patientId, doctorUserId] } } });
    await prisma.$disconnect();
  }
});
