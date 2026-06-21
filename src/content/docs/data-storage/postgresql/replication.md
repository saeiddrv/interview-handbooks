---
title: "PostgreSQL Replication & HA — Interview Handbook"
description: "PostgreSQL replication: streaming replication, logical replication, replication slots, failover, and high availability with Patroni."
sidebar:
  label: "Replication"
---

> Replication is how PostgreSQL achieves high availability, fault tolerance, and read scalability.
> Understanding the difference between streaming and logical replication — and knowing the traps
> around replication slots and failover — is a reliable senior interview signal.

---

## 1. What is Replication and Why Does It Matter?

Replication is the process of continuously copying data from one PostgreSQL server (the **primary**)
to one or more other servers (the **replicas** or **standbys**).

**Why you need it:**

| Goal | How replication helps |
|---|---|
| **High availability** | If the primary crashes, a standby can be promoted to take over |
| **Read scalability** | Route read-heavy queries (reports, analytics) to replicas |
| **Disaster recovery** | Keep a replica in a different data center or region |
| **Zero-downtime upgrades** | Promote a replica running the new version, then redirect traffic |

**The two types of replication in PostgreSQL:**

| | Streaming Replication | Logical Replication |
|---|---|---|
| **What is copied** | Raw WAL bytes (physical changes) | Logical changes (INSERT/UPDATE/DELETE) |
| **Replica must be** | Same Postgres major version | Can differ |
| **Replica is** | Exact byte-for-byte copy | Can have different schema/indexes |
| **Replica accepts** | Read-only queries only | Can accept writes (to other tables) |
| **Use case** | HA, read replicas, failover | Selective replication, upgrades, CDC |

---

## 2. Streaming Replication (Physical)

### 2.1 How It Works

Streaming replication works by shipping the **Write-Ahead Log (WAL)** from the primary to replicas
in real time.

```
Primary                          Standby
  │                                 │
  │  Every write goes to WAL first  │
  │  (INSERT/UPDATE/DELETE/DDL)     │
  │                                 │
  │──── WAL stream (TCP) ──────────►│
  │                                 │  Standby replays WAL
  │                                 │  continuously — stays
  │                                 │  in sync with primary
```

1. Every change on the primary is written to WAL before being applied to the data files
2. A **WAL sender process** on the primary streams WAL records to the standby
3. A **WAL receiver process** on the standby receives and replays them
4. The standby stays in a permanent recovery state — it applies WAL as fast as it arrives

### 2.2 Setting Up Streaming Replication

**On the primary** — allow the standby to connect:
```sql
-- Create a replication user
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'secret';
```

```ini
# postgresql.conf on primary
wal_level = replica          -- must be 'replica' or 'logical'
max_wal_senders = 5          -- max concurrent standby connections
wal_keep_size = 1024         -- keep 1 GB of WAL for lagging standbys (MB)
```

```
# pg_hba.conf on primary — allow the standby to connect
host  replication  replicator  192.168.1.101/32  scram-sha-256
```

**On the standby** — take a base backup and start replicating:
```bash
# Take a base backup from the primary (this is the starting point for the standby)
pg_basebackup -h primary_host -U replicator -D /var/lib/postgresql/data -P -Xs -R
# -R creates standby.signal and postgresql.auto.conf automatically
```

The standby starts, sees `standby.signal`, and enters recovery mode — streaming WAL from the primary.

### 2.3 Synchronous vs Asynchronous Replication

| | Asynchronous (default) | Synchronous |
|---|---|---|
| **Primary waits for standby?** | No | Yes — waits for standby to confirm WAL written |
| **Performance impact** | None | Adds latency to every write |
| **Data loss on primary crash** | Possible (last few transactions) | Zero — standby always has latest WAL |
| **Standby failure impact** | None | Primary write transactions stall until standby recovers |

```sql
-- Enable synchronous replication (on primary)
-- postgresql.conf:
synchronous_standby_names = 'standby1'  -- standby's application_name

-- Verify sync status
SELECT application_name, sync_state, write_lag, flush_lag, replay_lag
FROM pg_stat_replication;
```

> **Senior answer:** "I use asynchronous replication for most workloads — the performance cost of
> synchronous is too high. I only use synchronous when the business requirement is zero data loss
> on primary failure, and I accept that a standby outage will stall writes on the primary."

---

## 3. Read Replicas

A standby in streaming replication accepts read-only queries — making it a **read replica**.

```
Application
  │
  ├──── writes ────► Primary  (accepts all queries)
  │
  └──── reads  ────► Replica  (SELECT only)
```

```sql
-- On the standby, you can run read queries:
SELECT * FROM orders WHERE status = 'pending';  -- fine

-- Writes are rejected:
INSERT INTO orders ...;
-- ERROR:  cannot execute INSERT in a read-only transaction
```

**What to route to replicas:**
- Heavy reporting / analytics queries
- Search queries
- Dashboard data
- Any read that can tolerate slightly stale data (replication lag)

**What must stay on the primary:**
- All writes
- Reads that must see the very latest data (e.g. after a payment)

### 3.1 Replication Lag

The standby is always slightly behind the primary. Check how far behind:

```sql
-- On the primary: see lag for all connected standbys
SELECT
    application_name,
    write_lag,
    flush_lag,
    replay_lag,
    pg_size_pretty(pg_wal_lsn_diff(sent_lsn, replay_lsn)) AS lag_size
FROM pg_stat_replication;

-- On the standby itself:
SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;
```

---

## 4. Logical Replication

Logical replication copies changes at the **SQL level** (rows changed) rather than the raw WAL
bytes. This means the replica does not have to be identical to the primary.

### 4.1 How It Differs from Streaming

```
Streaming replication:
  Primary WAL: "page 42, offset 1024, bytes: 0xAF3C..."  ──► Standby applies raw bytes

Logical replication:
  Primary WAL decoded to: "UPDATE orders SET status='paid' WHERE id=1"  ──► Subscriber applies SQL
```

### 4.2 Use Cases

| Use case | Why logical replication fits |
|---|---|
| **Zero-downtime major version upgrade** | Run old and new version simultaneously, replicate, then switch |
| **Selective table replication** | Replicate only specific tables to another database |
| **Change Data Capture (CDC)** | Stream changes to Kafka, data warehouses, or event systems |
| **Multi-region active-active** | Replicate specific tables bidirectionally (with conflict handling) |

### 4.3 Setting Up Logical Replication

```ini
# postgresql.conf on publisher (source)
wal_level = logical
```

```sql
-- On the publisher: create a publication (what to share)
CREATE PUBLICATION orders_pub FOR TABLE orders, products;
-- Or share everything:
CREATE PUBLICATION all_tables_pub FOR ALL TABLES;

-- On the subscriber: create a subscription (connect and receive)
CREATE SUBSCRIPTION orders_sub
CONNECTION 'host=primary_host dbname=mydb user=replicator password=secret'
PUBLICATION orders_pub;

-- Check subscription status
SELECT subname, subenabled, subslotname FROM pg_subscription;

-- Check replication status on publisher
SELECT * FROM pg_replication_slots;
```

---

## 5. Replication Slots

A **replication slot** is a mechanism that ensures the primary keeps WAL around until the standby
has consumed it — even if the standby disconnects.

```sql
-- Create a physical replication slot (for streaming replication)
SELECT pg_create_physical_replication_slot('standby1_slot');

-- Create a logical replication slot (for logical replication)
SELECT pg_create_logical_replication_slot('my_slot', 'pgoutput');

-- View all slots and how far behind they are
SELECT slot_name, slot_type, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;
```

### 5.1 The Replication Slot Danger

This is one of the most common production disasters with PostgreSQL:

**If a standby with a replication slot goes offline and stays offline, the primary accumulates
WAL indefinitely — until the disk fills up and the primary crashes.**

```
Day 1: Standby goes offline (network issue, crash, forgotten)
Day 2: Primary keeps all WAL since Day 1 (slot prevents deletion)
Day 3: /var/lib/postgresql fills up
Day 4: Primary crashes — disk full, cannot write WAL — database goes down
```

```sql
-- Monitor retained WAL size for all slots (run this in production monitoring)
SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots
ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC;

-- Drop a slot that is no longer needed (safe when standby is decommissioned)
SELECT pg_drop_replication_slot('standby1_slot');
```

> **Production rule:** always monitor replication slot lag. Set up an alert when retained WAL
> exceeds a threshold (e.g. 10 GB). Drop slots for standbys that have been offline for more
> than a few hours.

---

## 6. Failover and Promotion

When the primary fails, a standby must be **promoted** to become the new primary.

### 6.1 Manual Failover

```bash
# On the standby — promote it to primary
pg_ctl promote -D /var/lib/postgresql/data

# Or using SQL (PG 12+):
SELECT pg_promote();
```

After promotion:
1. The standby stops replaying WAL and begins accepting writes
2. Update your application's connection string to point to the new primary
3. The old primary (if it recovers) must be reconfigured as a standby of the new primary

### 6.2 What Happens to the Old Primary

After a failover, the old primary has diverged from the new primary — it may have transactions
that were never replicated. You cannot just restart it and have it rejoin automatically.

**Options:**
1. **Re-clone it** — `pg_basebackup` from the new primary, start as a standby
2. **Use `pg_rewind`** — rewinds the old primary to the point where it diverged, faster than a full re-clone

```bash
# Rewind old primary to sync with new primary (much faster than pg_basebackup for large databases)
pg_rewind --target-pgdata=/var/lib/postgresql/data \
          --source-server='host=new_primary dbname=postgres'
```

---

## 7. High Availability with Patroni

Manual failover is error-prone and slow. In production, most teams use **Patroni** — an open-source
HA solution that automates failover for PostgreSQL.

### 7.1 What Patroni Does

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Primary    │    │  Standby 1  │    │  Standby 2  │
│  (Patroni)  │    │  (Patroni)  │    │  (Patroni)  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                   ┌──────▼──────┐
                   │    etcd /   │
                   │  ZooKeeper  │  ← distributed consensus store
                   │   / Consul  │    (decides who is primary)
                   └─────────────┘
```

- Each Patroni agent monitors its PostgreSQL instance and registers with the consensus store
- If the primary fails, Patroni uses the consensus store to elect a new primary (avoiding split-brain)
- The new primary is promoted automatically — typically in 10–30 seconds
- All other nodes reconfigure themselves as standbys of the new primary

### 7.2 Key Patroni Concepts

| Concept | Meaning |
|---|---|
| **Leader** | The current primary — holds a lease in the consensus store |
| **Lease TTL** | How long before a failed leader's lock expires (default: 30s) |
| **Failover** | Automatic promotion when leader lease expires |
| **Switchover** | Planned, manual promotion (zero data loss) |
| **Split-brain prevention** | Consensus store ensures only one leader at a time |

```bash
# Check cluster status
patronictl -c /etc/patroni.yml list

# Planned switchover (promote a specific replica)
patronictl -c /etc/patroni.yml switchover --master primary --candidate standby1

# Manual failover (emergency)
patronictl -c /etc/patroni.yml failover --master primary
```

---

## 8. Monitoring Replication

**Key metrics to monitor in production:**

```sql
-- 1. Replication lag on all standbys (run on primary)
SELECT application_name,
       state,
       sync_state,
       write_lag,
       flush_lag,
       replay_lag
FROM pg_stat_replication;

-- 2. Replication slot retained WAL (alert if > threshold)
SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;

-- 3. Lag on the standby itself
SELECT now() - pg_last_xact_replay_timestamp() AS lag;

-- 4. Is this server a primary or standby?
SELECT pg_is_in_recovery();  -- true = standby, false = primary
```

**Alerts to set up:**
- Replication lag > 30 seconds
- Replication slot retained WAL > 10 GB
- Standby disconnected (no entry in `pg_stat_replication`)

---

> **Interview questions for this topic** are in the central
> [Interview Q&A](/data-storage/postgresql/q-and-a/#replication) bank.

## Cheat Sheet

```sql
-- Check replication status (on primary)
SELECT application_name, state, sync_state, replay_lag
FROM pg_stat_replication;

-- Check replication lag (on standby)
SELECT now() - pg_last_xact_replay_timestamp() AS lag;

-- Is this a primary or standby?
SELECT pg_is_in_recovery();  -- true = standby

-- Monitor replication slots
SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;

-- Drop a slot (for decommissioned standbys)
SELECT pg_drop_replication_slot('slot_name');

-- Promote a standby to primary
SELECT pg_promote();

-- Create a publication (logical replication)
CREATE PUBLICATION my_pub FOR TABLE orders, products;

-- Create a subscription (logical replication)
CREATE SUBSCRIPTION my_sub
CONNECTION 'host=primary dbname=mydb user=replicator password=secret'
PUBLICATION my_pub;
```

**The three rules:**
1. **Always monitor replication slot lag** — an abandoned slot will fill your disk and crash the primary
2. **Use asynchronous replication by default** — synchronous kills write performance unless you need zero data loss
3. **Use Patroni in production** — manual failover is too slow and error-prone under pressure
