---
title: "PostgreSQL Operations & Security — Interview Handbook"
description: "Running PostgreSQL safely in production: backups, PITR, roles, row-level security, authentication, connection pooling, and zero-downtime migrations."
sidebar:
  label: "Operations & Security"
---

> Senior and staff interviews move past "how do queries work" into "how do you run this safely."
> This page covers the operational essentials: backups and point-in-time recovery, access control
> and row-level security, authentication, and how to change a schema on a live system without
> taking it down.

---

## 1. Backup Strategy: Logical vs Physical

There are two fundamentally different ways to back up PostgreSQL. You must know when to use each.

| | Logical backup (`pg_dump`) | Physical backup (`pg_basebackup`) |
|---|---|---|
| **What it captures** | SQL statements to recreate data | Byte-for-byte copy of the data files |
| **Granularity** | A single table, schema, or database | The entire cluster (all databases) |
| **Restore target** | Any Postgres version, any platform | Same major version, same architecture |
| **Speed on large DBs** | Slow (re-runs every INSERT) | Fast (file copy) |
| **Enables PITR?** | No | Yes (with WAL archiving) |
| **Best for** | Migrations, version upgrades, single-table restore | Full-cluster DR, replicas, point-in-time recovery |

> **Senior answer:** "I use `pg_dump` for portability — migrations, version upgrades, grabbing one
> table. For production disaster recovery I use a physical base backup plus WAL archiving, because
> only that enables point-in-time recovery and restores fast on a multi-terabyte database."

---

## 2. Logical Backups with `pg_dump`

```bash
# Dump one database (custom format is compressed and allows selective restore)
pg_dump -Fc -h host -U user mydb > mydb.dump

# Dump a single table
pg_dump -Fc -t orders mydb > orders.dump

# Restore (custom format uses pg_restore)
pg_restore -d mydb --clean --if-exists mydb.dump

# Plain SQL dump (human-readable, restore with psql)
pg_dump mydb > mydb.sql
psql mydb < mydb.sql

# Whole cluster INCLUDING roles/permissions (pg_dump does NOT capture global objects)
pg_dumpall > everything.sql
```

> **Trap:** `pg_dump` backs up **data and schema but not roles, tablespaces, or other global
> objects**. To capture users and permissions you need `pg_dumpall --globals-only` (or full
> `pg_dumpall`). Forgetting this means restoring data with no users to own it.

> **Consistency note:** `pg_dump` takes a single **MVCC snapshot**, so the dump is internally
> consistent even while the database keeps serving writes — no downtime, no locking of writers.

---

## 3. Physical Backups & Point-in-Time Recovery (PITR)

PITR lets you restore the database to **any moment in time** — for example, "1 second before the
bad `DELETE` ran." It is the gold standard for production disaster recovery.

**How it works:** a physical base backup is your starting point, and the **WAL archive** is a
continuous log of every change since. To recover, Postgres restores the base backup and then
**replays WAL** forward, stopping at the exact moment you specify.

```
Base backup (Sunday 02:00)  +  WAL stream (every change since)  =  any point in time
        │                              │
        └──────────────────────────────┴──► replay up to "Monday 14:32:59" → stop
```

**Setup — enable WAL archiving on the primary:**
```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'  # ship each WAL file to safe storage
```

**Take the base backup:**
```bash
pg_basebackup -h primary -U replicator -D /backups/base -Ft -z -P
```

**Recover to a point in time:**
```ini
# In the restored data directory's postgresql.conf (PG 12+):
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2024-06-10 14:32:59'
```
```bash
# Create recovery.signal and start — Postgres replays WAL up to the target, then stops
touch /var/lib/postgresql/data/recovery.signal
pg_ctl start
```

> **Nice to know:** in production most teams don't script this by hand — they use **pgBackRest** or
> **Barman**, which manage base backups, WAL archiving, retention, compression, and PITR with one
> command. Naming these shows operational maturity.

### RPO and RTO — the two numbers that drive backup design

| Term | Means | Driven by |
|---|---|---|
| **RPO** (Recovery Point Objective) | How much data you can afford to lose | Backup/WAL-archive frequency |
| **RTO** (Recovery Time Objective) | How long you can afford to be down | Restore speed + automation |

> **Senior answer:** "Backup design is really RPO/RTO engineering. Continuous WAL archiving gives an
> RPO of seconds; a hot standby with automated failover gives an RTO of seconds. `pg_dump` alone
> means an RPO of a full day and an RTO measured in hours — fine for a small app, unacceptable for
> a payments system."

---

## 4. Roles & Privileges (access control)

In Postgres, **users and groups are the same thing — a role.** A role with `LOGIN` is a "user"; a
role without it is effectively a "group" you grant to other roles.

```sql
-- A login role (a "user")
CREATE ROLE app_user WITH LOGIN PASSWORD 'secret';

-- A group role (no login) that bundles permissions
CREATE ROLE readonly;
GRANT CONNECT ON DATABASE mydb TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;

-- Make future tables inherit the grant automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;

-- Assign the group's permissions to the user
GRANT readonly TO app_user;
```

**The principle of least privilege:** applications should connect as a role that can do exactly what
it needs and nothing more.

| Privilege | Allows |
|---|---|
| `CONNECT` | Connect to the database |
| `USAGE` (on schema) | "See" objects in the schema |
| `SELECT` / `INSERT` / `UPDATE` / `DELETE` | The obvious DML on a table |
| `SUPERUSER` | Bypass **all** permission checks — never give this to an app |

> **Trap:** granting `SELECT ON ALL TABLES` only covers tables that exist **right now**. New tables
> created later are not covered unless you also set `ALTER DEFAULT PRIVILEGES`. This is the #1 reason
> a read-only role mysteriously can't see a new table.

---

## 5. Row-Level Security (RLS) — multi-tenancy in the database

RLS lets the database itself enforce "a user can only see *their* rows" — instead of trusting every
query in your application to add `WHERE tenant_id = ?`. This is a staff-level feature for
multi-tenant SaaS.

```sql
-- 1. Turn RLS on for the table
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- 2. Define a policy: a row is visible only if it belongs to the current tenant
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.current_tenant')::int);

-- 3. The app sets the tenant per connection/transaction
SET app.current_tenant = '42';

-- Now this returns ONLY tenant 42's rows, even though no WHERE clause was written:
SELECT * FROM documents;
```

- **`USING`** controls which rows are **visible** (SELECT/UPDATE/DELETE).
- **`WITH CHECK`** controls which rows can be **written** (INSERT/UPDATE) — stops a tenant inserting
  rows owned by someone else.

> **Senior answer:** "RLS moves tenant isolation into the database, so a single forgotten `WHERE`
> in application code can't leak another customer's data. I pair it with a per-request
> `SET app.current_tenant` and `WITH CHECK` policies so tenants can neither read nor write across
> the boundary. Note that table owners and superusers bypass RLS unless you `FORCE ROW LEVEL
> SECURITY`."

---

## 6. Authentication & Connection Security

Authentication is controlled by **`pg_hba.conf`** (Host-Based Authentication) — rules matched
top-to-bottom by connection type, source IP, database, and user.

```
# TYPE  DATABASE  USER       ADDRESS          METHOD
host    all       all        10.0.0.0/8       scram-sha-256   # internal network
hostssl all       app_user   0.0.0.0/0        scram-sha-256   # external must use SSL
local   all       postgres                    peer            # OS-user match for local admin
```

| Method | Use |
|---|---|
| **`scram-sha-256`** | The modern password standard — always prefer it over `md5` |
| **`md5`** | Legacy password hashing — deprecated, upgrade away from it |
| **`peer`** | Trust the OS username (local Unix-socket connections only) |
| **`cert`** | Client TLS certificate authentication |
| **`trust`** | No authentication at all — **never** in production |

> **Trap:** the rules are matched **in order, first match wins**. A broad `trust` line near the top
> silently overrides stricter rules below it. Order matters as much as content.

Encrypt connections with TLS (`ssl = on` in `postgresql.conf` plus `hostssl` rules). For data at
rest, use disk-level encryption or a managed provider's encryption — Postgres has no built-in
transparent column encryption (use the `pgcrypto` extension for specific columns).

---

## 7. Connection Pooling

In Postgres, **every single user connection is a separate operating system process.** If your app
suddenly gets popular and 1,000 users connect directly at the same time, the server spawns 1,000
heavy processes — instantly maxing out RAM and CPU and crashing the database.

- **The Solution:** Never connect your backend directly to Postgres in production. Use a
  **Connection Pooler** (like **PgBouncer** or **Supavisor**) that sits between your app and Postgres.
- **How it works:** Your app opens many cheap connections to the pooler, which multiplexes them
  onto a small fixed set of real Postgres connections — keeping the database stable under any load.

**Framework pooling vs external pooler — not the same thing**

Many teams already use connection pooling inside their app framework (HikariCP, SQLAlchemy, etc.)
and assume that’s enough. It solves a different problem:

| | Framework pooling (HikariCP, Hibernate) | External pooler (PgBouncer, Supavisor) |
|---|---|---|
| **Lives** | Inside your app process | Separate process between app and Postgres |
| **Scope** | One app server only | All app servers combined |
| **Solves** | Cost of opening/closing a connection per request | Total connection count exploding as you scale horizontally |
| **Postgres sees** | Every app server’s connections individually | Only the pooler’s fixed set of connections |

```
WITHOUT external pooler:
App Server 1 (20 conns) ──┬
App Server 2 (20 conns) ──┤──→ Postgres (400 real OS processes → RAM exhausted, crashes)
App Server 3 (20 conns) ──┘  ... 20 servers × 20 conns = 400 connections

WITH external pooler:
App Server 1 (20 conns) ──┬
App Server 2 (20 conns) ──┤──→ PgBouncer ──→ Postgres (20 real OS processes → stable)
App Server 3 (20 conns) ──┘
```

In production use **both**: framework pooling inside each app server to avoid per-request overhead,
and PgBouncer in front to keep the total real connection count fixed regardless of how many app
servers you run.

**PgBouncer vs Supavisor — which one to pick**

| | PgBouncer | Supavisor |
|---|---|---|
| **Written in** | C | Elixir |
| **Maturity** | Since 2007, extremely battle-tested | Released 2023 by Supabase |
| **Architecture** | Single-threaded, single process | Multi-node, clustered by design |
| **Multi-tenancy** | Not built for it | Built specifically for it |
| **Pooling modes** | Session, Transaction, Statement | Session, Transaction |
| **Observability** | Minimal built-in | Better built-in metrics |
| **Best for** | Self-hosted Postgres, traditional setups | Multi-tenant SaaS, cloud-native, Supabase |

- **Use PgBouncer** if you run your own Postgres — the industry default, proven at massive scale.
- **Use Supavisor** if you are on Supabase or building a multi-tenant SaaS where PgBouncer becomes
  painful to manage.

> **Senior answer:** “Every Postgres connection is a real OS process, so I never let the app
> connect directly at scale. I put PgBouncer in front (fixed real-connection count regardless of
> app servers), and use framework pooling inside each app server to avoid per-request overhead.
> Supavisor replaces PgBouncer only for multi-tenant SaaS or Supabase.”

**Trap:** Relying on framework pooling alone. Once you run more than one app server, each one
maintains its own pool — Postgres sees them all, connection count multiplies, and you hit the
limit silently under traffic spikes.

---

## 8. Zero-Downtime Schema Migrations

The most dangerous operational task is changing the schema on a live, high-traffic table. The danger
is **locks**: a careless `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock and freezes every query
behind it.

| Operation | Naive version | Safe version |
|---|---|---|
| **Add a column** | `ADD COLUMN x int DEFAULT 0` | Safe since PG 11 — default is metadata-only, no rewrite |
| **Add an index** | `CREATE INDEX` (locks writes) | `CREATE INDEX CONCURRENTLY` (no write lock) |
| **Add NOT NULL** | `SET NOT NULL` (full scan under lock) | Add `CHECK (x IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT` |
| **Add a foreign key** | `ADD FOREIGN KEY` (locks both tables) | `ADD ... NOT VALID`, then `VALIDATE CONSTRAINT` (gentle lock) |

```sql
-- Safe foreign key: add it without validating existing rows (instant), then validate in the background
ALTER TABLE orders ADD CONSTRAINT fk_user
  FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;   -- fast, light lock
ALTER TABLE orders VALIDATE CONSTRAINT fk_user;            -- scans existing rows, does NOT block writes
```

**Always cap how long a migration will wait for its lock** so it can't pile up traffic behind it:
```sql
SET lock_timeout = '3s';   -- if the ALTER can't get its lock in 3s, it fails instead of blocking everything
ALTER TABLE orders ADD COLUMN note text;
```

> **Production trap (from the Handbook §6):** a slow `SELECT` blocks your `ALTER TABLE`, and every
> new query then queues behind the `ALTER`. Your whole app stalls. Always run migrations in a
> low-traffic window, set `lock_timeout`, and prefer the `CONCURRENTLY` / `NOT VALID` patterns above.

---

> **Interview questions for this topic** are in the central
> [Interview Q&A](/data-storage/postgresql/q-and-a/#operations--security) bank.

## Cheat Sheet

```bash
# Logical backup / restore
pg_dump -Fc mydb > mydb.dump            # one database (compressed)
pg_restore -d mydb --clean mydb.dump    # restore
pg_dumpall --globals-only > roles.sql   # roles & permissions (pg_dump skips these)

# Physical backup (foundation for PITR / replicas)
pg_basebackup -h primary -U replicator -D /backups/base -Ft -z -P
```

```sql
-- Roles & least privilege
CREATE ROLE app_user LOGIN PASSWORD 'secret';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;

-- Row-Level Security
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.current_tenant')::int);

-- Connection pooling (PgBouncer example config snippet)
-- pool_mode = transaction      -- most efficient for web apps
-- max_client_conn = 1000       -- app-facing connections
-- default_pool_size = 20       -- real Postgres connections

-- Safe migrations
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY idx ON t (col);
ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (x) REFERENCES y(id) NOT VALID;
ALTER TABLE t VALIDATE CONSTRAINT fk;
```

**The four rules:**
1. **`pg_dump` for portability, physical backup + WAL for disaster recovery** — only the latter gives PITR.
2. **Enforce isolation in the database** — least-privilege roles and RLS beat trusting every query.
3. **Put a connection pooler in front before launch** — every Postgres connection is a real OS process; PgBouncer keeps the count fixed.
4. **Migrate with `CONCURRENTLY`, `NOT VALID`, and `lock_timeout`** — never let a schema change freeze the app.
