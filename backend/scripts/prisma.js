import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
dotenv.config({ path: resolve(backendDir, "../.env") });
const prismaCli = resolve(backendDir, "../node_modules/prisma/build/index.js");
const child = spawn(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (error) => {
  console.error("Could not start Prisma CLI", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
