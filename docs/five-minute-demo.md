# Five-minute demonstration

1. Start the stack using the README and show the public verified-practitioner directory.
2. Register a synthetic patient and book the seeded UTC appointment slot.
3. Sign in as `doctor@example.test` / `Doctor-demo-42`, start the assigned consultation, add a synthetic note, issue a prescription, and complete it.
4. Sign back in as the patient to view their appointment and consultation records; another patient cannot access the prescription.
5. Sign in as `admin@example.test` / `Admin-demo-42` to view aggregate counts and audit metadata. The 20-request concurrency check is reproducible with `RUN_DB_INTEGRATION=1 npm test`.

Do not enter real health information; the current UI/API are a local functional MVP, not a medical service.
