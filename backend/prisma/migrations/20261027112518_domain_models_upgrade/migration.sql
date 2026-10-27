-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED');

-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'RESCHEDULED';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "cancellationReasonCategory" TEXT,
ADD COLUMN     "reasonForVisit" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rescheduledFromId" UUID;

-- AlterTable
ALTER TABLE "ConsultationNote" ADD COLUMN     "authorId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "DoctorProfile" ADD COLUMN     "consultationModes" TEXT NOT NULL DEFAULT 'ONLINE,IN_PERSON',
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "experienceYears" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "languages" TEXT NOT NULL DEFAULT 'English, Hindi',
ADD COLUMN     "qualifications" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "specialty" SET DEFAULT 'General Medicine';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Update';

-- AlterTable
ALTER TABLE "PatientProfile" ADD COLUMN     "emergencyContact" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "medicalHistorySummary" TEXT,
ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ISSUED';

-- AlterTable
ALTER TABLE "PrescriptionItem" ADD COLUMN     "frequency" TEXT NOT NULL DEFAULT 'Twice daily',
ADD COLUMN     "instructions" TEXT NOT NULL DEFAULT 'Take after meals',
ADD COLUMN     "route" TEXT NOT NULL DEFAULT 'Oral';

-- CreateTable
CREATE TABLE "Specialty" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorSpecialty" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "specialtyId" UUID NOT NULL,

    CONSTRAINT "DoctorSpecialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorCredential" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "credentialType" TEXT NOT NULL,
    "issuingAuthority" TEXT NOT NULL,
    "credentialReference" TEXT NOT NULL,
    "verificationStatus" "CredentialStatus" NOT NULL DEFAULT 'PENDING',
    "verificationTimestamp" TIMESTAMP(3),
    "reviewedByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "localTimeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "effectiveStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveEndDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorBlockedPeriod" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reasonCategory" TEXT NOT NULL DEFAULT 'PERSONAL_LEAVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorBlockedPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentStatusHistory" (
    "id" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "previousStatus" "AppointmentStatus" NOT NULL,
    "newStatus" "AppointmentStatus" NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationNoteHistory" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationNoteHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionAmendment" (
    "id" UUID NOT NULL,
    "prescriptionId" UUID NOT NULL,
    "previousVersion" INTEGER NOT NULL,
    "newVersion" INTEGER NOT NULL,
    "amendedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "consentType" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL DEFAULT '1.0',
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_name_key" ON "Specialty"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorSpecialty_doctorId_specialtyId_key" ON "DoctorSpecialty"("doctorId", "specialtyId");

-- CreateIndex
CREATE INDEX "DoctorCredential_doctorId_verificationStatus_idx" ON "DoctorCredential"("doctorId", "verificationStatus");

-- CreateIndex
CREATE INDEX "AvailabilityRule_doctorId_isActive_idx" ON "AvailabilityRule"("doctorId", "isActive");

-- CreateIndex
CREATE INDEX "DoctorBlockedPeriod_doctorId_startsAt_endsAt_idx" ON "DoctorBlockedPeriod"("doctorId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "AppointmentStatusHistory_appointmentId_timestamp_idx" ON "AppointmentStatusHistory"("appointmentId", "timestamp");

-- CreateIndex
CREATE INDEX "ConsultationNoteHistory_noteId_version_idx" ON "ConsultationNoteHistory"("noteId", "version");

-- CreateIndex
CREATE INDEX "PrescriptionAmendment_prescriptionId_timestamp_idx" ON "PrescriptionAmendment"("prescriptionId", "timestamp");

-- CreateIndex
CREATE INDEX "ConsentRecord_patientId_consentType_idx" ON "ConsentRecord"("patientId", "consentType");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DoctorSpecialty" ADD CONSTRAINT "DoctorSpecialty_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorSpecialty" ADD CONSTRAINT "DoctorSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCredential" ADD CONSTRAINT "DoctorCredential_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorBlockedPeriod" ADD CONSTRAINT "DoctorBlockedPeriod_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentStatusHistory" ADD CONSTRAINT "AppointmentStatusHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNoteHistory" ADD CONSTRAINT "ConsultationNoteHistory_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ConsultationNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionAmendment" ADD CONSTRAINT "PrescriptionAmendment_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
