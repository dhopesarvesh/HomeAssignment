import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { createApp } from "../src/app.js";

process.env.NODE_ENV = "test";

test("patient consent recording, revocation, and notification management", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const patientId = randomUUID();
  const notificationId = randomUUID();
  const emailSuffix = randomUUID();

  const tokenFor = (id, role) => jwt.sign({ sub: id, role }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const app = createApp(prisma);

  try {
    await prisma.user.create({
      data: {
        id: patientId,
        email: `patient-${emailSuffix}@example.test`,
        passwordHash: "fixture",
        name: "Consent Patient",
        role: "PATIENT",
        notifications: {
          create: {
            id: notificationId,
            type: "WELCOME",
            title: "Welcome to CarePath",
            message: "Welcome to your telemedicine wellness dashboard.",
          },
        },
      },
    });

    const patientAuth = `Bearer ${tokenFor(patientId, "PATIENT")}`;

    // 1. Record Consent
    const consentRes = await request(app)
      .post("/api/v1/consent")
      .set("Authorization", patientAuth)
      .send({
        consentType: "TELEMEDICINE_TREATMENT_CONSENT",
        policyVersion: "1.2",
      })
      .expect(201);
    assert.equal(consentRes.body.data.status, "GRANTED");
    assert.equal(consentRes.body.data.policyVersion, "1.2");

    // 2. Fetch Consent records
    const listRes = await request(app)
      .get("/api/v1/consent")
      .set("Authorization", patientAuth)
      .expect(200);
    assert.equal(listRes.body.data.length >= 1, true);

    // 3. Revoke Consent
    const revokeRes = await request(app)
      .post("/api/v1/consent/TELEMEDICINE_TREATMENT_CONSENT/revoke")
      .set("Authorization", patientAuth)
      .expect(200);
    assert.equal(revokeRes.body.data.revoked, true);

    // Verify status is REVOKED
    const revokedRecord = await prisma.consentRecord.findFirst({
      where: { patientId, consentType: "TELEMEDICINE_TREATMENT_CONSENT" },
    });
    assert.equal(revokedRecord.status, "REVOKED");
    assert.ok(revokedRecord.revokedAt);

    // 4. Notifications unread count and listing
    const notifs = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", patientAuth)
      .expect(200);
    assert.equal(notifs.body.unreadCount >= 1, true);

    // 5. Mark notification as read
    await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set("Authorization", patientAuth)
      .expect(200);

    const updatedNotif = await prisma.notification.findUnique({ where: { id: notificationId } });
    assert.ok(updatedNotif.readAt);

    // 6. Test metrics endpoint
    const metricsRes = await request(app).get("/metrics").expect(200);
    assert.ok(metricsRes.text.includes("http_requests_total"));
  } finally {
    await prisma.consentRecord.deleteMany({ where: { patientId } });
    await prisma.notification.deleteMany({ where: { userId: patientId } });
    await prisma.auditLog.deleteMany({ where: { actorId: patientId } });
    await prisma.user.deleteMany({ where: { id: patientId } });
  }
});
