import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { createApp } from "../src/app.js";

process.env.NODE_ENV = "test";

test("clinical endpoints enforce patient and assigned-doctor ownership", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const suffix = randomUUID();
  const ids = {
    patient: randomUUID(),
    otherPatient: randomUUID(),
    doctor: randomUUID(),
    admin: randomUUID(),
    doctorProfile: randomUUID(),
    slot: randomUUID(),
    appointment: randomUUID(),
    consultation: randomUUID(),
    note: randomUUID(),
    prescription: randomUUID(),
    item: randomUUID(),
  };
  const emails = Object.fromEntries(Object.entries(ids).slice(0, 4).map(([role, id]) => [role, `${role}-${id}@example.test`]));
  const tokenFor = (id, role) => jwt.sign({ sub: id, role }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const app = createApp(prisma);

  try {
    await prisma.user.createMany({
      data: [
        { id: ids.patient, email: emails.patient, name: "Synthetic Patient", role: "PATIENT", passwordHash: "fixture" },
        { id: ids.otherPatient, email: emails.otherPatient, name: "Other Synthetic Patient", role: "PATIENT", passwordHash: "fixture" },
        { id: ids.doctor, email: emails.doctor, name: "Synthetic Doctor", role: "DOCTOR", passwordHash: "fixture" },
        { id: ids.admin, email: emails.admin, name: "Synthetic Admin", role: "ADMIN", passwordHash: "fixture" },
      ],
    });
    await prisma.doctorProfile.create({
      data: { id: ids.doctorProfile, userId: ids.doctor, specialty: "Test", verified: true },
    });
    const startsAt = new Date(Date.now() + 2 * 86400000);
    await prisma.availabilitySlot.create({
      data: { id: ids.slot, doctorId: ids.doctorProfile, startsAt, endsAt: new Date(startsAt.getTime() + 1800000), status: "BOOKED" },
    });
    await prisma.appointment.create({
      data: {
        id: ids.appointment,
        patientId: ids.patient,
        doctorId: ids.doctor,
        slotId: ids.slot,
        status: "COMPLETED",
        consultation: {
          create: {
            id: ids.consultation,
            note: { create: { id: ids.note, content: "Synthetic private clinical note." } },
            prescriptions: {
              create: {
                id: ids.prescription,
                items: { create: { id: ids.item, name: "Synthetic treatment", dosage: "Once daily", duration: "3 days" } },
              },
            },
          },
        },
      },
    });

    const patientAuth = `Bearer ${tokenFor(ids.patient, "PATIENT")}`;
    const otherAuth = `Bearer ${tokenFor(ids.otherPatient, "PATIENT")}`;
    const doctorAuth = `Bearer ${tokenFor(ids.doctor, "DOCTOR")}`;
    const adminAuth = `Bearer ${tokenFor(ids.admin, "ADMIN")}`;

    const ownAppointments = await request(app).get("/api/v1/appointments").set("Authorization", patientAuth).expect(200);
    assert.deepEqual(ownAppointments.body.data.map((item) => item.id), [ids.appointment]);
    const otherAppointments = await request(app).get("/api/v1/appointments").set("Authorization", otherAuth).expect(200);
    assert.deepEqual(otherAppointments.body.data, []);

    await request(app).get("/api/v1/consultations").set("Authorization", otherAuth).expect(200).expect((res) => {
      assert.deepEqual(res.body.data, []);
    });
    await request(app).get("/api/v1/prescriptions/" + ids.prescription).set("Authorization", otherAuth).expect(404);
    await request(app).get("/api/v1/prescriptions/" + ids.prescription).set("Authorization", patientAuth).expect(200);
    await request(app).get("/api/v1/prescriptions/" + ids.prescription).set("Authorization", doctorAuth).expect(200);
    await request(app).get("/api/v1/prescriptions/" + ids.prescription).set("Authorization", adminAuth).expect(403);
    await request(app).post(`/api/v1/consultations/${ids.consultation}/notes`).set("Authorization", otherAuth).send({ content: "Unauthorized note" }).expect(403);
    await request(app).post(`/api/v1/consultations/${ids.consultation}/notes`).set("Authorization", doctorAuth).send({ content: "Updated synthetic note." }).expect(201);

    const registered = await request(app).post("/api/v1/auth/register").send({
      email: `role-attempt-${suffix}@example.test`,
      password: "Synthetic-Test-Password-42",
      name: "Role Test",
      role: "ADMIN",
    }).expect(201);
    assert.equal(registered.body.user.role, "PATIENT");
    await prisma.refreshToken.deleteMany({ where: { userId: registered.body.user.id } });
    await prisma.patientProfile.deleteMany({ where: { userId: registered.body.user.id } });
    await prisma.user.delete({ where: { id: registered.body.user.id } });
  } finally {
    await prisma.prescriptionItem.deleteMany({ where: { id: ids.item } });
    await prisma.prescription.deleteMany({ where: { id: ids.prescription } });
    await prisma.consultationNote.deleteMany({ where: { id: ids.note } });
    await prisma.consultation.deleteMany({ where: { id: ids.consultation } });
    await prisma.appointment.deleteMany({ where: { id: ids.appointment } });
    await prisma.availabilitySlot.deleteMany({ where: { id: ids.slot } });
    await prisma.doctorProfile.deleteMany({ where: { id: ids.doctorProfile } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: Object.values(ids).slice(0, 4) } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: Object.values(ids).slice(0, 4) } } });
    await prisma.patientProfile.deleteMany({ where: { userId: { in: Object.values(ids).slice(0, 4) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids).slice(0, 4) } } });
  }
});
