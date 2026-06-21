---
title: "PostgreSQL SQL Cheatsheet — Interview Handbook"
description: "Complete SQL reference for PostgreSQL: SELECT, JOINs, window functions, CTEs, JSON, DDL, transactions, and the most common gotchas."
sidebar:
  label: "SQL Cheatsheet"
---

> A practical, copy-ready reference for every kind of query you will write or be asked about — with tricks, gotchas, and senior-level patterns.

### 1. SELECT basics & filtering
```sql
SELECT id, name FROM users;                      -- pick columns (avoid SELECT * in prod)
SELECT DISTINCT country FROM users;              -- unique values
SELECT * FROM users WHERE age >= 18 AND active = true;  -- filter (active is a boolean column)
SELECT * FROM users WHERE country IN ('US','UK');-- set membership
SELECT * FROM users WHERE name LIKE 'Jo%';       -- pattern (case-sensitive)
SELECT * FROM users WHERE name ILIKE 'jo%';      -- pattern (case-INsensitive) PG-specific
SELECT * FROM users WHERE email IS NULL;         -- NULL test (NEVER use = NULL!)
SELECT * FROM users WHERE age BETWEEN 18 AND 30; -- inclusive range
SELECT * FROM orders WHERE total > 100 ORDER BY total DESC NULLS LAST LIMIT 10;
```
> **NULL traps:** `= NULL` is always unknown - use `IS NULL`. `NULL` sorts as the *largest* value
> by default; control it with `NULLS FIRST/LAST`. `WHERE x <> 5` **excludes NULL rows** too - add
> `OR x IS NULL` if you want them.

### 2. Sorting, paging, sampling
```sql
ORDER BY created_at DESC, id DESC          -- tiebreak with a unique column (stable paging)
LIMIT 20 OFFSET 40                         -- simple paging (slow when deep - see §4.10)
FETCH FIRST 10 ROWS ONLY                   -- SQL-standard form of LIMIT
ORDER BY random() LIMIT 1                   -- random row (slow on big tables)
TABLESAMPLE SYSTEM (1)                      -- fast ~1% sample of a huge table
```

### 3. Aggregation & GROUP BY
```sql
SELECT country, COUNT(*), AVG(age), MIN(age), MAX(age), SUM(balance)
FROM users GROUP BY country
HAVING COUNT(*) > 100;                       -- HAVING filters AFTER grouping (WHERE filters before)

COUNT(*)                -- all rows        |  COUNT(col)  -- non-NULL only
COUNT(DISTINCT col)     -- unique non-NULL values
SUM(x) FILTER (WHERE status='paid')          -- conditional aggregate (cleaner than CASE)
string_agg(name, ', ' ORDER BY name)         -- concat rows into one string
array_agg(id ORDER BY id)                    -- collect rows into an array
json_agg(row_to_json(t))                      -- collect rows into JSON
bool_or(active), bool_and(active)            -- any / all true
```
> **Trick - `FILTER`:** `COUNT(*) FILTER (WHERE paid)` lets you do multiple conditional counts in
> one pass: `SELECT COUNT(*) FILTER (WHERE paid) AS paid, COUNT(*) FILTER (WHERE NOT paid) AS unpaid`.
>
> **GROUP BY rule:** every non-aggregated column in `SELECT` must appear in `GROUP BY`.
> `GROUPING SETS`, `ROLLUP`, and `CUBE` produce subtotals/grand totals in one query.

### 4. JOINs (the heart of relational queries)
```sql
SELECT u.name, o.total
FROM users u
JOIN orders o      ON o.user_id = u.id;       -- INNER: only matching rows
LEFT JOIN orders o ON o.user_id = u.id;        -- all users, NULLs where no order
RIGHT JOIN ...                                 -- all right-side rows
FULL OUTER JOIN ...                            -- everything from both sides
CROSS JOIN colors;                             -- every combination (Cartesian product)
```
| JOIN | Returns |
|---|---|
| `INNER JOIN` | Only rows matching in **both** tables |
| `LEFT JOIN` | All **left** rows + matches (NULL if none) |
| `RIGHT JOIN` | All **right** rows + matches |
| `FULL OUTER JOIN` | All rows from **both**, matched where possible |
| `CROSS JOIN` | Every combination (m × n) |
| `SELF JOIN` | Table joined to itself (e.g., employee → manager) |

```sql
-- Find rows with NO match (anti-join) - classic interview trick:
SELECT u.* FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;                            -- users who never ordered

-- LATERAL: a join where the right side references the left ("for each row, run this subquery")
SELECT u.id, recent.*
FROM users u
CROSS JOIN LATERAL (
  SELECT * FROM orders o WHERE o.user_id = u.id
  ORDER BY created_at DESC LIMIT 3            -- top-3 orders PER user
) recent;
```
> **Join traps:** a `LEFT JOIN` + a `WHERE` on the right table silently turns it into an INNER join
> (put the condition in the `ON` instead). Joining on a non-unique column **multiplies rows** (fan-out)
> and inflates `SUM`/`COUNT`.

### 5. Subqueries & EXISTS
```sql
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders WHERE total > 1000);   -- subquery list

SELECT * FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);  -- EXISTS (stops at first match)

SELECT * FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id); -- users with no orders

SELECT name, (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) AS order_count
FROM users u;                                                  -- correlated scalar subquery
```
> **`EXISTS` vs `IN`:** prefer **`EXISTS`** for correlated existence checks (it short-circuits) and
> beware **`NOT IN` with NULLs** - if the subquery returns a single NULL, `NOT IN` returns **no rows**.
> Use `NOT EXISTS` instead.

### 6. CTEs (WITH) & recursion
```sql
WITH big_spenders AS (
  SELECT user_id, SUM(total) AS spent FROM orders GROUP BY user_id HAVING SUM(total) > 1000
)
SELECT u.name, b.spent FROM users u JOIN big_spenders b ON b.user_id = u.id;

-- Recursive CTE: walk a hierarchy (org chart, category tree, graph)
WITH RECURSIVE subordinates AS (
  SELECT id, name, manager_id FROM employees WHERE id = 1      -- anchor (the boss)
  UNION ALL
  SELECT e.id, e.name, e.manager_id
  FROM employees e JOIN subordinates s ON e.manager_id = s.id  -- recursive step
)
SELECT * FROM subordinates;
```
> CTEs make complex queries **readable** and enable **recursion** (trees/graphs). Since PG 12 they're
> inlined by default (fast); add `MATERIALIZED` to force a one-time computation, `NOT MATERIALIZED` to
> force inlining.

### 7. Window functions (analytics without collapsing rows)
Unlike `GROUP BY`, window functions **keep every row** and add a computed column across a "window."
```sql
SELECT name, department, salary,
  ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rank_in_dept,
  RANK()       OVER (PARTITION BY department ORDER BY salary DESC) AS rnk,
  DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dense,
  SUM(salary)  OVER (PARTITION BY department) AS dept_total,
  AVG(salary)  OVER (PARTITION BY department) AS dept_avg,
  salary - LAG(salary)  OVER (ORDER BY salary) AS diff_from_prev,  -- previous row
  LEAD(salary)          OVER (ORDER BY salary) AS next_salary,     -- next row
  SUM(salary)  OVER (ORDER BY hired_at
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM employees;
```
| Function | Does |
|---|---|
| `ROW_NUMBER()` | Unique sequential number (no ties) |
| `RANK()` | Ranking with **gaps** after ties (1,1,3) |
| `DENSE_RANK()` | Ranking with **no gaps** (1,1,2) |
| `NTILE(4)` | Split rows into N buckets (quartiles) |
| `LAG()/LEAD()` | Value from previous / next row |
| `FIRST_VALUE()/LAST_VALUE()` | First/last in the window |
| `SUM/AVG/COUNT OVER` | Running totals & moving averages |

> **Classic interview task - "top N per group":** use `ROW_NUMBER() OVER (PARTITION BY group ORDER BY
> metric DESC)` in a subquery/CTE, then `WHERE rn <= N`. (Or use `LATERAL`, §12.4.)
> ```sql
> SELECT * FROM (
>   SELECT *, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) rn
>   FROM employees
> ) t WHERE rn <= 3;                            -- top 3 earners per department
> ```

### 8. INSERT / UPDATE / DELETE (writing data)
```sql
INSERT INTO users (name, email) VALUES ('Sam','s@x.com'), ('Lee','l@x.com');  -- multi-row
INSERT INTO users (name) VALUES ('A') RETURNING id;          -- get the new id back

UPDATE orders SET status='shipped', shipped_at=now() WHERE id=10 RETURNING *;
UPDATE accounts a SET balance = balance + t.amt              -- UPDATE ... FROM (join in an update)
FROM transfers t WHERE t.account_id = a.id;

DELETE FROM sessions WHERE expires_at < now() RETURNING id;
TRUNCATE TABLE logs;                                          -- instant wipe (no per-row scan, can't filter)

-- UPSERT: insert, or update if it already exists (ON CONFLICT)
INSERT INTO inventory (sku, qty) VALUES ('A1', 5)
ON CONFLICT (sku) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty;
INSERT INTO inventory (sku, qty) VALUES ('A1', 5)
ON CONFLICT (sku) DO NOTHING;                                 -- ignore duplicates
```
> **`RETURNING`** (PG-specific) avoids a second `SELECT` after a write. **`ON CONFLICT`** is the
> atomic "insert-or-update" - far safer than check-then-insert (no race condition). `TRUNCATE` is much
> faster than `DELETE` for emptying a table but can't be filtered and resets sequences (`RESTART
> IDENTITY`).

### 9. Set operations
```sql
SELECT id FROM a UNION     SELECT id FROM b;   -- combine + remove duplicates
SELECT id FROM a UNION ALL SELECT id FROM b;   -- keep duplicates (faster - no dedup)
SELECT id FROM a INTERSECT SELECT id FROM b;   -- in both
SELECT id FROM a EXCEPT    SELECT id FROM b;    -- in a but not b
```
> `UNION` dedups (sorts - costs more); use **`UNION ALL`** unless you truly need uniqueness.

### 10. CASE, COALESCE & conditional logic
```sql
SELECT name,
  CASE WHEN age < 18 THEN 'minor'
       WHEN age < 65 THEN 'adult'
       ELSE 'senior' END AS bracket
FROM users;

COALESCE(nickname, name, 'Anonymous')   -- first non-NULL value
NULLIF(a, b)                            -- NULL if a = b (e.g., avoid divide-by-zero: x / NULLIF(y,0))
GREATEST(a,b,c), LEAST(a,b,c)          -- max/min across columns (not rows)
```

### 11. Strings, numbers, dates
```sql
-- strings
lower(s), upper(s), length(s), trim(s), substring(s, 1, 3), s || '!'  -- || concatenates
split_part('a,b,c', ',', 2)  -- 'b'        | replace(s,'x','y') | left(s,3) | right(s,3)
s ~ '^[0-9]+$'               -- regex match (~* = case-insensitive)
format('Hi %s, #%s', name, id)
-- numbers
round(x, 2), ceil(x), floor(x), abs(x), mod(a,b), x::numeric(10,2)
-- dates / time
now(), current_date, age(birthdate)
date_trunc('month', created_at)         -- bucket by month/day/hour (great for GROUP BY)
extract(year FROM created_at)           -- pull a field out
created_at + interval '7 days'          -- date math
created_at::date                        -- cast timestamp → date
```
> **`date_trunc` + `GROUP BY`** is the standard way to build time-series reports (daily/monthly
> totals). Prefer **`timestamptz`** over `timestamp` to avoid timezone bugs.

### 12. JSON / JSONB (semi-structured data)
```sql
SELECT data->>'name'        FROM events;      -- ->>  returns TEXT
SELECT data->'address'->>'city' FROM events;  -- ->   returns JSON (chain it)
SELECT * FROM events WHERE data @> '{"type":"click"}';  -- @> contains (uses a GIN index!)
SELECT * FROM events WHERE data ? 'user_id';   -- key exists
SELECT jsonb_array_elements(data->'items') FROM orders; -- expand a JSON array into rows
jsonb_set(data, '{status}', '"done"')          -- update a JSON field
jsonb_build_object('id', id, 'name', name)     -- build JSON from columns
```
> Use **`JSONB`** (binary, indexable) over `JSON` (raw text). The `@>` containment operator plus a
> **GIN index** makes JSON searches fast (see §4.3).

### 13. Performance & inspection commands
```sql
EXPLAIN SELECT ...;                 -- the planner's intended plan (no execution)
EXPLAIN ANALYZE SELECT ...;         -- actually runs it + real timings (the #1 tuning tool)
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;  -- also shows cache/disk reads
ANALYZE users;                      -- refresh planner statistics
VACUUM (ANALYZE) users;             -- reclaim dead tuples + update stats
REINDEX INDEX idx_users_email;      -- rebuild a bloated index
```
> **Reading `EXPLAIN`:** watch for **`Seq Scan`** on big tables (missing index?), high **`rows`**
> mis-estimates (stale stats → `ANALYZE`), and **`Nested Loop`** over many rows (often wants a
> hash/merge join). The first number in `cost=0.00..15.00` is startup cost, the second is total.

### 14. Transactions, locking & concurrency tricks
```sql
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;                                   -- or ROLLBACK;

SELECT * FROM orders WHERE id = 5 FOR UPDATE;          -- lock row so no one else changes it
SELECT * FROM jobs WHERE status='queued'
  ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1;          --safe job-queue pattern (skip locked rows)
SAVEPOINT sp1;  ...  ROLLBACK TO sp1;                  -- partial rollback
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;          -- strongest isolation
```
> **`FOR UPDATE SKIP LOCKED`** is the gold-standard trick for building a **concurrent job queue**
> in plain SQL - multiple workers each grab different rows without blocking each other. **`FOR UPDATE`**
> prevents lost updates by locking the selected rows until commit.

### 15. DDL quick reference (schema)
```sql
CREATE TABLE users (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- modern auto-increment
  email       text UNIQUE NOT NULL,
  age         int CHECK (age >= 0),
  country     text DEFAULT 'US',
  created_at  timestamptz DEFAULT now(),
  manager_id  bigint REFERENCES users(id) ON DELETE SET NULL
);
ALTER TABLE users ADD COLUMN phone text;
ALTER TABLE users ADD CONSTRAINT uq_phone UNIQUE (phone);
CREATE INDEX CONCURRENTLY idx_users_country ON users(country);   -- no table lock (§4.8)
CREATE VIEW active_users AS SELECT * FROM users WHERE active;
CREATE MATERIALIZED VIEW daily_sales AS SELECT date_trunc('day',created_at) d, SUM(total) FROM orders GROUP BY 1;
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales;
```
> **View vs Materialized view:** a plain **view** is a saved query (always live, computed each time);
> a **materialized view** stores the *result* (fast reads, but must be `REFRESH`ed). Use materialized
> views for expensive dashboards/reports.

### 16. Choosing the right data type
Picking the correct type prevents whole classes of bugs. The senior-level choices interviewers probe:

| Need | Use | Avoid / why |
|---|---|---|
| Auto-increment key | `bigint GENERATED ALWAYS AS IDENTITY` | `serial` (older, quirky ownership); use `bigint` not `int` to avoid running out at 2.1B |
| Money / exact decimals | `numeric(12,2)` | `float`/`real` — binary floats can't represent `0.1` exactly |
| Timestamp | `timestamptz` | `timestamp` — it ignores time zones and causes off-by-hours bugs |
| Text | `text` | `varchar(n)` — no perf benefit in PG; the length cap just causes migrations later |
| Unique ID across systems | `uuid` (prefer time-sortable `uuidv7()`, PG 18) | random `uuidv4` as a primary key — it fragments B-Tree indexes |
| True/false | `boolean` | storing `'Y'`/`'N'` text |
| Fixed set of values | `text` + `CHECK (... IN (...))` or an `enum` | magic numbers |
| Flexible/sparse attributes | `jsonb` | `json` (text, unindexable) — see §12 |
| List of values | `text[]` array or a child table | comma-separated text in one column |

```sql
-- The modern, safe defaults for a new table:
CREATE TABLE example (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  price       numeric(12,2) NOT NULL CHECK (price >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL CHECK (status IN ('new','paid','shipped')),
  metadata    jsonb
);
```
> **The two most common type traps:** using `timestamp` instead of **`timestamptz`** (timezone
> bugs), and `float` instead of **`numeric`** for money (rounding errors). Both come up constantly.

### 17. The "gotcha" cheat list (memorize these)
- `= NULL` never matches → use **`IS NULL`**.
- `NOT IN (subquery with NULL)` returns **zero rows** → use **`NOT EXISTS`**.
- `WHERE col <> x` **drops NULL rows** → add `OR col IS NULL`.
- `LEFT JOIN` + filter on the right table in `WHERE` → becomes an **INNER JOIN** (filter in `ON`).
- `COUNT(col)` ignores NULLs; `COUNT(*)` doesn't.
- Joining on a non-unique key **multiplies rows** and inflates aggregates.
- `OFFSET` deep-paging is slow → use **keyset pagination** (§4.10).
- `UNION` dedups (slow) → use **`UNION ALL`** when duplicates are fine.
- Integer division: `5 / 2 = 2` → cast first: `5::numeric / 2 = 2.5`.
- `HAVING` filters groups (after aggregation); `WHERE` filters rows (before).
- An index on `email` is **not used** for `WHERE LOWER(email)=...` → index the expression.
- `TRUNCATE` can't be rolled back in some engines (in PG it *can* inside a transaction) and bypasses
  row triggers.

---