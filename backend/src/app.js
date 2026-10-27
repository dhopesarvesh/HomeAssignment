import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticate, createAuth, requireRole } from "./auth.js";
import { createBookingService } from "./booking.js";
import { getPrometheusMetrics, recordHttpRequest } from "./metrics.js";

export function createApp(prisma) {
  const app = express();
  const logger = pino({
    level: process.env.NODE_ENV === "test" ? "silent" : "info",
    redact: [
      "req.headers.authorization",
      "req.body.password",
      "req.body.refreshToken",
      "req.body.content",
      "req.body.credentialReference",
    ],
  });

  const auth = createAuth(prisma);
  const booking = createBookingService(prisma);
  const api = express.Router();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: [
        process.env.FRONTEND_ORIGIN || "http://localhost:5174",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
      ],
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Correlation-ID"],
    }),
  );
  app.use(express.json({ limit: "32kb" }));

  // Correlation ID and metrics middleware
  app.use((req, res, next) => {
    const correlationId = req.headers["x-correlation-id"] || req.headers["x-request-id"] || randomUUID();
    req.id = correlationId;
    res.setHeader("X-Correlation-ID", correlationId);

    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      recordHttpRequest(req.method, req.baseUrl + req.path, res.statusCode, duration);
    });
    next();
  });

  app.use(pinoHttp({ logger, genReqId: (req) => req.id }));

  // Health and Observability
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ready" });
    } catch (error) {
      next(error);
    }
  });
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(getPrometheusMetrics());
  });

  // Global API rate limiter
  api.use(rateLimit({ windowMs: 60_000, limit: 150, standardHeaders: true, legacyHeaders: false }));

  // =========================================================================
  // 1. Authentication Endpoints
  // =========================================================================
  api.post("/auth/register", async (req, res, next) => {
    try {
      res.status(201).json(await auth.register(req.body));
    } catch (error) {
      next(error);
    }
  });

  api.post("/auth/login", rateLimit({ windowMs: 60_000, limit: 15 }), async (req, res, next) => {
    try {
      res.json(await auth.login(req.body));
    } catch (error) {
      next(error);
    }
  });

  api.post("/auth/refresh", async (req, res, next) => {
    try {
      res.json(await auth.refresh(req.body?.refreshToken));
    } catch (error) {
      next(error);
    }
  });

  api.post("/auth/logout", async (req, res, next) => {
    try {
      await auth.logout(req.body?.refreshToken);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // 2. Public Directory: Specialties & Doctors
  // =========================================================================
  api.get("/specialties", async (_req, res, next) => {
    try {
      const specialties = await prisma.specialty.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      });
      res.json({ data: specialties });
    } catch (error) {
      next(error);
    }
  });

  api.get("/doctors", async (req, res, next) => {
    try {
      const query = z
        .object({
          q: z.string().max(100).optional(),
          specialty: z.string().max(80).optional(),
          language: z.string().max(50).optional(),
          mode: z.enum(["ONLINE", "IN_PERSON", "ALL"]).optional().default("ALL"),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(req.query);

      const whereClause = {
        verified: true,
        user: {
          isActive: true,
          ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}),
        },
        ...(query.specialty
          ? {
              OR: [
                { specialty: { contains: query.specialty, mode: "insensitive" } },
                {
                  specialties: {
                    some: {
                      specialty: { name: { contains: query.specialty, mode: "insensitive" } },
                    },
                  },
                },
              ],
            }
          : {}),
        ...(query.language ? { languages: { contains: query.language, mode: "insensitive" } } : {}),
        ...(query.mode && query.mode !== "ALL" ? { consultationModes: { contains: query.mode } } : {}),
      };

      const [doctors, total] = await Promise.all([
        prisma.doctorProfile.findMany({
          where: whereClause,
          select: {
            id: true,
            specialty: true,
            bio: true,
            consultationFeeMinor: true,
            qualifications: true,
            experienceYears: true,
            languages: true,
            consultationModes: true,
            user: { select: { id: true, name: true } },
            specialties: { select: { specialty: { select: { id: true, name: true } } } },
          },
          orderBy: { user: { name: "asc" } },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.doctorProfile.count({ where: whereClause }),
      ]);

      res.json({
        data: doctors.map((doc) => ({
          ...doc,
          specialtyList: doc.specialties.map((s) => s.specialty.name),
        })),
        page: query.page,
        limit: query.limit,
        total,
      });
    } catch (error) {
      next(error);
    }
  });

  api.get("/doctors/:doctorId", async (req, res, next) => {
    try {
      const doctorId = z.string().uuid().parse(req.params.doctorId);
      const doctor = await prisma.doctorProfile.findUnique({
        where: { id: doctorId },
        select: {
          id: true,
          specialty: true,
          bio: true,
          consultationFeeMinor: true,
          qualifications: true,
          experienceYears: true,
          languages: true,
          consultationModes: true,
          verified: true,
          user: { select: { id: true, name: true, isActive: true } },
          specialties: { select: { specialty: { select: { id: true, name: true } } } },
          credentials: {
            where: { verificationStatus: "VERIFIED" },
            select: { credentialType: true, issuingAuthority: true },
          },
        },
      });

      if (!doctor || !doctor.verified || !doctor.user.isActive) {
        return res.status(404).json({ error: "Verified doctor profile not found" });
      }

      res.json({
        data: {
          ...doctor,
          specialtyList: doctor.specialties.map((s) => s.specialty.name),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  api.get("/doctors/:doctorId/slots", async (req, res, next) => {
    try {
      const doctorId = z.string().uuid().parse(req.params.doctorId);
      const slots = await prisma.availabilitySlot.findMany({
        where: {
          doctorId,
          status: "AVAILABLE",
          startsAt: { gt: new Date() },
          doctor: { verified: true, user: { isActive: true } },
        },
        select: { id: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: "asc" },
      });
      res.json({ data: slots });
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // Authenticated Routes
  // =========================================================================
  api.use(authenticate(prisma));

  // User Profile
  api.get("/users/me", async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          patientProfile: true,
          doctorProfile: { select: { id: true, verified: true, specialty: true } },
        },
      });
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  api.patch("/users/me", async (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          phone: z.string().trim().max(30).optional(),
          preferredLanguage: z.string().trim().max(50).optional(),
          gender: z.string().trim().max(20).optional(),
          emergencyContact: z.string().trim().max(100).optional(),
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);

      const user = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: req.user.id },
          data: { ...(input.name ? { name: input.name } : {}) },
          select: { id: true, email: true, name: true, role: true },
        });

        if (req.user.role === "PATIENT") {
          await tx.patientProfile.upsert({
            where: { userId: req.user.id },
            create: {
              userId: req.user.id,
              phone: input.phone || null,
              preferredLanguage: input.preferredLanguage || "en",
              gender: input.gender || null,
              emergencyContact: input.emergencyContact || null,
            },
            update: {
              ...(input.phone !== undefined ? { phone: input.phone } : {}),
              ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
              ...(input.gender !== undefined ? { gender: input.gender } : {}),
              ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact } : {}),
            },
          });
        }
        return updatedUser;
      });

      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // Patient Consent Records
  // =========================================================================
  api.get("/consent", async (req, res, next) => {
    try {
      if (req.user.role !== "PATIENT") return res.status(403).json({ error: "Patient role required" });
      const records = await prisma.consentRecord.findMany({
        where: { patientId: req.user.id },
        orderBy: { recordedAt: "desc" },
      });
      res.json({ data: records });
    } catch (error) {
      next(error);
    }
  });

  api.post("/consent", async (req, res, next) => {
    try {
      if (req.user.role !== "PATIENT") return res.status(403).json({ error: "Patient role required" });
      const input = z
        .object({
          consentType: z.enum([
            "TELEMEDICINE_TREATMENT_CONSENT",
            "DATA_PROCESSING_PRIVACY_NOTICE",
            "ELECTRONIC_HEALTH_RECORDS_CONSENT",
          ]),
          policyVersion: z.string().trim().default("1.0"),
        })
        .strict()
        .parse(req.body);

      const record = await prisma.consentRecord.create({
        data: {
          patientId: req.user.id,
          consentType: input.consentType,
          policyVersion: input.policyVersion,
          status: "GRANTED",
          metadata: { ipAddress: req.ip, userAgent: req.headers["user-agent"] },
        },
      });

      await prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: "consent.granted",
          resourceType: "consent_record",
          resourceId: record.id,
          outcome: "success",
          correlationId: String(req.id),
          metadata: { consentType: input.consentType, policyVersion: input.policyVersion },
        },
      });

      res.status(201).json({ data: record });
    } catch (error) {
      next(error);
    }
  });

  api.post("/consent/:consentType/revoke", async (req, res, next) => {
    try {
      if (req.user.role !== "PATIENT") return res.status(403).json({ error: "Patient role required" });
      const consentType = req.params.consentType;

      const record = await prisma.consentRecord.updateMany({
        where: { patientId: req.user.id, consentType, status: "GRANTED" },
        data: { status: "REVOKED", revokedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: "consent.revoked",
          resourceType: "consent_record",
          outcome: "success",
          correlationId: String(req.id),
          metadata: { consentType },
        },
      });

      res.json({ data: { revoked: record.count > 0 } });
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // In-App Notifications
  // =========================================================================
  api.get("/notifications", async (req, res, next) => {
    try {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          unreadOnly: z.coerce.boolean().optional(),
        })
        .parse(req.query);

      const notifications = await prisma.notification.findMany({
        where: {
          userId: req.user.id,
          ...(query.unreadOnly ? { readAt: null } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: query.limit,
      });

      const unreadCount = await prisma.notification.count({
        where: { userId: req.user.id, readAt: null },
      });

      res.json({ data: notifications, unreadCount });
    } catch (error) {
      next(error);
    }
  });

  api.patch("/notifications/:id/read", async (req, res, next) => {
    try {
      const notificationId = z.string().uuid().parse(req.params.id);
      const updated = await prisma.notification.updateMany({
        where: { id: notificationId, userId: req.user.id },
        data: { readAt: new Date() },
      });
      if (updated.count !== 1) return res.status(404).json({ error: "Notification not found" });
      res.json({ data: { id: notificationId, read: true } });
    } catch (error) {
      next(error);
    }
  });

  api.post("/notifications/mark-all-read", async (req, res, next) => {
    try {
      await prisma.notification.updateMany({
        where: { userId: req.user.id, readAt: null },
        data: { readAt: new Date() },
      });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // Doctor Profile, Credentials & Availability
  // =========================================================================
  api.get("/doctors/me", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const profile = await prisma.doctorProfile.findUnique({
        where: { userId: req.user.id },
        include: {
          specialties: { include: { specialty: true } },
          credentials: true,
          availabilityRules: { where: { isActive: true } },
          blockedPeriods: true,
        },
      });
      if (!profile) return res.status(404).json({ error: "Doctor profile not found" });
      res.json({ data: profile });
    } catch (error) {
      next(error);
    }
  });

  api.patch("/doctors/:doctorId", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const doctorId = z.string().uuid().parse(req.params.doctorId);
      const input = z
        .object({
          specialty: z.string().trim().min(1).max(80).optional(),
          bio: z.string().trim().max(2000).optional(),
          consultationFeeMinor: z.number().int().min(0).max(100000000).nullable().optional(),
          qualifications: z.string().trim().max(250).optional(),
          experienceYears: z.number().int().min(0).max(70).optional(),
          languages: z.string().trim().max(150).optional(),
          consultationModes: z.string().trim().max(100).optional(),
          specialtyIds: z.array(z.string().uuid()).optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0)
        .parse(req.body);

      const profile = await prisma.doctorProfile.findFirst({ where: { id: doctorId, userId: req.user.id } });
      if (!profile) return res.status(404).json({ error: "Doctor profile not found" });

      const updated = await prisma.$transaction(async (tx) => {
        const { specialtyIds, ...directFields } = input;
        const result = await tx.doctorProfile.update({
          where: { id: doctorId },
          data: directFields,
        });

        if (specialtyIds) {
          await tx.doctorSpecialty.deleteMany({ where: { doctorId } });
          if (specialtyIds.length > 0) {
            await tx.doctorSpecialty.createMany({
              data: specialtyIds.map((specialtyId) => ({ doctorId, specialtyId })),
            });
          }
        }

        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            action: "doctor.profile_updated",
            resourceType: "doctor",
            resourceId: doctorId,
            outcome: "success",
            correlationId: String(req.id),
          },
        });

        return result;
      });

      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  });

  api.post("/doctors/:doctorId/credentials", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const doctorId = z.string().uuid().parse(req.params.doctorId);
      const input = z
        .object({
          credentialType: z.string().trim().min(1).max(100),
          issuingAuthority: z.string().trim().min(1).max(150),
          credentialReference: z.string().trim().min(1).max(100),
        })
        .strict()
        .parse(req.body);

      const profile = await prisma.doctorProfile.findFirst({ where: { id: doctorId, userId: req.user.id } });
      if (!profile) return res.status(404).json({ error: "Doctor profile not found" });

      const credential = await prisma.doctorCredential.create({
        data: {
          doctorId,
          credentialType: input.credentialType,
          issuingAuthority: input.issuingAuthority,
          credentialReference: input.credentialReference,
          verificationStatus: "PENDING",
        },
      });

      await prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: "doctor.credential_submitted",
          resourceType: "doctor_credential",
          resourceId: credential.id,
          outcome: "success",
          correlationId: String(req.id),
        },
      });

      res.status(201).json({ data: credential });
    } catch (error) {
      next(error);
    }
  });

  // Doctor Availability Management
  api.post("/doctors/:doctorId/availability", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const doctorId = z.string().uuid().parse(req.params.doctorId);
      const input = z
        .object({
          startsAt: z.coerce.date(),
          endsAt: z.coerce.date(),
        })
        .strict()
        .parse(req.body);

      const duration = input.endsAt.getTime() - input.startsAt.getTime();
      if (input.startsAt <= new Date() || duration < 5 * 60_000 || duration > 4 * 60 * 60_000) {
        return res.status(400).json({ error: "Slot must be in the future and last between 5 minutes and 4 hours" });
      }

      const doctor = await prisma.doctorProfile.findFirst({
        where: { id: doctorId, userId: req.user.id, user: { isActive: true } },
      });
      if (!doctor) return res.status(404).json({ error: "Doctor profile not found" });

      const slot = await prisma.$transaction(
        async (tx) => {
          // Check for blocked periods
          const blocked = await tx.doctorBlockedPeriod.findFirst({
            where: {
              doctorId,
              startsAt: { lt: input.endsAt },
              endsAt: { gt: input.startsAt },
            },
          });
          if (blocked) {
            throw Object.assign(new Error("Time period is blocked for leave"), { status: 409 });
          }

          const overlap = await tx.availabilitySlot.findFirst({
            where: { doctorId, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
            select: { id: true },
          });
          if (overlap) throw Object.assign(new Error("Availability overlaps an existing slot"), { status: 409 });

          const created = await tx.availabilitySlot.create({ data: { doctorId, ...input } });
          await tx.auditLog.create({
            data: {
              actorId: req.user.id,
              action: "availability.created",
              resourceType: "availability_slot",
              resourceId: created.id,
              outcome: "success",
              correlationId: String(req.id),
            },
          });
          return created;
        },
        { isolationLevel: "Serializable" },
      );

      res.status(201).json({ data: slot });
    } catch (error) {
      next(error);
    }
  });

  // Availability Rules (Recurring Schedules)
  api.post("/doctors/:doctorId/rules", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const doctorId = z.string().uuid().parse(req.params.doctorId);
      const input = z
        .object({
          dayOfWeek: z.number().int().min(0).max(6),
          startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
          endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
          slotDurationMinutes: z.number().int().min(15).max(120).default(30),
        })
        .strict()
        .parse(req.body);

      const doctor = await prisma.doctorProfile.findFirst({ where: { id: doctorId, userId: req.user.id } });
      if (!doctor) return res.status(404).json({ error: "Doctor profile not found" });

      const rule = await prisma.availabilityRule.create({
        data: {
          doctorId,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
          slotDurationMinutes: input.slotDurationMinutes,
          localTimeZone: "Asia/Kolkata",
        },
      });

      res.status(201).json({ data: rule });
    } catch (error) {
      next(error);
    }
  });

  // Doctor Blocked Periods (Leave)
  api.post("/doctors/:doctorId/blocked-periods", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const doctorId = z.string().uuid().parse(req.params.doctorId);
      const input = z
        .object({
          startsAt: z.coerce.date(),
          endsAt: z.coerce.date(),
          reasonCategory: z.string().trim().max(100).default("PERSONAL_LEAVE"),
        })
        .strict()
        .parse(req.body);

      const doctor = await prisma.doctorProfile.findFirst({ where: { id: doctorId, userId: req.user.id } });
      if (!doctor) return res.status(404).json({ error: "Doctor profile not found" });

      const period = await prisma.$transaction(async (tx) => {
        // Block any unbooked available slots that fall within this window
        await tx.availabilitySlot.updateMany({
          where: {
            doctorId,
            status: "AVAILABLE",
            startsAt: { gte: input.startsAt },
            endsAt: { lte: input.endsAt },
          },
          data: { status: "BLOCKED" },
        });

        return await tx.doctorBlockedPeriod.create({
          data: {
            doctorId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            reasonCategory: input.reasonCategory,
            createdById: req.user.id,
          },
        });
      });

      res.status(201).json({ data: period });
    } catch (error) {
      next(error);
    }
  });

  api.patch("/availability/:slotId", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const slotId = z.string().uuid().parse(req.params.slotId);
      const input = z.object({ status: z.enum(["AVAILABLE", "BLOCKED"]) }).strict().parse(req.body);
      const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (!profile) return res.status(404).json({ error: "Doctor profile not found" });

      const changed = await prisma.availabilitySlot.updateMany({
        where: { id: slotId, doctorId: profile.id, status: { not: "BOOKED" } },
        data: { status: input.status },
      });
      if (changed.count !== 1) return res.status(404).json({ error: "Editable slot not found" });

      await prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: "availability.updated",
          resourceType: "availability_slot",
          resourceId: slotId,
          outcome: "success",
          correlationId: String(req.id),
        },
      });
      res.json({ data: { id: slotId, status: input.status } });
    } catch (error) {
      next(error);
    }
  });

  api.delete("/availability/:slotId", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const slotId = z.string().uuid().parse(req.params.slotId);
      const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (!profile) return res.status(404).json({ error: "Doctor profile not found" });

      const changed = await prisma.availabilitySlot.updateMany({
        where: { id: slotId, doctorId: profile.id, status: "AVAILABLE" },
        data: { status: "BLOCKED" },
      });
      if (changed.count !== 1) return res.status(404).json({ error: "Available slot not found" });

      await prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: "availability.blocked",
          resourceType: "availability_slot",
          resourceId: slotId,
          outcome: "success",
          correlationId: String(req.id),
        },
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // Appointments: Booking, Listing, Cancellation & Rescheduling
  // =========================================================================
  api.get("/appointments", async (req, res, next) => {
    try {
      if (req.user.role === "ADMIN") {
        return res.status(403).json({ error: "Use aggregate admin analytics; appointment details are restricted" });
      }

      const where = req.user.role === "PATIENT" ? { patientId: req.user.id } : { doctorId: req.user.id };
      const data = await prisma.appointment.findMany({
        where,
        include: {
          slot: { select: { startsAt: true, endsAt: true } },
          doctor: { select: { id: true, name: true } },
          patient: { select: { id: true, name: true } },
          consultation: { select: { id: true, startedAt: true, completedAt: true } },
          statusHistory: { orderBy: { timestamp: "desc" } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  api.post("/appointments", async (req, res, next) => {
    try {
      if (req.user.role !== "PATIENT") return res.status(403).json({ error: "Patient role required" });
      const { result, replay } = await booking.book({
        actor: req.user,
        key: req.get("Idempotency-Key"),
        body: req.body,
      });
      res.status(replay ? 200 : 201).json({ data: result, replay });
    } catch (error) {
      next(error);
    }
  });

  api.post("/appointments/:id/cancel", async (req, res, next) => {
    try {
      const appointmentId = z.string().uuid().parse(req.params.id);
      const reason = req.body?.reason;
      const result = await booking.cancel({
        appointmentId,
        actor: req.user,
        reason,
        correlationId: String(req.id),
      });
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  api.post("/appointments/:id/reschedule", async (req, res, next) => {
    try {
      if (req.user.role !== "PATIENT" && req.user.role !== "ADMIN") {
        return res.status(403).json({ error: "Patient or administrator role required" });
      }
      const appointmentId = z.string().uuid().parse(req.params.id);
      const updated = await booking.reschedule({
        appointmentId,
        actor: req.user,
        body: req.body,
        correlationId: String(req.id),
      });
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // Consultations & Clinical Records
  // =========================================================================
  api.get("/consultations", async (req, res, next) => {
    try {
      if (req.user.role === "ADMIN") {
        return res.status(403).json({ error: "Clinical records are not available through administration" });
      }

      const where =
        req.user.role === "PATIENT"
          ? { appointment: { patientId: req.user.id } }
          : { appointment: { doctorId: req.user.id } };

      res.json({
        data: await prisma.consultation.findMany({
          where: {
            ...where,
            appointment: { ...where.appointment, status: { in: ["BOOKED", "IN_PROGRESS", "COMPLETED"] } },
          },
          include: {
            appointment: {
              include: {
                slot: true,
                patient: { select: { name: true, id: true } },
                doctor: { select: { name: true, id: true } },
              },
            },
            note: {
              include: { amendments: { orderBy: { version: "desc" } } },
            },
            prescriptions: {
              include: {
                items: true,
                amendments: { orderBy: { timestamp: "desc" } },
              },
              orderBy: { version: "desc" },
            },
          },
          orderBy: { appointment: { createdAt: "desc" } },
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  api.post("/consultations/:consultationId/start", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const consultationId = z.string().uuid().parse(req.params.consultationId);
      const consultation = await prisma.consultation.findUnique({
        where: { id: consultationId },
        include: { appointment: true },
      });

      if (!consultation || consultation.appointment.doctorId !== req.user.id) {
        return res.status(404).json({ error: "Consultation not found" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const changed = await tx.appointment.updateMany({
          where: { id: consultation.appointmentId, status: "BOOKED" },
          data: { status: "IN_PROGRESS" },
        });

        if (changed.count !== 1) {
          throw Object.assign(new Error("Consultation cannot be started from its current state"), { status: 409 });
        }

        const updated = await tx.consultation.update({
          where: { id: consultationId },
          data: { startedAt: new Date() },
        });

        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: consultation.appointmentId,
            previousStatus: "BOOKED",
            newStatus: "IN_PROGRESS",
            actorId: req.user.id,
            reason: "Doctor started clinical consultation",
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            action: "consultation.started",
            resourceType: "consultation",
            resourceId: consultationId,
            outcome: "success",
            correlationId: String(req.id),
          },
        });

        await tx.notification.create({
          data: {
            userId: consultation.appointment.patientId,
            type: "CONSULTATION_STARTED",
            title: "Consultation Started",
            message: "Your doctor has started the consultation.",
          },
        });

        return updated;
      });

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  api.post("/consultations/:consultationId/complete", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const consultationId = z.string().uuid().parse(req.params.consultationId);
      const consultation = await prisma.consultation.findUnique({
        where: { id: consultationId },
        include: { appointment: true },
      });

      if (!consultation || consultation.appointment.doctorId !== req.user.id) {
        return res.status(404).json({ error: "Consultation not found" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const changed = await tx.appointment.updateMany({
          where: { id: consultation.appointmentId, status: "IN_PROGRESS" },
          data: { status: "COMPLETED" },
        });

        if (changed.count !== 1) {
          throw Object.assign(new Error("Consultation cannot be completed from its current state"), { status: 409 });
        }

        const updated = await tx.consultation.update({
          where: { id: consultationId },
          data: { completedAt: new Date() },
        });

        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: consultation.appointmentId,
            previousStatus: "IN_PROGRESS",
            newStatus: "COMPLETED",
            actorId: req.user.id,
            reason: "Doctor completed clinical consultation",
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            action: "consultation.completed",
            resourceType: "consultation",
            resourceId: consultationId,
            outcome: "success",
            correlationId: String(req.id),
          },
        });

        await tx.notification.create({
          data: {
            userId: consultation.appointment.patientId,
            type: "CONSULTATION_COMPLETED",
            title: "Consultation Completed",
            message: "Your consultation has been marked as completed. Records and prescriptions are now available.",
          },
        });

        return updated;
      });

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  // Clinical Notes with Versioning
  api.post("/consultations/:consultationId/notes", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const consultationId = z.string().uuid().parse(req.params.consultationId);
      const { content } = z.object({ content: z.string().trim().min(1).max(10000) }).strict().parse(req.body);

      const consultation = await prisma.consultation.findUnique({
        where: { id: consultationId },
        include: { appointment: true, note: true },
      });

      if (!consultation || consultation.appointment.doctorId !== req.user.id) {
        return res.status(404).json({ error: "Consultation not found" });
      }

      const note = await prisma.$transaction(async (tx) => {
        if (consultation.note) {
          // Archive prior note version in history
          await tx.consultationNoteHistory.create({
            data: {
              noteId: consultation.note.id,
              authorId: req.user.id,
              content: consultation.note.content,
              version: consultation.note.version,
            },
          });

          // Update current note with incremented version
          return await tx.consultationNote.update({
            where: { id: consultation.note.id },
            data: {
              content,
              authorId: req.user.id,
              version: consultation.note.version + 1,
            },
          });
        }

        // Create initial note
        return await tx.consultationNote.create({
          data: {
            consultationId,
            authorId: req.user.id,
            content,
            version: 1,
          },
        });
      });

      await prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: "consultation.note_saved",
          resourceType: "consultation",
          resourceId: consultationId,
          outcome: "success",
          correlationId: String(req.id),
          metadata: { noteVersion: note.version },
        },
      });

      res.status(201).json({ data: note });
    } catch (error) {
      next(error);
    }
  });

  // Prescriptions & Amendments
  api.post("/consultations/:consultationId/prescriptions", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const consultationId = z.string().uuid().parse(req.params.consultationId);
      const { items } = z
        .object({
          items: z
            .array(
              z
                .object({
                  name: z.string().trim().min(1).max(200),
                  dosage: z.string().trim().min(1).max(500),
                  frequency: z.string().trim().max(100).optional().default("Twice daily"),
                  duration: z.string().trim().min(1).max(120),
                  route: z.string().trim().max(100).optional().default("Oral"),
                  instructions: z.string().trim().max(500).optional().default("Take after meals"),
                })
                .strict(),
            )
            .min(1)
            .max(30),
        })
        .strict()
        .parse(req.body);

      const consultation = await prisma.consultation.findUnique({
        where: { id: consultationId },
        include: { appointment: true },
      });

      if (!consultation || consultation.appointment.doctorId !== req.user.id) {
        return res.status(404).json({ error: "Consultation not found" });
      }

      const prescription = await prisma.$transaction(
        async (tx) => {
          const latest = await tx.prescription.findFirst({
            where: { consultationId },
            orderBy: { version: "desc" },
          });

          const created = await tx.prescription.create({
            data: {
              consultationId,
              version: (latest?.version || 0) + 1,
              status: "ISSUED",
              items: { create: items },
            },
            include: { items: true },
          });

          await tx.auditLog.create({
            data: {
              actorId: req.user.id,
              action: "prescription.issued",
              resourceType: "prescription",
              resourceId: created.id,
              outcome: "success",
              correlationId: String(req.id),
            },
          });

          await tx.notification.create({
            data: {
              userId: consultation.appointment.patientId,
              type: "PRESCRIPTION_ISSUED",
              title: "Prescription Issued",
              message: `Your prescription (v${created.version}) has been issued by your doctor.`,
            },
          });

          return created;
        },
        { isolationLevel: "Serializable" },
      );

      res.status(201).json({ data: prescription });
    } catch (error) {
      next(error);
    }
  });

  api.get("/prescriptions/:prescriptionId", async (req, res, next) => {
    try {
      if (req.user.role === "ADMIN") {
        return res.status(403).json({ error: "Clinical records are not available through administration" });
      }

      const prescriptionId = z.string().uuid().parse(req.params.prescriptionId);
      const prescription = await prisma.prescription.findUnique({
        where: { id: prescriptionId },
        include: {
          items: true,
          amendments: true,
          consultation: { include: { appointment: true } },
        },
      });

      const authorized =
        prescription &&
        ((req.user.role === "PATIENT" && prescription.consultation.appointment.patientId === req.user.id) ||
          (req.user.role === "DOCTOR" && prescription.consultation.appointment.doctorId === req.user.id));

      if (!authorized) return res.status(404).json({ error: "Prescription not found" });
      res.json({ data: prescription });
    } catch (error) {
      next(error);
    }
  });

  api.post("/prescriptions/:prescriptionId/amendments", async (req, res, next) => {
    try {
      if (req.user.role !== "DOCTOR") return res.status(403).json({ error: "Doctor role required" });
      const prescriptionId = z.string().uuid().parse(req.params.prescriptionId);
      const { items, reason } = z
        .object({
          reason: z.string().trim().min(3).max(500).default("Clinical adjustment"),
          items: z
            .array(
              z
                .object({
                  name: z.string().trim().min(1).max(200),
                  dosage: z.string().trim().min(1).max(500),
                  frequency: z.string().trim().max(100).optional().default("Twice daily"),
                  duration: z.string().trim().min(1).max(120),
                  route: z.string().trim().max(100).optional().default("Oral"),
                  instructions: z.string().trim().max(500).optional().default("Take after meals"),
                })
                .strict(),
            )
            .min(1)
            .max(30),
        })
        .strict()
        .parse(req.body);

      const prescription = await prisma.prescription.findUnique({
        where: { id: prescriptionId },
        include: { consultation: { include: { appointment: true } } },
      });

      if (!prescription || prescription.consultation.appointment.doctorId !== req.user.id) {
        return res.status(404).json({ error: "Prescription not found" });
      }

      const amendment = await prisma.$transaction(
        async (tx) => {
          const latest = await tx.prescription.findFirst({
            where: { consultationId: prescription.consultationId },
            orderBy: { version: "desc" },
          });

          const newVersion = (latest?.version || 0) + 1;
          const created = await tx.prescription.create({
            data: {
              consultationId: prescription.consultationId,
              version: newVersion,
              status: "AMENDED",
              items: { create: items },
            },
            include: { items: true },
          });

          await tx.prescriptionAmendment.create({
            data: {
              prescriptionId: created.id,
              previousVersion: prescription.version,
              newVersion,
              amendedById: req.user.id,
              reason,
            },
          });

          await tx.auditLog.create({
            data: {
              actorId: req.user.id,
              action: "prescription.amended",
              resourceType: "prescription",
              resourceId: created.id,
              outcome: "success",
              correlationId: String(req.id),
              metadata: { priorVersion: prescription.version, reason },
            },
          });

          await tx.notification.create({
            data: {
              userId: prescription.consultation.appointment.patientId,
              type: "PRESCRIPTION_AMENDED",
              title: "Prescription Amended",
              message: `Your prescription has been updated to version ${newVersion} by your doctor.`,
            },
          });

          return created;
        },
        { isolationLevel: "Serializable" },
      );

      res.status(201).json({ data: amendment });
    } catch (error) {
      next(error);
    }
  });

  // =========================================================================
  // Administration Endpoints
  // =========================================================================
  api.get("/admin/analytics/overview", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });

      const [patients, activeDoctors, statusCounts, weekCounts, pendingVerifications, specialtyCounts] =
        await Promise.all([
          prisma.user.count({ where: { role: "PATIENT" } }),
          prisma.doctorProfile.count({ where: { verified: true, user: { isActive: true } } }),
          prisma.appointment.groupBy({ by: ["status"], _count: { _all: true } }),
          prisma.appointment.groupBy({
            by: ["status"],
            where: { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
            _count: { _all: true },
          }),
          prisma.doctorProfile.count({ where: { verified: false } }),
          prisma.specialty.count({ where: { isActive: true } }),
        ]);

      res.json({
        data: {
          patients,
          activeVerifiedDoctors: activeDoctors,
          pendingDoctorVerifications: pendingVerifications,
          specialties: specialtyCounts,
          appointmentsByStatus: statusCounts,
          appointmentsLastSevenDaysByStatus: weekCounts,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  api.get("/admin/analytics/appointments", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });
      const days = z.coerce.number().int().min(1).max(90).default(30).parse(req.query.days);
      const since = new Date(Date.now() - days * 86400000);

      const rows = await prisma.$queryRaw`
        SELECT date_trunc('day', "createdAt") AS day, "status", COUNT(*)::int AS count
        FROM "Appointment"
        WHERE "createdAt" >= ${since}
        GROUP BY date_trunc('day', "createdAt"), "status"
        ORDER BY day ASC
      `;
      res.json({ data: rows });
    } catch (error) {
      next(error);
    }
  });

  api.get("/admin/verification-queue", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });

      const pendingDoctors = await prisma.doctorProfile.findMany({
        where: { verified: false },
        include: {
          user: { select: { id: true, name: true, email: true, createdAt: true, isActive: true } },
          specialties: { include: { specialty: true } },
          credentials: true,
        },
        orderBy: { createdAt: "desc" },
      });

      res.json({ data: pendingDoctors });
    } catch (error) {
      next(error);
    }
  });

  api.post("/doctors/:doctorId/verify", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });
      const doctorId = z.string().uuid().parse(req.params.doctorId);
      const body = z
        .object({
          verified: z.boolean().default(true),
          notes: z.string().trim().max(500).optional(),
        })
        .parse(req.body || {});

      const profile = await prisma.doctorProfile.findUnique({
        where: { id: doctorId },
        include: { user: true },
      });
      if (!profile) return res.status(404).json({ error: "Doctor profile not found" });

      const verified = await prisma.$transaction(async (tx) => {
        const result = await tx.doctorProfile.update({
          where: { id: doctorId },
          data: { verified: body.verified },
        });

        // Mark pending credentials as verified if approving doctor
        if (body.verified) {
          await tx.doctorCredential.updateMany({
            where: { doctorId, verificationStatus: "PENDING" },
            data: {
              verificationStatus: "VERIFIED",
              verificationTimestamp: new Date(),
              reviewedByAdminId: req.user.id,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            action: body.verified ? "doctor.verified" : "doctor.rejected",
            resourceType: "doctor",
            resourceId: doctorId,
            outcome: "success",
            correlationId: String(req.id),
            metadata: { notes: body.notes },
          },
        });

        await tx.notification.create({
          data: {
            userId: profile.userId,
            type: body.verified ? "DOCTOR_VERIFIED" : "DOCTOR_REJECTED",
            title: body.verified ? "Profile Verified" : "Verification Status Update",
            message: body.verified
              ? "Congratulations! Your practitioner profile has been approved and you can now publish availability."
              : "Your practitioner verification application was not approved. Please contact clinical administration.",
          },
        });

        return result;
      });

      res.json({ data: verified });
    } catch (error) {
      next(error);
    }
  });

  api.patch("/admin/credentials/:credentialId", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });
      const credentialId = z.string().uuid().parse(req.params.credentialId);
      const input = z.object({ status: z.enum(["VERIFIED", "REJECTED"]) }).parse(req.body);

      const credential = await prisma.doctorCredential.update({
        where: { id: credentialId },
        data: {
          verificationStatus: input.status,
          verificationTimestamp: new Date(),
          reviewedByAdminId: req.user.id,
        },
      });

      await prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: "credential.reviewed",
          resourceType: "doctor_credential",
          resourceId: credentialId,
          outcome: "success",
          correlationId: String(req.id),
          metadata: { status: input.status },
        },
      });

      res.json({ data: credential });
    } catch (error) {
      next(error);
    }
  });

  api.get("/admin/users", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });
      const query = z
        .object({
          q: z.string().max(100).optional(),
          role: z.enum(["PATIENT", "DOCTOR", "ADMIN", "ALL"]).optional().default("ALL"),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(req.query);

      const whereClause = {
        ...(query.role !== "ALL" ? { role: query.role } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { email: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where: whereClause,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            createdAt: true,
            doctorProfile: { select: { verified: true, specialty: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.user.count({ where: whereClause }),
      ]);

      res.json({ data: users, page: query.page, limit: query.limit, total });
    } catch (error) {
      next(error);
    }
  });

  api.patch("/admin/users/:userId/status", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });
      const userId = z.string().uuid().parse(req.params.userId);
      const input = z.object({ isActive: z.boolean(), reason: z.string().trim().max(500).optional() }).parse(req.body);

      if (userId === req.user.id && !input.isActive) {
        return res.status(400).json({ error: "Cannot suspend your own administrator account" });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: userId },
          data: { isActive: input.isActive },
          select: { id: true, email: true, name: true, role: true, isActive: true },
        });

        // Revoke active sessions if suspending user
        if (!input.isActive) {
          await tx.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            action: input.isActive ? "user.activated" : "user.suspended",
            resourceType: "user",
            resourceId: userId,
            outcome: "success",
            correlationId: String(req.id),
            metadata: { reason: input.reason },
          },
        });

        return user;
      });

      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  });

  api.get("/admin/appointments", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });
      const query = z
        .object({
          status: z.enum(["BOOKED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "RESCHEDULED", "ALL"]).default("ALL"),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(req.query);

      const where = query.status !== "ALL" ? { status: query.status } : {};
      const [appointments, total] = await Promise.all([
        prisma.appointment.findMany({
          where,
          include: {
            slot: { select: { startsAt: true, endsAt: true } },
            doctor: { select: { id: true, name: true, email: true } },
            patient: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.appointment.count({ where }),
      ]);

      res.json({ data: appointments, page: query.page, limit: query.limit, total });
    } catch (error) {
      next(error);
    }
  });

  api.get("/admin/audit-logs", async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Administrator role required" });
      const { limit, page } = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          page: z.coerce.number().int().min(1).default(1),
        })
        .parse(req.query);

      const data = await prisma.auditLog.findMany({
        select: {
          id: true,
          actorId: true,
          action: true,
          resourceType: true,
          resourceId: true,
          outcome: true,
          correlationId: true,
          metadata: true,
          createdAt: true,
          actor: { select: { name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });

      res.json({ data, page, limit });
    } catch (error) {
      next(error);
    }
  });

  // Mount versioned API prefix
  app.use("/api/v1", api);

  // Centralized Error Handler
  app.use((error, req, res, _next) => {
    const status =
      error.status ||
      error.statusCode ||
      (error instanceof z.ZodError ? 400 : ["P2002", "P2034"].includes(error.code) ? 409 : 500);

    if (status >= 500) {
      req.log?.error({ errorType: error.name, errorCode: error.code, message: error.message }, "Request failed");
    }

    res.status(status).json({
      error: status === 500 ? "Internal server error" : error.message,
      correlationId: req.id,
      ...(error instanceof z.ZodError
        ? { details: error.issues.map(({ path, message }) => ({ path: path.join("."), message })) }
        : {}),
    });
  });

  return app;
}
