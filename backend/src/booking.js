import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { recordBookingAttempt, recordBookingConflict, recordBookingSuccess, recordIdempotencyReplay } from "./metrics.js";

const createSchema = z.object({
  slotId: z.string().uuid(),
  mode: z.enum(["ONLINE", "IN_PERSON"]).default("ONLINE"),
  reasonForVisit: z.string().trim().max(1000).optional().default("General consultation"),
});

const rescheduleSchema = z.object({
  newSlotId: z.string().uuid(),
  reason: z.string().trim().max(500).optional().default("Patient requested reschedule"),
});

const fingerprint = (body) => createHash("sha256").update(JSON.stringify(body)).digest("hex");

export function createBookingService(prisma) {
  return {
    async book({ actor, key, body }) {
      if (!key || key.length > 200) {
        throw Object.assign(new Error("A valid Idempotency-Key header is required"), { status: 400 });
      }
      recordBookingAttempt();
      const input = createSchema.parse(body);
      const scope = "appointment.create";
      const requestFingerprint = fingerprint(input);

      const previous = await prisma.idempotencyRecord.findUnique({
        where: { actorId_key_scope: { actorId: actor.id, key, scope } },
      });

      if (previous) {
        if (previous.fingerprint !== requestFingerprint) {
          recordBookingConflict();
          throw Object.assign(new Error("Idempotency key was already used with a different request"), { status: 409 });
        }
        recordIdempotencyReplay();
        return { result: previous.response, replay: true };
      }

      try {
        const appointment = await prisma.$transaction(async (tx) => {
          // Atomic conditional update on slot status
          const slots = await tx.$queryRaw`
            UPDATE "AvailabilitySlot"
            SET "status" = 'BOOKED'
            WHERE "id" = ${input.slotId}::uuid AND "status" = 'AVAILABLE'
            RETURNING "id", "doctorId", "startsAt", "endsAt"
          `;

          if (slots.length !== 1) {
            recordBookingConflict();
            throw Object.assign(new Error("This slot is no longer available"), { status: 409 });
          }

          const slot = slots[0];
          if (new Date(slot.startsAt) <= new Date()) {
            throw Object.assign(new Error("Cannot book a slot in the past"), { status: 400 });
          }

          const doctor = await tx.doctorProfile.findUnique({
            where: { id: slot.doctorId },
            select: { userId: true, verified: true, user: { select: { isActive: true, name: true } } },
          });

          if (!doctor?.verified || !doctor.user.isActive) {
            throw Object.assign(new Error("Doctor is not available for bookings"), { status: 409 });
          }

          const created = await tx.appointment.create({
            data: {
              patientId: actor.id,
              doctorId: doctor.userId,
              slotId: input.slotId,
              mode: input.mode,
              reasonForVisit: input.reasonForVisit,
              statusHistory: {
                create: {
                  previousStatus: "BOOKED",
                  newStatus: "BOOKED",
                  actorId: actor.id,
                  reason: "Initial booking created",
                },
              },
            },
            include: {
              slot: { select: { startsAt: true, endsAt: true } },
              doctor: { select: { id: true, name: true } },
            },
          });

          await tx.consultation.create({ data: { appointmentId: created.id } });

          await tx.idempotencyRecord.create({
            data: {
              actorId: actor.id,
              key,
              scope,
              fingerprint: requestFingerprint,
              response: created,
              statusCode: 201,
            },
          });

          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: "appointment.booked",
              resourceType: "appointment",
              resourceId: created.id,
              outcome: "success",
              correlationId: key,
              metadata: { slotId: input.slotId, mode: input.mode },
            },
          });

          await tx.notification.create({
            data: {
              userId: actor.id,
              type: "APPOINTMENT_CONFIRMED",
              title: "Appointment Confirmed",
              message: `Your appointment with Dr. ${doctor.user.name} is confirmed for ${new Date(slot.startsAt).toLocaleString()}.`,
            },
          });

          await tx.notification.create({
            data: {
              userId: doctor.userId,
              type: "NEW_APPOINTMENT",
              title: "New Appointment Booked",
              message: `A patient has booked a consultation for ${new Date(slot.startsAt).toLocaleString()}.`,
            },
          });

          return created;
        }, { isolationLevel: "Serializable" });

        recordBookingSuccess();
        return { result: appointment, replay: false };
      } catch (error) {
        if (error.code === "P2034") {
          recordBookingConflict();
          const replay = await prisma.idempotencyRecord.findUnique({
            where: { actorId_key_scope: { actorId: actor.id, key, scope } },
          });
          if (replay && replay.fingerprint === requestFingerprint) {
            recordIdempotencyReplay();
            return { result: replay.response, replay: true };
          }
          if (!replay) throw Object.assign(new Error("Booking conflict; retry with a new request"), { status: 409 });
        }
        if (error.code === "P2002") {
          recordBookingConflict();
          const replay = await prisma.idempotencyRecord.findUnique({
            where: { actorId_key_scope: { actorId: actor.id, key, scope } },
          });
          if (replay && replay.fingerprint === requestFingerprint) {
            recordIdempotencyReplay();
            return { result: replay.response, replay: true };
          }
          if (replay) throw Object.assign(new Error("Idempotency key conflict"), { status: 409 });
        }
        throw error;
      }
    },

    async cancel({ appointmentId, actor, reason, correlationId = randomUUID() }) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { slot: true, doctor: { select: { id: true, name: true } }, patient: { select: { id: true, name: true } } },
      });

      const allowed = appointment && (
        actor.role === "ADMIN" ||
        (actor.role === "PATIENT" && appointment.patientId === actor.id) ||
        (actor.role === "DOCTOR" && appointment.doctorId === actor.id)
      );

      if (!allowed) throw Object.assign(new Error("Appointment not found"), { status: 404 });
      if (appointment.status !== "BOOKED" || appointment.slot.startsAt <= new Date()) {
        throw Object.assign(new Error("Appointment can no longer be cancelled"), { status: 409 });
      }

      return await prisma.$transaction(async (tx) => {
        const updated = await tx.appointment.updateMany({
          where: { id: appointment.id, status: "BOOKED" },
          data: {
            status: "CANCELLED",
            cancellationReasonCategory: reason || "Cancelled by user",
          },
        });

        if (updated.count !== 1) throw Object.assign(new Error("Appointment can no longer be cancelled"), { status: 409 });

        await tx.availabilitySlot.update({
          where: { id: appointment.slotId },
          data: { status: "AVAILABLE" },
        });

        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: appointment.id,
            previousStatus: "BOOKED",
            newStatus: "CANCELLED",
            actorId: actor.id,
            reason: reason || "Cancelled by user",
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: "appointment.cancelled",
            resourceType: "appointment",
            resourceId: appointment.id,
            outcome: "success",
            correlationId,
            metadata: { reason },
          },
        });

        const recipientId = actor.id === appointment.patientId ? appointment.doctorId : appointment.patientId;
        await tx.notification.create({
          data: {
            userId: recipientId,
            type: "APPOINTMENT_CANCELLED",
            title: "Appointment Cancelled",
            message: `The appointment scheduled for ${new Date(appointment.slot.startsAt).toLocaleString()} has been cancelled.`,
          },
        });

        return { id: appointment.id, status: "CANCELLED" };
      }, { isolationLevel: "Serializable" });
    },

    async reschedule({ appointmentId, actor, body, correlationId = randomUUID() }) {
      const input = rescheduleSchema.parse(body);

      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { slot: true, doctor: true },
      });

      const allowed = appointment && (
        actor.role === "ADMIN" ||
        (actor.role === "PATIENT" && appointment.patientId === actor.id)
      );

      if (!allowed) throw Object.assign(new Error("Appointment not found"), { status: 404 });
      if (appointment.status !== "BOOKED") {
        throw Object.assign(new Error("Only active booked appointments can be rescheduled"), { status: 409 });
      }
      if (appointment.slot.startsAt <= new Date()) {
        throw Object.assign(new Error("Cannot reschedule a past or ongoing appointment"), { status: 409 });
      }
      if (appointment.slotId === input.newSlotId) {
        throw Object.assign(new Error("New slot cannot be the same as current slot"), { status: 400 });
      }

      return await prisma.$transaction(async (tx) => {
        // 1. Atomically claim new slot
        const newSlots = await tx.$queryRaw`
          UPDATE "AvailabilitySlot"
          SET "status" = 'BOOKED'
          WHERE "id" = ${input.newSlotId}::uuid AND "status" = 'AVAILABLE'
          RETURNING "id", "doctorId", "startsAt", "endsAt"
        `;

        if (newSlots.length !== 1) {
          throw Object.assign(new Error("The selected new slot is no longer available"), { status: 409 });
        }

        const newSlot = newSlots[0];
        if (new Date(newSlot.startsAt) <= new Date()) {
          throw Object.assign(new Error("Selected slot must be in the future"), { status: 400 });
        }

        // Verify the new slot belongs to the same doctor
        const docProfile = await tx.doctorProfile.findUnique({
          where: { id: newSlot.doctorId },
          select: { userId: true },
        });

        if (docProfile?.userId !== appointment.doctorId) {
          throw Object.assign(new Error("New slot must be with the same doctor"), { status: 400 });
        }

        // 2. Release previous slot back to AVAILABLE
        await tx.availabilitySlot.update({
          where: { id: appointment.slotId },
          data: { status: "AVAILABLE" },
        });

        // 3. Update appointment
        const updated = await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            slotId: input.newSlotId,
            rescheduledFromId: appointment.slotId,
            status: "BOOKED",
          },
          include: {
            slot: { select: { startsAt: true, endsAt: true } },
            doctor: { select: { id: true, name: true } },
          },
        });

        // 4. Record history & audit
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: appointment.id,
            previousStatus: "BOOKED",
            newStatus: "RESCHEDULED",
            actorId: actor.id,
            reason: input.reason,
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: "appointment.rescheduled",
            resourceType: "appointment",
            resourceId: appointment.id,
            outcome: "success",
            correlationId,
            metadata: {
              previousSlotId: appointment.slotId,
              newSlotId: input.newSlotId,
              reason: input.reason,
            },
          },
        });

        // 5. Notifications
        await tx.notification.create({
          data: {
            userId: actor.id,
            type: "APPOINTMENT_RESCHEDULED",
            title: "Appointment Rescheduled",
            message: `Your appointment with Dr. ${updated.doctor.name} has been rescheduled to ${new Date(newSlot.startsAt).toLocaleString()}.`,
          },
        });

        await tx.notification.create({
          data: {
            userId: appointment.doctorId,
            type: "APPOINTMENT_RESCHEDULED",
            title: "Appointment Rescheduled",
            message: `An appointment was rescheduled to ${new Date(newSlot.startsAt).toLocaleString()}.`,
          },
        });

        return updated;
      }, { isolationLevel: "Serializable" });
    },
  };
}
