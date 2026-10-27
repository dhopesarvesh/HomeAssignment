import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
  preferredLanguage: z.string().trim().max(50).optional().default("en"),
  gender: z.string().trim().max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

function secrets() {
  if (
    !process.env.JWT_ACCESS_SECRET ||
    process.env.JWT_ACCESS_SECRET.length < 32 ||
    !process.env.JWT_REFRESH_SECRET ||
    process.env.JWT_REFRESH_SECRET.length < 32
  ) {
    throw new Error("JWT secrets must each be configured with at least 32 characters");
  }
  return [process.env.JWT_ACCESS_SECRET, process.env.JWT_REFRESH_SECRET];
}

const digest = (token, secret) => createHmac("sha256", secret).update(token).digest("hex");

export function createAuth(prisma) {
  async function tokensFor(user) {
    const [accessSecret, refreshSecret] = secrets();
    const accessToken = jwt.sign({ sub: user.id, role: user.role }, accessSecret, {
      expiresIn: process.env.ACCESS_TOKEN_TTL || "15m",
    });
    const refreshToken = randomBytes(48).toString("base64url");
    const days = Number(process.env.REFRESH_TOKEN_DAYS || 14);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: digest(refreshToken, refreshSecret),
        expiresAt: new Date(Date.now() + days * 86400000),
      },
    });

    return { accessToken, refreshToken };
  }

  return {
    async register(body) {
      const input = registerSchema.parse(body);
      secrets();

      const user = await prisma.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash: await argon2.hash(input.password),
          role: "PATIENT", // Public registration strictly enforces PATIENT role
          patientProfile: {
            create: {
              phone: input.phone || null,
              preferredLanguage: input.preferredLanguage || "en",
              gender: input.gender || null,
            },
          },
        },
        select: { id: true, email: true, name: true, role: true },
      });

      // Automatically create baseline consent records for new patient
      await prisma.consentRecord.createMany({
        data: [
          {
            patientId: user.id,
            consentType: "TELEMEDICINE_TREATMENT_CONSENT",
            policyVersion: "1.0",
            status: "GRANTED",
          },
          {
            patientId: user.id,
            consentType: "DATA_PROCESSING_PRIVACY_NOTICE",
            policyVersion: "1.0",
            status: "GRANTED",
          },
        ],
      });

      return { user, ...(await tokensFor(user)) };
    },

    async login(body) {
      const input = loginSchema.parse(body);
      const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });

      if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, input.password))) {
        throw Object.assign(new Error("Invalid email or password"), { status: 401 });
      }

      const { passwordHash: _, ...safeUser } = user;
      return { user: safeUser, ...(await tokensFor(user)) };
    },

    async refresh(token) {
      if (!token) throw Object.assign(new Error("Refresh token required"), { status: 401 });
      const [accessSecret, refreshSecret] = secrets();
      const old = await prisma.refreshToken.findUnique({
        where: { tokenHash: digest(token, refreshSecret) },
        include: { user: true },
      });

      if (!old || old.revokedAt || old.expiresAt <= new Date() || !old.user.isActive) {
        throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
      }

      const accessToken = jwt.sign({ sub: old.user.id, role: old.user.role }, accessSecret, {
        expiresIn: process.env.ACCESS_TOKEN_TTL || "15m",
      });
      const refreshToken = randomBytes(48).toString("base64url");
      const days = Number(process.env.REFRESH_TOKEN_DAYS || 14);

      await prisma.$transaction(async (tx) => {
        const revoked = await tx.refreshToken.updateMany({
          where: { id: old.id, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { revokedAt: new Date() },
        });

        if (revoked.count !== 1) throw Object.assign(new Error("Invalid refresh token"), { status: 401 });

        await tx.refreshToken.create({
          data: {
            userId: old.userId,
            tokenHash: digest(refreshToken, refreshSecret),
            expiresAt: new Date(Date.now() + days * 86400000),
          },
        });
      });

      return { accessToken, refreshToken };
    },

    async logout(token) {
      if (token) {
        const [, refreshSecret] = secrets();
        await prisma.refreshToken.updateMany({
          where: { tokenHash: digest(token, refreshSecret), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    },

    async revokeAllUserSessions(userId) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
}

export function authenticate(prisma) {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ error: "Authentication required" });

      const [accessSecret] = secrets();
      const payload = jwt.verify(token, accessSecret);

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });

      if (!user?.isActive) return res.status(401).json({ error: "Invalid authentication" });

      req.user = user;
      next();
    } catch (error) {
      if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Invalid authentication" });
      }
      next(error);
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `${roles.join(" or ")} role required` });
    }
    next();
  };
}
