import dotenv from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
dotenv.config({ path: resolve(backendDir, "../.env") });

export function validateConfig() {
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  if (!accessSecret || accessSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be configured with at least 32 characters");
  }
  if (!refreshSecret || refreshSecret.length < 32) {
    throw new Error("JWT_REFRESH_SECRET must be configured with at least 32 characters");
  }

  return {
    databaseUrl: process.env.DATABASE_URL,
    jwtAccessSecret: accessSecret,
    jwtRefreshSecret: refreshSecret,
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
    refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 14),
    port: Number(process.env.API_PORT || 3000),
    frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    nodeEnv: process.env.NODE_ENV || "development",
  };
}

export const config = validateConfig();
