import argon2 from "argon2";
import { prisma } from "../src/db.js";

const demoDoctorEmail = process.env.DEMO_DOCTOR_EMAIL || "doctor@example.test";
const demoDoctorPassword = process.env.DEMO_DOCTOR_PASSWORD || "Doctor-demo-42";
const demoAdminEmail = process.env.DEMO_ADMIN_EMAIL || "admin@example.test";
const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD || "Admin-demo-42";
const demoPatientEmail = "patient@example.test";
const demoPatientPassword = "Patient-demo-42";

const pendingDoctorEmail = "dr.rajesh@example.test";
const pendingDoctorPassword = "Doctor-demo-42";

async function main() {
  console.log("Seeding database with deterministic healthcare demonstration dataset...");

  // 1. Seed Standard Specialties
  const specialtiesData = [
    { name: "Ayurveda", description: "Traditional holistic healing and herbal medicine" },
    { name: "Panchakarma", description: "Detoxification, rejuvenation, and cellular purification therapies" },
    { name: "Kayachikitsa", description: "Internal medicine and constitutional balance" },
    { name: "Dravyaguna", description: "Ayurvedic pharmacology and therapeutic botanical medicine" },
    { name: "Yoga & Lifestyle", description: "Mind-body therapies, pranayama, and circadian wellness" },
    { name: "Diet & Nutrition", description: "Ahara science and personalized dietary regimens" },
  ];

  const specialties = {};
  for (const item of specialtiesData) {
    const record = await prisma.specialty.upsert({
      where: { name: item.name },
      update: { description: item.description, isActive: true },
      create: { name: item.name, description: item.description, isActive: true },
    });
    specialties[item.name] = record;
  }
  console.log(`Seeded ${Object.keys(specialties).length} specialties.`);

  // 2. Seed Administrator
  const adminPasswordHash = await argon2.hash(demoAdminPassword);
  const admin = await prisma.user.upsert({
    where: { email: demoAdminEmail },
    update: { passwordHash: adminPasswordHash, isActive: true },
    create: {
      email: demoAdminEmail,
      passwordHash: adminPasswordHash,
      name: "CarePath Clinical Administrator",
      role: "ADMIN",
      isActive: true,
    },
  });
  console.log(`Seeded administrator: ${admin.email}`);

  // 3. Seed Verified Doctor (Dr. Anaya Sharma)
  const doctorPasswordHash = await argon2.hash(demoDoctorPassword);
  const doctor = await prisma.user.upsert({
    where: { email: demoDoctorEmail },
    update: { passwordHash: doctorPasswordHash, isActive: true },
    create: {
      email: demoDoctorEmail,
      passwordHash: doctorPasswordHash,
      name: "Dr. Anaya Sharma",
      role: "DOCTOR",
      isActive: true,
      doctorProfile: {
        create: {
          specialty: "Ayurveda",
          bio: "Senior Ayurvedic Physician with 14 years of clinical practice in constitutional diagnosis, metabolic health, and herbal therapies.",
          consultationFeeMinor: 75000, // ₹750
          verified: true,
          qualifications: "BAMS (Gold Medalist), MD (Ayurveda - Kayachikitsa)",
          experienceYears: 14,
          languages: "English, Hindi, Sanskrit",
          consultationModes: "ONLINE,IN_PERSON",
        },
      },
    },
    include: { doctorProfile: true },
  });

  // Ensure Doctor Profile exists and link specialties
  let docProfile = doctor.doctorProfile;
  if (!docProfile) {
    docProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        specialty: "Ayurveda",
        bio: "Senior Ayurvedic Physician with 14 years of clinical practice in constitutional diagnosis, metabolic health, and herbal therapies.",
        consultationFeeMinor: 75000,
        verified: true,
        qualifications: "BAMS (Gold Medalist), MD (Ayurveda - Kayachikitsa)",
        experienceYears: 14,
        languages: "English, Hindi, Sanskrit",
        consultationModes: "ONLINE,IN_PERSON",
      },
    });
  }

  // Link specialties for Dr. Anaya
  await prisma.doctorSpecialty.deleteMany({ where: { doctorId: docProfile.id } });
  await prisma.doctorSpecialty.createMany({
    data: [
      { doctorId: docProfile.id, specialtyId: specialties["Ayurveda"].id },
      { doctorId: docProfile.id, specialtyId: specialties["Kayachikitsa"].id },
      { doctorId: docProfile.id, specialtyId: specialties["Diet & Nutrition"].id },
    ],
  });

  // Add credentials for Dr. Anaya
  await prisma.doctorCredential.deleteMany({ where: { doctorId: docProfile.id } });
  await prisma.doctorCredential.createMany({
    data: [
      {
        doctorId: docProfile.id,
        credentialType: "MEDICAL_COUNCIL_REGISTRATION",
        issuingAuthority: "Central Council of Indian Medicine (CCIM)",
        credentialReference: "CCIM-AYUR-2012-44910",
        verificationStatus: "VERIFIED",
        verificationTimestamp: new Date(),
        reviewedByAdminId: admin.id,
      },
      {
        doctorId: docProfile.id,
        credentialType: "POSTGRADUATE_DEGREE",
        issuingAuthority: "National Institute of Ayurveda, Jaipur",
        credentialReference: "MD-KAYA-2015-882",
        verificationStatus: "VERIFIED",
        verificationTimestamp: new Date(),
        reviewedByAdminId: admin.id,
      },
    ],
  });

  // 4. Seed Pending Doctor (Dr. Rajesh Varma) for Admin Review Queue
  const pendingPasswordHash = await argon2.hash(pendingDoctorPassword);
  const pendingDoc = await prisma.user.upsert({
    where: { email: pendingDoctorEmail },
    update: { passwordHash: pendingPasswordHash, isActive: true },
    create: {
      email: pendingDoctorEmail,
      passwordHash: pendingPasswordHash,
      name: "Dr. Rajesh Varma",
      role: "DOCTOR",
      isActive: true,
      doctorProfile: {
        create: {
          specialty: "Panchakarma",
          bio: "Specialist in detox therapy, joint disorders, and chronic inflammatory relief.",
          consultationFeeMinor: 60000, // ₹600
          verified: false, // PENDING VERIFICATION
          qualifications: "BAMS, Fellowship in Panchakarma (Kerala)",
          experienceYears: 8,
          languages: "English, Malayalam, Hindi",
          consultationModes: "ONLINE",
        },
      },
    },
    include: { doctorProfile: true },
  });

  let pendingProfile = pendingDoc.doctorProfile;
  if (!pendingProfile) {
    pendingProfile = await prisma.doctorProfile.create({
      data: {
        userId: pendingDoc.id,
        specialty: "Panchakarma",
        bio: "Specialist in detox therapy, joint disorders, and chronic inflammatory relief.",
        consultationFeeMinor: 60000,
        verified: false,
        qualifications: "BAMS, Fellowship in Panchakarma (Kerala)",
        experienceYears: 8,
        languages: "English, Malayalam, Hindi",
        consultationModes: "ONLINE",
      },
    });
  }

  await prisma.doctorSpecialty.deleteMany({ where: { doctorId: pendingProfile.id } });
  await prisma.doctorSpecialty.createMany({
    data: [
      { doctorId: pendingProfile.id, specialtyId: specialties["Panchakarma"].id },
    ],
  });

  await prisma.doctorCredential.deleteMany({ where: { doctorId: pendingProfile.id } });
  await prisma.doctorCredential.create({
    data: {
      doctorId: pendingProfile.id,
      credentialType: "STATE_AYURVEDIC_LICENSE",
      issuingAuthority: "Travancore-Cochin Medical Council",
      credentialReference: "TCMC-AY-2018-01928",
      verificationStatus: "PENDING",
    },
  });
  console.log(`Seeded pending doctor for verification queue: ${pendingDoc.email}`);

  // 5. Seed Patient (Rahul Verma)
  const patientPasswordHash = await argon2.hash(demoPatientPassword);
  const patient = await prisma.user.upsert({
    where: { email: demoPatientEmail },
    update: { passwordHash: patientPasswordHash, isActive: true },
    create: {
      email: demoPatientEmail,
      passwordHash: patientPasswordHash,
      name: "Rahul Verma",
      role: "PATIENT",
      isActive: true,
      patientProfile: {
        create: {
          phone: "+91 98765 43210",
          birthDate: new Date("1992-05-14T00:00:00.000Z"),
          preferredLanguage: "English",
          gender: "Male",
          emergencyContact: "+91 98765 43211 (Spouse)",
          medicalHistorySummary: "Seasonal allergies, mild digestive Pitta imbalance",
        },
      },
    },
    include: { patientProfile: true },
  });

  // Seed Patient Consent Records
  await prisma.consentRecord.deleteMany({ where: { patientId: patient.id } });
  await prisma.consentRecord.createMany({
    data: [
      {
        patientId: patient.id,
        consentType: "TELEMEDICINE_TREATMENT_CONSENT",
        policyVersion: "1.0",
        status: "GRANTED",
        recordedAt: new Date(Date.now() - 7 * 86400000),
      },
      {
        patientId: patient.id,
        consentType: "DATA_PROCESSING_PRIVACY_NOTICE",
        policyVersion: "1.0",
        status: "GRANTED",
        recordedAt: new Date(Date.now() - 7 * 86400000),
      },
    ],
  });
  console.log(`Seeded patient with consent records: ${patient.email}`);

  // 6. Seed Availability Slots for Dr. Anaya
  const baseDate = new Date();
  baseDate.setMinutes(0, 0, 0);

  // Generate slots for tomorrow and day after
  const slotTimestamps = [
    { dayOffset: 1, hour: 10, minute: 0 },
    { dayOffset: 1, hour: 11, minute: 0 },
    { dayOffset: 1, hour: 14, minute: 0 },
    { dayOffset: 1, hour: 15, minute: 0 },
    { dayOffset: 2, hour: 10, minute: 0 },
    { dayOffset: 2, hour: 11, minute: 30 },
    { dayOffset: 2, hour: 16, minute: 0 },
    { dayOffset: 3, hour: 9, minute: 30 },
    { dayOffset: 3, hour: 11, minute: 0 },
  ];

  for (const s of slotTimestamps) {
    const startsAt = new Date(baseDate);
    startsAt.setDate(startsAt.getDate() + s.dayOffset);
    startsAt.setHours(s.hour, s.minute, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

    await prisma.availabilitySlot.upsert({
      where: { doctorId_startsAt: { doctorId: docProfile.id, startsAt } },
      update: { endsAt, status: "AVAILABLE" },
      create: { doctorId: docProfile.id, startsAt, endsAt, status: "AVAILABLE" },
    });
  }

  // 7. Seed Availability Rules for Dr. Anaya
  await prisma.availabilityRule.deleteMany({ where: { doctorId: docProfile.id } });
  await prisma.availabilityRule.createMany({
    data: [
      {
        doctorId: docProfile.id,
        dayOfWeek: 1, // Monday
        startTime: "09:30",
        endTime: "16:30",
        slotDurationMinutes: 30,
        localTimeZone: "Asia/Kolkata",
        isActive: true,
      },
      {
        doctorId: docProfile.id,
        dayOfWeek: 3, // Wednesday
        startTime: "10:00",
        endTime: "17:00",
        slotDurationMinutes: 30,
        localTimeZone: "Asia/Kolkata",
        isActive: true,
      },
      {
        doctorId: docProfile.id,
        dayOfWeek: 5, // Friday
        startTime: "09:00",
        endTime: "15:00",
        slotDurationMinutes: 30,
        localTimeZone: "Asia/Kolkata",
        isActive: true,
      },
    ],
  });

  // 8. Seed a Completed Past Appointment with Consultation, Note, and Prescription
  const pastSlotStartsAt = new Date(Date.now() - 3 * 86400000);
  pastSlotStartsAt.setHours(11, 0, 0, 0);
  const pastSlotEndsAt = new Date(pastSlotStartsAt.getTime() + 30 * 60 * 1000);

  const pastSlot = await prisma.availabilitySlot.upsert({
    where: { doctorId_startsAt: { doctorId: docProfile.id, startsAt: pastSlotStartsAt } },
    update: { status: "BOOKED" },
    create: { doctorId: docProfile.id, startsAt: pastSlotStartsAt, endsAt: pastSlotEndsAt, status: "BOOKED" },
  });

  const existingPastAppointment = await prisma.appointment.findFirst({
    where: { slotId: pastSlot.id },
  });

  if (!existingPastAppointment) {
    const pastAppt = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        slotId: pastSlot.id,
        status: "COMPLETED",
        mode: "ONLINE",
        reasonForVisit: "Chronic indigestion (Agnimandya) and sleep fatigue",
        statusHistory: {
          createMany: {
            data: [
              { previousStatus: "BOOKED", newStatus: "IN_PROGRESS", actorId: doctor.id, reason: "Consultation initiated" },
              { previousStatus: "IN_PROGRESS", newStatus: "COMPLETED", actorId: doctor.id, reason: "Consultation concluded" },
            ],
          },
        },
      },
    });

    const consult = await prisma.consultation.create({
      data: {
        appointmentId: pastAppt.id,
        startedAt: pastSlotStartsAt,
        completedAt: pastSlotEndsAt,
      },
    });

    await prisma.consultationNote.create({
      data: {
        consultationId: consult.id,
        authorId: doctor.id,
        content: "Patient presents with Mandagni and Pitta-Vata aggravation. Tongue shows mild Ama coating. Advised light Ahara (Moong dal kitchari) and evening Triphala churna. Follow-up recommended in 3 weeks.",
        version: 1,
      },
    });

    await prisma.prescription.create({
      data: {
        consultationId: consult.id,
        version: 1,
        status: "ISSUED",
        items: {
          create: [
            {
              name: "Amrutam Agkey Churna",
              dosage: "1 teaspoon (3g)",
              frequency: "Twice daily",
              duration: "21 days",
              route: "Oral with lukewarm water",
              instructions: "30 minutes after meals",
            },
            {
              name: "Amrutam Brahmi Vati",
              dosage: "1 tablet (250mg)",
              frequency: "Once daily at bedtime",
              duration: "30 days",
              route: "Oral with warm milk",
              instructions: "Promotes restful sleep and nervous system balance",
            },
          ],
        },
      },
    });

    await prisma.notification.createMany({
      data: [
        {
          userId: patient.id,
          type: "PRESCRIPTION_ISSUED",
          title: "Prescription Available",
          message: "Dr. Anaya Sharma has issued your prescription for consultation # " + pastAppt.id.slice(0, 8),
          createdAt: new Date(pastSlotEndsAt.getTime() + 60000),
        },
        {
          userId: patient.id,
          type: "APPOINTMENT_COMPLETED",
          title: "Consultation Completed",
          message: "Your consultation with Dr. Anaya Sharma is completed.",
          createdAt: pastSlotEndsAt,
        },
      ],
    });
  }

  // 9. Seed System Audit Logs
  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: "system.seeded",
      resourceType: "database",
      resourceId: null,
      outcome: "success",
      correlationId: "seed-" + Date.now(),
      metadata: { environment: "development", seededAt: new Date().toISOString() },
    },
  });

  console.log("Database seed completed successfully.");
}

main()
  .catch((err) => {
    console.error("Seed error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
