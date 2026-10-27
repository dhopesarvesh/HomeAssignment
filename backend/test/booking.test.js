import test from "node:test";
import assert from "node:assert/strict";
import { createBookingService } from "../src/booking.js";

test("booking rejects a missing idempotency key before touching persistence", async () => {
  const service = createBookingService({});
  await assert.rejects(
    service.book({ actor: { id: "00000000-0000-4000-8000-000000000001" }, key: "", body: { slotId: "00000000-0000-4000-8000-000000000002" } }),
    { status: 400 },
  );
});
