import { createApp } from "./app.js";
import { prisma } from "./db.js";

const port = Number(process.env.API_PORT || 3000);
const server = createApp(prisma).listen(port, () => console.log(`API listening on ${port}`));

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
