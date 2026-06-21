---
title: "PostgreSQL Practical Recipes — Interview Handbook"
description: "Copy-ready PostgreSQL recipes: indexes, full-text search, partitioning, materialized views, constraints, and useful extensions."
sidebar:
  label: "Practical Recipes"
---

> Copy-ready, real-world snippets for setting up indexes, full-text search, partitioning, and more — with when and why to use each.

## Practical Recipes

Copy-ready, real-world snippets for setting up indexes, full-text search, partitioning, and the rest -
with *when* and *why* to use each.

### 1. Creating each index type on a real field
```sql
-- B-Tree (the default): equality, ranges, sorting
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_orders_created ON orders (created_at);
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC); -- composite (order matters!)

-- UNIQUE index (enforces no duplicates + speeds lookups)
CREATE UNIQUE INDEX uq_users_email ON users (email);

-- PARTIAL index: only index the rows you actually query - smaller & faster
CREATE INDEX idx_orders_unshipped ON orders (created_at) WHERE status = 'pending';

-- EXPRESSION (functional) index: needed when you filter on a function
CREATE INDEX idx_users_lower_email ON users (LOWER(email));
-- now this uses the index:  WHERE LOWER(email) = 'sam@x.com'

-- BRIN: huge, naturally time-ordered tables (tiny index)
CREATE INDEX idx_logs_created_brin ON system_logs USING BRIN (created_at);
CREATE INDEX idx_logs_brin2 ON system_logs USING BRIN (created_at) WITH (pages_per_range = 32);

-- HASH: only equality (rarely worth it over B-Tree)
CREATE INDEX idx_sessions_token_hash ON sessions USING HASH (token);

-- GIN: arrays, JSONB, full-text (multi-value columns)
CREATE INDEX idx_events_data_gin ON events USING GIN (data);            -- JSONB
CREATE INDEX idx_posts_tags_gin  ON posts  USING GIN (tags);            -- text[] array

-- GiST: ranges, geometry, nearest-neighbour
CREATE INDEX idx_rooms_period_gist ON reservations USING GIST (during); -- tstzrange
```
> **BRIN on a field example:** `CREATE INDEX ... USING BRIN (created_at)` on an append-only logs
> table gives you a ~1000× smaller index than B-Tree - *as long as rows are inserted in time order*
> (so they're physically ordered on disk). Tune `pages_per_range` lower for more precision, higher for
> a smaller index.
>
> **Composite index rule:** put the column you filter by **equality** first, the **range/sort**
> column second. `(user_id, created_at)` serves `WHERE user_id=? ORDER BY created_at` perfectly but
> *not* a query on `created_at` alone (leftmost-prefix rule).

### 2. Full-Text Search (FTS) — searching natural language
FTS finds **words/stems**, ignoring case, punctuation, and stop-words ("the", "a"). Far better than
`LIKE '%word%'` for real text search.
```sql
-- Quick one-off search:
SELECT * FROM articles
WHERE to_tsvector('english', title || ' ' || body) @@ to_tsquery('english', 'database & index');

-- to_tsvector = text → searchable tokens;  to_tsquery = the search terms (& and, | or, ! not)
SELECT to_tsvector('english', 'The databases are running fast');
--> 'databas':2 'fast':5 'run':4   (lowercased, stemmed, stop-words removed)

plainto_tsquery('english', 'running database')  -- user input → AND of terms (safe, no operators)
websearch_to_tsquery('english', '"index scan" or brin')  -- Google-style syntax
```

**The production-grade setup - a stored, indexed `tsvector` column:**
```sql
-- 1) Add a generated column that auto-maintains the search vector (PG 12+)
ALTER TABLE articles ADD COLUMN search tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) STORED;

-- 2) Index it with GIN for fast search
CREATE INDEX idx_articles_search ON articles USING GIN (search);

-- 3) Query it (uses the index)
SELECT id, title,
       ts_rank(search, q) AS relevance
FROM articles, websearch_to_tsquery('english', 'postgres index') q
WHERE search @@ q
ORDER BY relevance DESC
LIMIT 20;

-- Highlight matches in results:
SELECT ts_headline('english', body, websearch_to_tsquery('postgres')) FROM articles WHERE ...;
```
> **Interview line:** "For real text search I use a **generated `tsvector` column + GIN index**, and
> rank with `ts_rank`. `LIKE '%x%'` can't use a normal index and ignores stemming; FTS handles
> language, relevance, and speed."

### 3. Fuzzy / typo-tolerant search (pg_trgm)
For autocomplete, "did you mean", and `LIKE '%term%'` that's actually fast:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Makes LIKE / ILIKE '%...%' index-able! (normal B-Tree can't do leading wildcards)
CREATE INDEX idx_users_name_trgm ON users USING GIN (name gin_trgm_ops);
SELECT * FROM users WHERE name ILIKE '%saeid%';        -- now uses the index

-- Similarity / fuzzy matching (typo tolerance)
SELECT name, similarity(name, 'databse') AS score
FROM products
WHERE name % 'databse'                                 -- % = "similar enough"
ORDER BY score DESC;
```
> **When to use which:** **FTS** for word/document search (language-aware); **pg_trgm** for fuzzy
> matching, typos, and substring `ILIKE`. They solve different problems.

### 4. Setting up partitioning end-to-end
```sql
-- 1) Parent table declares the strategy
CREATE TABLE events (id bigint, created_at timestamptz, payload jsonb)
  PARTITION BY RANGE (created_at);

-- 2) Create child partitions (one per month)
CREATE TABLE events_2024_06 PARTITION OF events FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');
CREATE TABLE events_2024_07 PARTITION OF events FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

-- 3) Index inside partitions (created on parent → applies to all children)
CREATE INDEX ON events (created_at);
CREATE INDEX ON events USING BRIN (created_at);        -- BRIN + partition = time-series combo

-- 4) Querying the parent auto-prunes to the right partition
SELECT * FROM events WHERE created_at >= '2024-07-10';  -- only scans events_2024_07

-- 5) Drop old data INSTANTLY (the killer feature)
DROP TABLE events_2024_06;                              -- vs a slow DELETE
```

### 5. Materialized view for an expensive dashboard
```sql
CREATE MATERIALIZED VIEW sales_by_day AS
SELECT date_trunc('day', created_at) AS day, count(*) AS orders, sum(total) AS revenue
FROM orders GROUP BY 1;

CREATE UNIQUE INDEX ON sales_by_day (day);              -- needed for CONCURRENTLY refresh
REFRESH MATERIALIZED VIEW CONCURRENTLY sales_by_day;    -- update without locking readers
```

### 6. Constraints that enforce business rules
```sql
-- prevent overselling (stock can't go negative)
ALTER TABLE inventory ADD CONSTRAINT qty_nonneg CHECK (qty >= 0);

-- no two bookings overlap for the same room (EXCLUSION constraint + GiST)
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE reservations ADD CONSTRAINT no_overlap
  EXCLUDE USING GIST (room_id WITH =, during WITH &&);  -- && = ranges overlap

-- enum-like allowed values
ALTER TABLE orders ADD CONSTRAINT valid_status CHECK (status IN ('pending','paid','shipped'));
```
> The **EXCLUSION constraint** is a senior-level gem: it lets the database itself guarantee "no
> overlapping reservations" - impossible to express with a normal `UNIQUE` constraint.

### 7. Useful extensions to name-drop
| Extension | Gives you |
|---|---|
| `pg_trgm` | Fuzzy/`ILIKE` search, similarity |
| `pg_stat_statements` | Find your slowest queries (essential for tuning) |
| `postgis` | Real geospatial (distance, polygons, "nearby") |
| `uuid-ossp` / `pgcrypto` | UUID generation, hashing/encryption |
| `btree_gist` | Mix `=` columns into GiST exclusion constraints |
| `hstore` | Simple key-value column type |

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```