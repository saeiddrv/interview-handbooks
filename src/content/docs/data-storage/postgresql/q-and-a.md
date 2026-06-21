---
title: "PostgreSQL Interview Q&A Bank — Interview Handbook"
description: "Senior-level PostgreSQL Q&A bank: MVCC, indexing, transactions, isolation, locking, partitioning, performance, replication, and operations."
sidebar:
  label: "Interview Q&A"
---

> The single Q&A bank for the whole PostgreSQL handbook. Each question names the **trap** candidates
> fall into and the **high-signal answer** that gets you the offer, grouped by theme. The deep-dive
> pages ([Transactions](/data-storage/postgresql/transactions/),
> [Performance](/data-storage/postgresql/performance/),
> [Replication](/data-storage/postgresql/replication/),
> [Operations](/data-storage/postgresql/operations/)) carry the full explanations; this page is where
> all the questions live.

---

## Internals & MVCC

### The "hidden" data bloat (MVCC & Vacuum)
**Question:** "You have a table with 10 million rows. You run an `UPDATE` that changes a single boolean
flag column from false to true across all 10 million rows. What happens to the physical size of the
database on disk immediately after that query completes? How does MVCC factor into this?"

**The Trap:** Candidates often think an `UPDATE` modifies data in place, so the size shouldn't change.

**The Answer:** The table size on disk will **roughly double instantly.** Because of MVCC, Postgres
does not modify rows in place - an `UPDATE` is a `DELETE` followed by an `INSERT`. Postgres marks all
10 million old rows as "dead tuples" (invisible to new transactions but still occupying disk) and
writes 10 million brand-new versions. The disk space won't be freed until **VACUUM** runs, and even
then standard VACUUM only marks that space as **reusable for future Postgres data** - it doesn't
return the space to your operating system.

### The unused index trap (HOT Updates)
**Question:** "You added a B-Tree index to a highly updated column to speed up queries, but write
performance slowed drastically. However, indexing a rarely-updated column barely changed write speeds.
Why do updates on indexed columns hurt performance so much more in Postgres?"

**The Trap:** Assuming all indexes add the same write overhead.

**The Answer:** It comes down to **HOT (Heap-Only Tuples)** optimization. When you update a row and
the indexed column **doesn't change**, Postgres can often store the new row on the same data page and
have the old row point directly to it - the index doesn't need to change (a **HOT update**). But if
you update a column that **is indexed**, Postgres cannot use HOT. It is forced to create a brand-new
entry in **every single index** on that table, pointing to the new row location - causing massive
write amplification and index bloat.

### Is the WAL a redo log or an undo log?
**Answer:** "The Write-Ahead Log records every change **before** it's applied to the data files -
that's the durability guarantee: on a crash, Postgres replays committed WAL records to redo any work
that hadn't reached the data files. It's a **redo** log because uncommitted work never needs undoing -
MVCC keeps those changes as separate row versions that are simply invisible and later cleaned up by
VACUUM. So the WAL redoes committed changes; MVCC handles 'undoing' uncommitted ones for free."

### VACUUM vs VACUUM FULL vs autovacuum
**Answer:** "Plain **VACUUM** marks dead tuples as reusable space *inside* the table and refreshes
visibility info - it runs online without blocking. It does **not** return space to the OS. **VACUUM
FULL** rewrites the entire table to physically shrink it and return disk to the OS, but it takes an
`ACCESS EXCLUSIVE` lock (full downtime on that table) - in production I'd use `pg_repack` instead.
**Autovacuum** is the background process that runs plain VACUUM and ANALYZE automatically based on
dead-tuple thresholds. I never disable it - I tune `autovacuum_vacuum_scale_factor` per table."

### What is transaction ID wraparound and why is it dangerous?
**Answer:** "Postgres tags every row version with a 32-bit transaction ID. Because IDs wrap around at
~4 billion, VACUUM must 'freeze' old rows to mark them as permanently visible. If autovacuum falls so
far behind that the database approaches the wraparound limit, Postgres forces emergency vacuuming and,
at the very edge, **stops accepting writes** to prevent old data from appearing to come from the
future. It's the one failure mode that can take a database fully offline, which is exactly why
disabling autovacuum is dangerous."

### Why should you never disable autovacuum?
**Answer:** "Autovacuum removes dead tuples left by MVCC (every UPDATE and DELETE leaves a dead row).
Without it, tables bloat and queries slow down. More critically, autovacuum prevents **transaction ID
wraparound** - PostgreSQL uses 32-bit transaction IDs and when they near the limit (2 billion
transactions), Postgres forces a `VACUUM FREEZE` and will eventually refuse all writes to prevent
data corruption. Disabling autovacuum risks taking the database offline. Instead of disabling it,
tune `autovacuum_vacuum_scale_factor` per table."

### What is TOAST?
**Answer:** "TOAST (The Oversized-Attribute Storage Technique) is how Postgres stores values too big
for an 8 KB page - large `text`, `jsonb`, `bytea`. It transparently compresses them and/or moves them
to a separate TOAST table, leaving a pointer in the main row. The senior insight: a row with a huge
TOASTed column is cheap to scan when you don't select that column, because the heap row stays small -
but `SELECT *` on wide TOASTed columns forces extra fetches."

---

## Indexing

### The BRIN index vs. B-Tree choice
**Question:** "You have a logs table that grows by 50 GB every day. Data is inserted in chronological
order by a `created_at` timestamp. Most queries look for data within specific date ranges. Why is a
standard B-Tree a poor choice, and what should you use instead?"

**The Trap:** Automatically reaching for a standard B-Tree for every query requirement.

**The Answer:** Use a **BRIN (Block Range Index).** Because the log data is inserted in physical order
of time, a BRIN index doesn't map individual rows - it stores the **minimum and maximum timestamp for
each block** of data (e.g., every 1MB). When querying for a date, Postgres checks the BRIN map to see
which blocks could contain that date and skips the rest. A BRIN index is **up to 99% smaller** than a
B-Tree, saving gigabytes of memory while maintaining near-identical search speed for sequential data.

### UPDATE bloat — why, and how to mitigate
**Answer:** "Because of MVCC, Postgres treats an `UPDATE` as a `DELETE` followed by an `INSERT`. It
leaves the old row on disk as a dead tuple and writes a brand-new row. If the updated column has an
index, Postgres is forced to create new entries in **every single index** on that table, pointing to
the new row location. This leads to heavy disk and index bloat. To mitigate this, we optimize for
**HOT (Heap-Only Tuples) Updates.** If we ensure our update avoids changing indexed columns, and we
leave sufficient empty space on the data page using a tuned **`fillfactor`** setting (e.g., 85-90%),
Postgres places the new row version on the same physical page and uses an internal pointer. This
completely bypasses the index update step and eliminates index bloat."

### Index exists but Postgres uses a Sequential Scan — why?
**Answer:** "There are three primary reasons:
1. **Data Distribution Statistics:** The Cost-Based Optimizer determines the filter matches a very
   high percentage of the table's data (typically over 20-30%). In that case, sequential multi-block
   reads are physically faster than hopping between an index file and data blocks.
2. **Stale Table Statistics:** The table experienced high write churn but planner statistics weren't
   updated. Running manual `ANALYZE` corrects this.
3. **Functional Index Mismatch:** The query modifies the column inline (e.g.,
   `WHERE LOWER(email) = 'user@email.com'`), invalidating a standard index on `(email)`. We must build
   a functional index: `CREATE INDEX ON users (LOWER(email));`."

### What is an Index-Only Scan and what does it require?
**Answer:** "An Index-Only Scan answers a query entirely from the index, never visiting the heap. It
requires that every column the query needs is in the index - either as a key column or via the
`INCLUDE` clause (a covering index) - **and** that the table's visibility map shows the pages are
all-visible, which depends on VACUUM having run. That second condition surprises people: a freshly
bulk-loaded table won't get index-only scans until it's been vacuumed."

### Does column order in a composite index matter?
**Answer:** "Yes, hugely. A composite index on `(a, b)` can serve `WHERE a = ?`, `WHERE a = ? AND
b = ?`, and `ORDER BY a, b` - but **not** `WHERE b = ?` alone, because of the leftmost-prefix rule.
The guidance: put equality-filter columns first and the range/sort column last. So for
`WHERE user_id = ? ORDER BY created_at`, index `(user_id, created_at)`, not the reverse."

### When would you reach for a partial index?
**Answer:** "When my queries always target a small, well-defined subset of a large table - like
`WHERE status = 'pending'` where pending is 1% of rows. A partial index only indexes those rows, so
it's tiny, cheaper to maintain, and faster to scan. The rule of thumb is the subset should be under
roughly 10-15% of the table; indexing a value that covers 90% of rows gains nothing over a full
index."

### Why can a random UUIDv4 primary key hurt write performance?
**Answer:** "UUIDv4 values are fully random, so each insert lands at a random position in the B-Tree.
That scatters writes across many pages, causes constant page splits, and trashes cache locality -
write amplification and index bloat. A time-sortable ID like **UUIDv7** (native in PG 18) or a
bigint identity appends to the right edge of the tree, keeping inserts sequential and the index
compact. I default to UUIDv7 when I need globally unique IDs."

---

## Data Types & JSON

### JSON vs. JSONB performance
**Question:** "Postgres supports both `JSON` and `JSONB`. If a developer says they want plain `JSON`
because it makes data insertion significantly faster, are they right? What architectural trade-off are
they making?"

**The Trap:** Thinking text-based JSON is always worse than binary JSONB.

**The Answer:** The developer is technically correct about **writes**, but wrong about **reads**.
- **Plain `JSON`** stores an exact text copy of what you input. Postgres doesn't parse it on write -
  it just checks the syntax is valid. So inserting is faster. **But** every time you query a key
  inside it, Postgres re-parses the entire text string from scratch - incredibly slow - and you
  **cannot index individual keys.**
- **`JSONB`** decomposes the JSON into a binary format on write. It takes a little more CPU to insert,
  but reads are lightning-fast because Postgres jumps straight to the key without parsing text.
  Crucially, JSONB supports **GIN indexing**, letting you index keys inside the object. For 99% of
  production apps, **JSONB is the correct choice.**

---

## Transactions & Concurrency

### What is a Deadlock, how does Postgres resolve it, and how do you prevent it?
**Answer:** "A deadlock occurs when Transaction 1 holds a lock on Row A and requests a lock on Row B,
while Transaction 2 concurrently holds a lock on Row B and requests a lock on Row A. Neither can
proceed. Postgres handles this via an internal **deadlock detection timer** (defaulting to 1 second).
When triggered, it analyzes the lock matrix, intentionally aborts one of the transactions to clear the
logjam, and rolls its changes back. To prevent deadlocks, the codebase must enforce a **strict,
uniform resource allocation order** - for example, always sort target resource IDs in code and lock
them sequentially from lowest to highest ID. If both transactions attempt to lock Row A first, one
simply waits in a clean queue behind the other rather than trapping each other."

### How do you build a job queue in plain SQL without workers grabbing the same job?
**Answer:** `SELECT ... FOR UPDATE SKIP LOCKED`. Each worker selects the next pending job with
`FOR UPDATE` to lock it, and `SKIP LOCKED` makes it ignore rows other workers already hold instead of
waiting. So N workers pull N different jobs with no blocking and no double-processing - a robust queue
without Redis or a broker:
```sql
SELECT * FROM jobs WHERE status = 'pending'
ORDER BY created_at LIMIT 1
FOR UPDATE SKIP LOCKED;
```

**Q: What is the default isolation level in PostgreSQL, and what can still go wrong at it?**

> Read Committed. Each statement sees a fresh snapshot of committed data, so within one transaction
> you can get non-repeatable reads and phantom reads, and naive read-modify-write in the application
> can cause lost updates. It never allows dirty reads. For simple deltas I avoid the lost-update
> problem with an atomic `SET x = x + n`; for multi-step logic I use `SELECT ... FOR UPDATE`.

**Q: How does Postgres's Repeatable Read differ from the SQL standard?**

> The SQL standard allows phantom reads at Repeatable Read. Postgres is stricter - it implements
> Repeatable Read as full snapshot isolation, so the entire transaction sees one frozen snapshot and
> phantoms are prevented too. The trade-off is that a write conflict raises a 40001 serialization
> failure that the app must retry.

**Q: What is write skew and which level prevents it?**

> Write skew is when two transactions each read overlapping data, each make a change that's valid in
> isolation, but together they violate an invariant - like two doctors both going off-call because
> each saw the other still on call. Only Serializable prevents it. Postgres uses SSI, which tracks
> read/write dependencies and aborts one transaction with a 40001 when it detects a dangerous cycle.

**Q: Why must you write a retry loop when using Serializable?**

> Serializable (and Repeatable Read) are optimistic. Instead of blocking, Postgres lets transactions
> proceed on their snapshots and then aborts one with `serialization_failure` (40001) if committing
> both would be non-serializable. That aborted transaction did nothing wrong - it just lost the race
> - so the correct response is to retry it with backoff. Without the retry loop you surface random
> errors to users.

### A SELECT is blocking my ALTER TABLE and now everything is frozen. Why?
**Answer:** "`ALTER TABLE` needs an `ACCESS EXCLUSIVE` lock, which conflicts with everything - even a
plain SELECT's `ACCESS SHARE` lock. So a slow 30-second report holds the ALTER in the queue, and
every new query then queues **behind** the ALTER, stalling the whole app. The fix is to run schema
changes in low-traffic windows and always set `lock_timeout` so the ALTER fails fast instead of
piling up traffic behind it."

---

## Performance

**Q: A query was fast yesterday and slow today. What do you check first?**

> First I check `pg_stat_statements` to confirm the query and get its average execution time. Then
> I run `EXPLAIN (ANALYZE, BUFFERS)` and look for: (1) a plan change - did it switch from Index
> Scan to Seq Scan? (2) row count mismatch between estimated and actual - if so, statistics are
> stale and I run `ANALYZE`. (3) I check `pg_stat_user_tables` for dead tuple buildup - autovacuum
> may have fallen behind on a high-write table.

**Q: What is `work_mem` and why is it dangerous to set it too high?**

> `work_mem` is the memory allocated for each sort or hash operation. The danger is that it is
> per-operation per-connection - not global. With 50 connections each running a query with 2 sorts,
> Postgres could use `50 × 2 × work_mem` of RAM simultaneously. Setting it to 1 GB would consume
> 100 GB under load. I set it conservatively globally (16-64 MB) and increase it per session
> only when running a specific heavy query.

---

## Scaling

### Why is each Postgres connection expensive, and how do you handle 10,000 clients?
**Answer:** "Every connection is a separate OS process with its own memory, so thousands of direct
connections exhaust RAM and CPU. You don't scale connections by raising `max_connections` - you put a
**connection pooler** (PgBouncer or Supavisor) in front. Apps open many cheap connections to the
pooler, which multiplexes them onto a small fixed set of real Postgres connections (say 20-30). In
production I use framework pooling per app server **and** PgBouncer in front to cap the global total."

### What does partitioning actually buy you, and what's the catch?
**Answer:** "Two wins: **partition pruning** - queries that filter on the partition key scan only the
relevant sub-tables - and **cheap data lifecycle**, since dropping an old month is an instant
`DROP TABLE` instead of a massive `DELETE` plus VACUUM. The catch is that pruning only works if the
partition key is in your `WHERE` clause, and `UNIQUE` constraints must include the partition key.
It's not sharding - all partitions live on the same server."

### OFFSET pagination is slow on page 10,000. Why, and what's the fix?
**Answer:** "`OFFSET 200000 LIMIT 20` makes Postgres read and discard 200,000 rows before returning
20 - cost grows linearly with depth. The fix is **keyset (cursor) pagination**: remember the last row
you saw and continue after it, e.g. `WHERE id < :last_id ORDER BY id DESC LIMIT 20`. That uses the
index to jump straight to the resume point in constant time. The trade-off is you lose 'jump to page
N' - only next/previous - which is exactly how infinite-scroll feeds work."

---

## Replication

**Q: What is the difference between streaming and logical replication?**

> Streaming replication copies raw WAL bytes - the standby is a byte-for-byte physical copy of
> the primary and can only be used for reads. Logical replication decodes WAL into row-level
> changes (INSERT/UPDATE/DELETE) and applies them as SQL. This means the subscriber can be a
> different Postgres version, have different indexes, or even accept writes to other tables. I use
> streaming for HA and read replicas, and logical for major version upgrades, CDC pipelines, and
> selective table replication.

**Q: What is a replication slot and what is the danger?**

> A replication slot ensures the primary keeps WAL until the consumer has received it - so a
> lagging or temporarily disconnected standby does not miss any changes. The danger is that if
> a standby with a slot goes offline indefinitely, the primary accumulates WAL forever until
> the disk fills up and the entire primary crashes. I always monitor retained WAL per slot and
> alert when it exceeds a safe threshold, and I drop slots for standbys that are being decommissioned.

**Q: Sync vs async replication — when do you use each?**

> Async (the default) doesn't wait for the standby, so it's fast but can lose the last few committed
> transactions if the primary dies. Sync waits for the standby to confirm each commit - zero data
> loss, but every write pays the network round-trip and a standby outage stalls writes on the
> primary. I default to async and only switch specific workloads to sync when the business truly
> requires zero data loss on failover.

**Q: How does Patroni prevent split-brain?**

> Patroni uses a distributed consensus store (etcd, ZooKeeper, or Consul) as the single source
> of truth for who is primary. A leader holds a time-limited lease. If it fails, the lease expires
> and replicas compete for a new lease through the consensus protocol - which guarantees only one
> winner. A replica that cannot reach the consensus store will not promote itself, preventing two
> nodes from both believing they are primary simultaneously.

**Q: A standby is lagging 5 minutes behind the primary. What do you check?**

> First I check `pg_stat_replication` on the primary for `write_lag`, `flush_lag`, and `replay_lag`
> to isolate where the bottleneck is. If `replay_lag` is high but `write_lag` is low, WAL is
> arriving fine but the standby is slow to apply it - likely a CPU or I/O bottleneck on the
> standby. If `write_lag` is high, the network between primary and standby is the bottleneck.
> I also check whether the standby is under heavy read query load - long-running SELECTs can
> delay WAL replay because they conflict with certain cleanup operations (`HOT STANDBY CONFLICT`).

---

## Operations & Security

**Q: How would you recover from an accidental `DELETE` that was committed an hour ago?**

> If I have a physical base backup plus continuous WAL archiving, I do point-in-time recovery:
> restore the base backup and replay WAL up to `recovery_target_time` set to one second before the
> bad DELETE. That brings the cluster back to the exact pre-incident state. If I only had a nightly
> `pg_dump`, I'd lose everything since the last dump - which is exactly why PITR matters for any
> system where an hour of data loss is unacceptable.

**Q: What's the difference between `pg_dump` and `pg_basebackup`?**

> `pg_dump` is a *logical* backup - it writes SQL to recreate the data, is portable across versions
> and platforms, and can target a single table. `pg_basebackup` is a *physical* backup - a
> byte-for-byte copy of the data files, tied to the same major version, that restores much faster on
> large databases and is the foundation for PITR and streaming replicas. I use `pg_dump` for
> migrations and version upgrades, and physical backups for production disaster recovery.

**Q: How do you stop one tenant from reading another tenant's data in a multi-tenant database?**

> The robust answer is Row-Level Security. I enable RLS on the tenant tables and write a policy that
> filters by a session variable like `current_setting('app.current_tenant')`, which the app sets per
> request. With `USING` for reads and `WITH CHECK` for writes, even a query that forgets its
> `WHERE tenant_id = ?` can't leak or corrupt another tenant's rows. It moves the isolation guarantee
> from "every developer remembers" to "the database enforces it."

**Q: You need to add a `NOT NULL` column with a default to a 500 GB table with no downtime. How?**

> Adding a column with a default is metadata-only since PG 11, so `ADD COLUMN ... DEFAULT` no longer
> rewrites the table - that part is instant. For the `NOT NULL` itself I avoid the full-table scan
> under an exclusive lock by adding a `CHECK (col IS NOT NULL) NOT VALID` first (instant), then
> running `VALIDATE CONSTRAINT` which scans existing rows without blocking writes, and finally
> promoting it. I also set `lock_timeout` so the migration fails fast rather than stalling traffic.

---

## Rapid-fire one-liners

- **`COUNT(*)` is slow on a big table - why?** MVCC means Postgres must check row visibility, so there's no instant stored count; it scans (an index-only scan helps). For approximate counts, read `reltuples` from `pg_class`.
- **`WHERE LOWER(email) = ?` ignores my index - fix?** Build a functional index: `CREATE INDEX ON users (LOWER(email))`.
- **`NOT IN (subquery)` returned nothing - why?** A single NULL in the subquery makes `NOT IN` yield no rows; use `NOT EXISTS`.
- **`timestamp` vs `timestamptz`?** Always `timestamptz` - plain `timestamp` ignores time zones and causes off-by-hours bugs.
- **Materialized view vs view?** A view is a saved query (always live, recomputed); a materialized view stores the result (fast reads, must `REFRESH`, use `CONCURRENTLY` to avoid locking readers).
- **`CREATE INDEX` in production?** Always `CONCURRENTLY` - plain `CREATE INDEX` locks out writes for the whole build.

> **Pro-Tip for answering advanced Postgres questions:** Whenever you're caught in a tricky situation,
> trace your answer back to **MVCC** (how Postgres copies rows instead of overwriting them) or **the
> WAL (Write-Ahead Log).** Almost every unique performance quirk or optimization behavior in Postgres
> stems from how it protects data integrity via these two systems.
