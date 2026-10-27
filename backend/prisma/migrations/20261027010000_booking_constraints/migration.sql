CREATE UNIQUE INDEX "Appointment_one_active_booking_per_slot_key"
ON "Appointment" ("slotId")
WHERE "status" IN ('BOOKED', 'IN_PROGRESS');

ALTER TABLE "AvailabilitySlot"
ADD CONSTRAINT "AvailabilitySlot_valid_time_range"
CHECK ("endsAt" > "startsAt");

ALTER TABLE "DoctorProfile"
ADD CONSTRAINT "DoctorProfile_nonnegative_fee"
CHECK ("consultationFeeMinor" IS NULL OR "consultationFeeMinor" >= 0);
