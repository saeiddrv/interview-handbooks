---
title: "PostgreSQL Performance Tuning — Interview Handbook"
description: "PostgreSQL performance tuning: reading EXPLAIN ANALYZE, query planning, autovacuum, pg_stat_statements, and key config settings."
sidebar:
  label: "Performance"
---

> Performance in PostgreSQL is not about guessing — it is about reading what the database tells you.
> Master `EXPLAIN ANALYZE`, understand the query planner, and know the operational knobs that matter.
> This handbook covers everything a senior engineer needs to diagnose and fix slow queries in production.

---

## 1. How the Query Planner Works

Before Postgres executes any query, it runs a **planner** that decides the cheapest way to get the
data. It considers every possible strategy — which index to use, in what order to join tables, whether
to sort in memory or on disk — and picks the one with the lowest estimated cost.

The planner's decisions are based on **statistics** — row counts, column cardinality, and value
distribution — collected by `ANALYZE` and maintained by autovacuum. If those statistics are stale,
the planner makes bad choices.

**The three scan types you will see in every query plan:**

| Scan type | What it means | When Postgres chooses it |
|---|---|---|
| **Sequential Scan** | Reads every row in the table from start to finish | Small tables, or no suitable index exists |
| **Index Scan** | Uses an index to find rows, then fetches them from the table | Selective queries returning a small fraction of rows |
| **Index-Only Scan** | Uses a covering index — never visits the main table | Query is fully answered by the index (see §5 of the Handbook) |

**The key insight:** a Sequential Scan is not always bad. On a 200-row table it is faster than an
Index Scan. The planner knows this — do not add indexes blindly.

---

## 2. Reading `EXPLAIN ANALYZE`

`EXPLAIN ANALYZE` is the single most important tool for performance work. It runs the query and shows
you exactly what happened — which plan was used, how long each step took, and whether the planner's
estimates were accurate.

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 42 AND status = 'pending';
```

A typical output looks like this:

```
Index Scan using idx_orders_user_id on orders  (cost=0.43..8.45 rows=3 width=72)
                                               (actual time=0.021..0.025 rows=3 loops=1)
  Index Cond: (user_id = 42)
  Filter: (status = 'pending')
  Rows Removed by Filter: 2
Planning Time: 0.4 ms
Execution Time: 0.1 ms
```

**How to read each field:**

| Field | What it means |
|---|---|
| `cost=0.43..8.45` | Planner's estimate: 0.43 = startup cost, 8.45 = total cost (arbitrary units) |
| `rows=3` | Planner's **estimated** row count |
| `actual time=0.021..0.025` | Real measured time in milliseconds |
| `rows=3` (actual) | Real row count returned |
| `loops=1` | How many times this node ran (> 1 in nested loops) |
| `Rows Removed by Filter` | Rows the index fetched but the filter discarded |

**The two most important things to look for:**

**1. Estimate vs. actual row count mismatch**
```
rows=3        (estimated)
rows=48291    (actual)
```
A big difference means the planner's statistics are stale. Run `ANALYZE` on the table.

**2. Sequential Scan on a large table**
```
Seq Scan on orders  (cost=0.00..58291.00 rows=2400000 width=72)
```
If you see this on a table with millions of rows and a `WHERE` clause, you are missing an index —
or the existing index is not being used (wrong column order, stale stats, or the planner thinks
a seq scan is cheaper because the query returns too many rows).

**Using `BUFFERS` for deeper insight:**
```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE user_id = 42;
```
This adds cache hit/miss information:
```
Buffers: shared hit=4 read=1
```
- `shared hit` — data was in Postgres's memory cache (fast)
- `read` — data had to be read from disk (slow)

If you see many `read` buffers on a frequently-run query, your `shared_buffers` or OS cache may
be too small.

---

## 3. The Most Common Performance Problems

### 3.1 Missing Index

**Symptom:** `Seq Scan` on a large table with a `WHERE` clause.

```sql
-- Slow: no index on status
SELECT * FROM orders WHERE status = 'pending';
-- EXPLAIN shows: Seq Scan on orders (rows=2,000,000)

-- Fix: add an index
CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);
-- Or a partial index if 'pending' is a small subset:
CREATE INDEX CONCURRENTLY idx_orders_pending ON orders (created_at) WHERE status = 'pending';
```

### 3.2 Index Exists but Is Not Used

The planner ignores an index when:

| Reason | Example | Fix |
|---|---|---|
| Query returns too many rows | `WHERE status = 'completed'` (95% of rows) | Accept seq scan — it is correct |
| Function on indexed column | `WHERE LOWER(email) = 'x'` | `CREATE INDEX ON users (LOWER(email))` |
| Type mismatch | `WHERE id = '42'` (string vs integer) | Match types — cast or fix the query |
| Stale statistics | Table just received millions of rows | `ANALYZE table_name` |
| Small table | Under ~200 rows | No action needed — seq scan is faster |

```sql
-- Bad: function on the column defeats the index on email
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';

-- Fix: create a functional index
CREATE INDEX idx_users_lower_email ON users (LOWER(email));
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';  -- now uses the index
```

### 3.3 N+1 Queries

**Symptom:** Your app runs 1 query to get a list, then 1 more query per row — 1 + N queries total.
This is the most common application-level performance killer.

```sql
-- Bad: fetching 100 orders then running 100 separate queries for each user
SELECT * FROM orders LIMIT 100;
-- then for each order: SELECT * FROM users WHERE id = ?  ← runs 100 times

-- Fix: one JOIN fetches everything in a single query
SELECT o.*, u.name, u.email
FROM orders o
JOIN users u ON u.id = o.user_id
LIMIT 100;
```

### 3.4 Slow JOINs

**Symptom:** A JOIN between two large tables takes seconds.

```sql
EXPLAIN ANALYZE
SELECT o.id, u.name FROM orders o JOIN users u ON u.id = o.user_id;
```

If you see `Hash Join` or `Nested Loop` over millions of rows, the JOIN column likely lacks an index:

```sql
-- Missing foreign key index (Postgres does NOT create these automatically)
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders (user_id);
```

> **Trap:** PostgreSQL does not automatically create indexes on foreign key columns. You must
> create them manually. A missing FK index causes full table scans every time the parent table
> is joined.

### 3.5 Bloated Tables and Indexes

Because of MVCC, dead tuples accumulate after heavy `UPDATE`/`DELETE` workloads. This makes
tables and indexes physically larger than they need to be, slowing down scans.

```sql
-- Check table bloat
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
       n_dead_tup AS dead_tuples,
       n_live_tup AS live_tuples
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;

-- If autovacuum is not keeping up, run manually:
VACUUM ANALYZE orders;

-- For extreme bloat, reclaim space (requires ACCESS EXCLUSIVE lock — production downtime):
VACUUM FULL orders;
-- Better alternative: use pg_repack extension (rewrites table without locking)
```

---

## 4. Autovacuum — What It Does and When to Tune It

Autovacuum is a background process that automatically:
1. Removes dead tuples left behind by `UPDATE` and `DELETE` (reclaims space)
2. Updates planner statistics (`ANALYZE`)
3. Prevents transaction ID wraparound (a critical safety mechanism)

**It runs automatically — you rarely need to trigger it manually.** But on high-churn tables it
can fall behind, causing bloat and stale statistics.

**How to check if autovacuum is keeping up:**
```sql
SELECT relname,
       n_dead_tup,
       n_live_tup,
       round(n_dead_tup::numeric / nullif(n_live_tup,0) * 100, 1) AS dead_pct,
       last_autovacuum,
       last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
```

If `dead_pct` is consistently above 10–20% on a table, autovacuum is not keeping up.

**Key autovacuum settings (tune per table, not globally):**
```sql
-- Make autovacuum more aggressive on a high-churn table
ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor = 0.01,   -- trigger at 1% dead tuples (default: 20%)
  autovacuum_analyze_scale_factor = 0.005  -- analyze at 0.5% changes (default: 10%)
);
```

> **Senior answer:** "I never disable autovacuum — it prevents transaction ID wraparound which
> would take the database offline. Instead I tune it per-table with `autovacuum_vacuum_scale_factor`
> to make it more aggressive on high-write tables."

---

## 5. Key `postgresql.conf` Settings That Matter

You do not need to memorize every setting. These are the ones that come up in senior interviews
and have the biggest impact on performance:

| Setting | Default | What it does | Recommended starting point |
|---|---|---|---|
| `shared_buffers` | 128 MB | Postgres's own memory cache for data pages | 25% of total RAM |
| `work_mem` | 4 MB | Memory per sort / hash operation per query | 16–64 MB (careful: multiplied by connections) |
| `maintenance_work_mem` | 64 MB | Memory for `VACUUM`, `CREATE INDEX`, etc. | 256 MB – 1 GB |
| `effective_cache_size` | 4 GB | Hint to planner about total available cache (OS + Postgres) | 75% of total RAM |
| `max_connections` | 100 | Max simultaneous connections | Keep low — use a pooler |
| `wal_buffers` | -1 (auto) | Buffer for WAL writes | Auto is usually fine |
| `checkpoint_completion_target` | 0.9 | Spread checkpoint writes over this fraction of the interval | 0.9 is good |
| `random_page_cost` | 4.0 | Planner's cost estimate for a random disk read | Set to 1.1 for SSDs |

> **`work_mem` trap:** `work_mem` is allocated **per sort operation per connection** — not per
> connection. A query with 3 sorts and 50 active connections could use `3 × 50 × work_mem` of RAM.
> Set it too high and you run out of memory under load.

> **`random_page_cost` for SSDs:** the default of 4.0 assumes spinning disks where random reads
> are expensive. On SSDs, set it to 1.1 — this makes the planner much more willing to use indexes.

```sql
-- Check current settings
SHOW shared_buffers;
SHOW work_mem;
SHOW random_page_cost;

-- Change for the current session only (safe for testing):
SET work_mem = '64MB';
EXPLAIN ANALYZE SELECT ...;  -- see if the plan improves
```

---

## 6. Finding Slow Queries with `pg_stat_statements`

`pg_stat_statements` tracks execution statistics for every query type that runs in the database.
It is the first place to look when diagnosing production performance problems.

```sql
-- Enable the extension (requires superuser, add to shared_preload_libraries in postgresql.conf)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find the slowest queries by average execution time
SELECT
    round(mean_exec_time::numeric, 2) AS avg_ms,
    calls,
    round(total_exec_time::numeric, 2) AS total_ms,
    rows,
    query
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Find queries with the most total time (highest overall cost)
SELECT
    round(total_exec_time::numeric, 2) AS total_ms,
    calls,
    round(mean_exec_time::numeric, 2) AS avg_ms,
    query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- Reset statistics (start fresh after a deploy or config change)
SELECT pg_stat_statements_reset();
```

**How to use this in practice:**
1. Sort by `total_exec_time` to find the queries costing the most overall
2. Sort by `mean_exec_time` to find the slowest individual queries
3. Take the worst offender, run `EXPLAIN (ANALYZE, BUFFERS)` on it, and fix

---

## 7. Performance Tuning Checklist

A systematic approach for diagnosing a slow query in production:

```
1. Find it          → pg_stat_statements (sort by total_exec_time)
2. Understand it    → EXPLAIN (ANALYZE, BUFFERS)
3. Check for:
   □ Seq Scan on large table?      → missing index
   □ Estimate ≠ actual rows?       → run ANALYZE
   □ Index exists but ignored?     → functional index? type mismatch? too many rows?
   □ Many disk reads (Buffers)?    → increase shared_buffers or work_mem
   □ Slow JOIN?                    → missing FK index
   □ High dead_tup?                → autovacuum falling behind, run VACUUM ANALYZE
4. Fix it           → CREATE INDEX CONCURRENTLY / ANALYZE / tune autovacuum
5. Verify           → EXPLAIN ANALYZE again, compare timings
```

---

> **Interview questions for this topic** are in the central
> [Interview Q&A](/data-storage/postgresql/q-and-a/#performance) bank (see also the
> [Indexing](/data-storage/postgresql/q-and-a/#indexing) and
> [Internals & MVCC](/data-storage/postgresql/q-and-a/#internals--mvcc) sections).

## Cheat Sheet

```sql
-- Find slow queries
SELECT round(mean_exec_time::numeric,2) AS avg_ms, calls, query
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;

-- Diagnose a query
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;

-- Refresh planner statistics
ANALYZE table_name;
VACUUM (ANALYZE) table_name;

-- Check table bloat
SELECT relname, n_dead_tup, n_live_tup
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;

-- Tune autovacuum per table
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.01);

-- Fix planner ignoring indexes on SSDs
SET random_page_cost = 1.1;

-- Test work_mem for a session
SET work_mem = '256MB';
EXPLAIN ANALYZE SELECT ...;
```

**The three rules:**
1. **Measure first** — never optimize without `EXPLAIN ANALYZE`
2. **Statistics must be fresh** — stale stats cause bad plans; run `ANALYZE` after bulk changes
3. **Never disable autovacuum** — tune it instead
