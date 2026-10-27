# Backup and Disaster Recovery (BDR) Plan

## 1. Objectives & RPO / RTO Targets

- **Recovery Point Objective (RPO):** < 15 minutes (maximum acceptable data loss).
- **Recovery Time Objective (RTO):** < 30 minutes (maximum acceptable service downtime).

---

## 2. Backup Strategy

### 2.1 Daily Automated Snapshots
PostgreSQL database dumps are executed daily during off-peak hours using `pg_dump`:
```bash
pg_dump -h localhost -p 5433 -U telemedicine -d telemedicine -Fc -f "/backups/telemedicine_$(date +%Y%m%d_%H%M%S).dump"
```

### 2.2 Continuous Write-Ahead Log (WAL) Archiving
For production deployment, PostgreSQL WAL archiving is enabled with AWS S3 / Cloud Storage sync to support Point-in-Time Recovery (PITR) down to the second.

---

## 3. Disaster Recovery Procedures

### 3.1 Database Restoration
To restore the database from a compressed backup file:
```bash
# 1. Terminate active connections
psql -h localhost -p 5433 -U telemedicine -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'telemedicine' AND pid <> pg_backend_pid();"

# 2. Recreate target database
dropdb -h localhost -p 5433 -U telemedicine telemedicine
createdb -h localhost -p 5433 -U telemedicine telemedicine

# 3. Restore snapshot
pg_restore -h localhost -p 5433 -U telemedicine -d telemedicine -v "/backups/telemedicine_target.dump"

# 4. Verify database schema and run seed if required
npm run db:deploy -w backend
```

### 3.2 Local Development Database Reset
To reset the local database from scratch to a clean, deterministic demonstration state:
```bash
npm run prisma -- migrate reset --force -w backend
npm run db:seed -w backend
```
