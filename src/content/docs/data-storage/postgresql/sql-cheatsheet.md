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

| JOIN | Returns |
|---|---|
| `INNER JOIN` | Only rows matching in **both** tables |
| `LEFT JOIN` | All left rows + matched right rows (NULL if no match) |
| `RIGHT JOIN` | All right rows + matched left rows |
| `FULL OUTER JOIN` | All rows from both sides, matched where possible |
| `CROSS JOIN` | Every combination (m × n rows) |
| `SELF JOIN` | Table joined to itself |

**INNER JOIN** — use when unmatched rows are irrelevant and you only want pairs that exist on both sides.
`WHERE` can filter on left, right, or both tables freely — unmatched rows are already excluded.
```sql
SELECT u.name, o.total
FROM users u
JOIN orders o ON o.user_id = u.id;
-- User with no orders: not returned
```

**LEFT JOIN** — use when the left table is your primary list and the right side is optional extra data.
`WHERE` on the **left table** is safe. `WHERE` on the **right table** silently turns it into an INNER JOIN
because unmatched rows have NULL on the right, and any condition on NULL evaluates to false.
```sql
SELECT u.name, o.total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id;
-- User with no orders: returned with o.total = NULL
```

**FULL OUTER JOIN** — use when neither side is the primary list and you need unmatched rows from both.
`WHERE` on either table will drop its unmatched rows and effectively convert that side to an INNER JOIN.
Filter in the `ON` clause instead to preserve unmatched rows on both sides.
```sql
SELECT u.name, o.total
FROM users u
FULL OUTER JOIN orders o ON o.user_id = u.id;
-- Unmatched users: o.total = NULL
-- Orphan orders with no user: u.name = NULL
```

**SELF JOIN** — use when a table has a relationship with itself, like a hierarchy or parent-child structure.
`WHERE` on the joined alias drops rows with no match (e.g. the CEO with no manager).
Use `LEFT JOIN` so top-level rows without a parent still appear.
```sql
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id;
-- LEFT so employees with no manager (the CEO) still appear with manager = NULL
```

**LEFT JOIN + WHERE IS NULL** — use when you need rows from the left table that have no match on the right.
`WHERE` must be on the **right table column** set to `IS NULL` — that is the exact condition that identifies
non-matching rows. Any other condition on the right table will remove those non-matching rows instead.
```sql
SELECT u.* FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;   -- o.id is NULL only when no order row matched
```

**CROSS JOIN LATERAL** — use when you need a per-row subquery that references the outer table.
A plain JOIN cannot do this because it cannot reference the outer row inside a subquery.
`WHERE` applies to the final combined result after the lateral subquery runs per row.
```sql
SELECT u.id, recent.*
FROM users u
CROSS JOIN LATERAL (
  SELECT * FROM orders o
  WHERE o.user_id = u.id     -- references the current user row
  ORDER BY created_at DESC
  LIMIT 3                    -- runs independently for each user
) recent;
```

> **Trap 1:** `LEFT JOIN` + a `WHERE` filter on the right table silently becomes an INNER JOIN.
> Put the condition in the `ON` clause instead, not in `WHERE`.
> ```sql
> -- WRONG: WHERE on the right table turns LEFT JOIN into INNER JOIN
> -- users with no orders are excluded because o.status = NULL fails the WHERE
> SELECT u.name, o.total
> FROM users u
> LEFT JOIN orders o ON o.user_id = u.id
> WHERE o.status = 'paid';             -- drops users with no orders entirely
>
> -- RIGHT: move the filter into ON
> SELECT u.name, o.total
> FROM users u
> LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid';
> -- users with no paid orders are still returned, with o.total = NULL
> ```
>
> **Trap 2:** Joining on a non-unique column multiplies rows and inflates `SUM`/`COUNT`.
> ```sql
> -- orders has 3 rows for user 1, tags has 2 rows for user 1
> -- result: 3 x 2 = 6 rows for user 1 — SUM(o.total) is now tripled
> SELECT u.name, SUM(o.total)
> FROM users u
> JOIN orders o ON o.user_id = u.id
> JOIN tags   t ON t.user_id = u.id   -- non-unique: multiplies rows
> GROUP BY u.name;
> ```

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
> **`EXISTS` vs `IN`:**
>
> **`IN`** runs the subquery once and builds a list, then checks each row against it.
> Good for small static lists. If the list is large, it becomes slow.
>
> **`EXISTS`** runs the subquery once per outer row and stops as soon as it finds one match
> (short-circuits). Faster for existence checks because it never builds a full list.
> ```sql
> -- IN: builds the full list of user_ids first, then scans it for each user
> SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 1000);
>
> -- EXISTS: for each user, stops as soon as one matching order is found
> SELECT * FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.total > 1000);
> ```
>
> **`NOT IN` with NULLs is a silent trap.** If the subquery returns even one NULL, `NOT IN`
> returns zero rows — not because nothing matched, but because `x NOT IN (1, 2, NULL)` is
> unknown for every value of x (NULL comparisons are never true or false).
> ```sql
> -- UNSAFE: if any order has user_id = NULL, this returns zero rows entirely
> SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders);
>
> -- SAFE: NOT EXISTS handles NULLs correctly
> SELECT * FROM users u WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
> ```

### 6. CTEs (WITH) — Common Table Expressions

A CTE is a named temporary result set that exists only for the duration of one query.
You write a subquery, give it a name with `WITH name AS (...)`, and use that name like a table
in the rest of the query. When the query finishes it is gone — nothing is stored on disk.

The benefit is readability and reuse. Without a CTE you nest subqueries inside each other;
with a CTE you name each step and build on it:

```sql
-- Without CTE: nested and hard to read
SELECT u.name FROM users u
JOIN (SELECT user_id, SUM(total) AS spent FROM orders
      GROUP BY user_id HAVING SUM(total) > 1000) b ON b.user_id = u.id;

-- With CTE: named, readable, and reusable anywhere below
WITH big_spenders AS (
  SELECT user_id, SUM(total) AS spent FROM orders GROUP BY user_id HAVING SUM(total) > 1000
)
SELECT u.name, b.spent FROM users u JOIN big_spenders b ON b.user_id = u.id;
```

**Recursive CTE** — use when data has a parent-child relationship (org charts, category trees, folder structures).
A recursive CTE has two parts connected by `UNION ALL`:
- **Anchor** — the starting row. Postgres runs this once.
- **Recursive step** — joins the previous result back to the table to find the next level.
  Postgres keeps repeating this until no new rows are found, then stops.

Given this employees table:
```
id  name        manager_id
1   CEO         NULL
2   VP Sales    1
3   VP Tech     1
4   Sales Mgr   2
5   Developer   3
6   Designer    3
```

```sql
WITH RECURSIVE org_tree AS (

  -- Step 1 (Anchor): start at VP Tech (id = 3) — this row IS included in the final result
  SELECT id, name, manager_id FROM employees WHERE id = 3

  UNION ALL  -- Step 2: stack every iteration's rows into the final result (keep all, no dedup)

  -- Step 3 (Recursive): find everyone who reports to someone already in the result.
  -- Postgres repeats this step until no new rows are found, then stops.
  SELECT e.id, e.name, e.manager_id
  FROM employees e
  JOIN org_tree o ON e.manager_id = o.id  -- join back to previous result
)
-- Step 4: return everything collected across all iterations
SELECT * FROM org_tree;  -- returns id, name, manager_id for every matched row
```

Postgres runs it like this:
```
Step 1 (anchor):           runs once
Step 2 (UNION ALL):        stacks results
Step 3 (recursive run 1):  finds rows — repeats
Step 3 (recursive run 2):  no rows found — stop
Step 4 (final SELECT):     returns all collected rows

Final result (id, name, manager_id):
 3  VP Tech    1
 5  Developer  3
 6  Designer   3

Not returned: CEO, VP Sales, Sales Mgr — they are not under VP Tech
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

Set operations combine the results of two queries into one. Both queries must return the same number of columns with compatible types.

**`UNION`** — combines results and removes duplicates. Use when you need a merged unique list from two sources.
Costs more because Postgres must sort and compare every row to deduplicate.
```sql
-- All unique countries from both customers and suppliers
SELECT country FROM customers
UNION
SELECT country FROM suppliers;
```

**`UNION ALL`** — combines results and keeps everything including duplicates. Use when duplicates are acceptable or expected, or when you just want to stack two result sets together.
Always faster than `UNION` — no deduplication step.
```sql
-- All transactions from 2023 and 2024 combined (duplicates fine)
SELECT id, amount FROM transactions_2023
UNION ALL
SELECT id, amount FROM transactions_2024;
```

**`INTERSECT`** — returns only rows that appear in **both** results. Use when you need the overlap between two sets.
```sql
-- Users who placed an order AND wrote a review
SELECT user_id FROM orders
INTERSECT
SELECT user_id FROM reviews;
```

**`EXCEPT`** — returns rows from the first query that do **not** appear in the second. Use when you need what exists in one set but not the other.
```sql
-- Users who placed an order but never wrote a review
SELECT user_id FROM orders
EXCEPT
SELECT user_id FROM reviews;
```

> **Trap:** `UNION` and `INTERSECT` deduplicate (sort all rows — costs more). Use `UNION ALL`
> whenever duplicates are acceptable. There is no `INTERSECT ALL` or `EXCEPT ALL` in common use.

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