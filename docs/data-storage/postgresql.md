# PostgreSQL — Complete Interview Handbook

> A complete, unshortened study guide built from the ground up: simple explanations, real
> examples, optimizations, pros & cons, defaults, full interview Q&A, a MySQL comparison, and the
> newest PostgreSQL features. Nothing omitted.

---

## 1. What is an Object-Relational Database?

In simple words, an **Object-Relational Database Management System (ORDBMS)** like PostgreSQL is a
**hybrid database**. It combines the best of two worlds: it acts like a traditional spreadsheet-style
database, but it also understands complex, real-world "objects" just like modern programming
languages do.

### The "Relational" Part (the traditional base)
At its core it’s a relational database — it stores data in **tables with rows and columns**, much
like an Excel spreadsheet. You have a table for Users, a table for Orders, and you can **link
(relate)** them together. This keeps data organized, secure, and accurate.

### The "Object" Part (the superpower)
In standard relational databases, columns can only hold very basic data types (text, numbers,
dates). If you have complex data, you must chop it up and scatter it across multiple tables.

An object-relational database fixes this. It lets you create your **own custom, complex data types**
and even build **custom functions** right inside the database. It bridges the gap between how
developers write code (using "objects") and how databases store data.

### A quick comparison

| Feature | Standard Relational DB (e.g. MySQL) | Object-Relational DB (e.g. PostgreSQL) |
|---|---|---|
| **Data Types** | Strictly basic (Text, Numbers, Dates). | Basic types **PLUS** complex types (JSON, Geometric points, Arrays). |
| **Customization** | You must use what is built-in. | You can invent your own data types and functions. |
| **Handling complex data** | Requires splitting data across many tables. | Can store complex objects directly in a single column. |

**Why people love PostgreSQL for this:** Imagine you are building a mapping app. A standard database
struggles to understand what a "polygon" or a "geographic coordinate" is. PostgreSQL, because it is
object-relational, can natively understand coordinates, calculate the distance between two points,
and store complex geographic shapes directly in a single cell.

**In short:** it gives you the rock-solid structure of a traditional table-based database, but with
the flexibility to handle complex, modern data without breaking a sweat.

---

## 2. Key Features (explained with a real bookstore example)

Let’s break the key features down using a single real-world example: **building an online
bookstore** (think Amazon) that must handle customers, orders, books, and inventory smoothly.

### 2.1 ACID Transactions (the safety net)
ACID is a set of four rules that guarantees your data never gets corrupted, even if the power goes
out mid-click.

- **Atomicity (All or Nothing):** A customer buys a book. The database must do two things: subtract
  \$20 from their bank account **AND** subtract 1 book from inventory. If the power cuts out exactly
  halfway through, PostgreSQL cancels the whole thing. You never get money taken but no book ordered.
- **Consistency (No Rule-Breaking):** You have a rule that says "inventory cannot be less than 0". If
  two people try to buy the very last copy at the exact same time, the database blocks the second
  sale because it would break the rule.
- **Isolation (No Peeking):** If 10,000 people are buying books at the exact same moment, the database
  processes them so they don't trip over each other. Each purchase feels like it's the only one
  happening.
- **Durability (Saved Forever):** Once the database says "Order Confirmed," that data is written to
  the hard drive. Even if the server gets unplugged a millisecond later, your order is safe.

> **Accuracy note (good to know for interviews):** Durability and crash recovery come from the
> **Write-Ahead Log (WAL)** — before changing the data files, Postgres writes the change to the log
> first. On restart after a crash, Postgres **replays (redoes)** committed changes from the WAL.
> (Technically WAL is a *redo* log; uncommitted work is simply ignored via MVCC, not "undone" from
> the WAL — a subtle point that can impress an interviewer.)

#### How do you actually define that "inventory cannot be less than 0" rule? (and prevent overselling)

This is **two things working together**: a **rule (constraint)** that makes negative inventory
*impossible*, and a **safe write pattern** that makes the rule fire correctly when two buyers race for
the last copy.

**Step 1 — The rule itself: a `CHECK` constraint.** Postgres will reject any row that violates it.
```sql
CREATE TABLE products (
    id        serial PRIMARY KEY,
    name      text,
    inventory integer NOT NULL CHECK (inventory >= 0)   -- ← the rule
);

-- Or add it to an existing table:
ALTER TABLE products ADD CONSTRAINT inventory_non_negative CHECK (inventory >= 0);
```
Now any statement that tries to set `inventory` to `-1` is rejected, and because of **atomicity** the
whole transaction rolls back — the sale fails cleanly:
```
ERROR:  new row for relation "products" violates check constraint "inventory_non_negative"
```

**Step 2 — Make it safe under a race: do the subtraction in ONE atomic statement.** Let the database
do the math, not your app:
```sql
-- SAFE: atomic decrement, guarded by the constraint
UPDATE products SET inventory = inventory - 1 WHERE id = 42;
```
When two buyers hit this at the same moment, Postgres processes the two `UPDATE`s on that row **one
after another** (the second waits for the first to commit):
- Buyer A: `1 → 0` commits
- Buyer B: `0 → -1` → **CHECK fails** → transaction rolled back → "Out of stock"

The constraint catches the loser of the race automatically.

**The unsafe way (a classic bug):** read into the app, do math there, then write back —
```sql
-- both buyers SELECT inventory  → both see "1"
-- both buyers UPDATE ... SET inventory = 0  → you oversell!
```
Here the `CHECK` never even triggers, because neither tried to write a negative number. Always use the
atomic `inventory = inventory - 1` form instead.

**Extra control — refuse the sale when out of stock, and detect it:**
```sql
UPDATE products SET inventory = inventory - 1
WHERE id = 42 AND inventory > 0;
-- If 0 rows were updated → it was out of stock → show "sold out"
```

**When logic is complex, lock the row first** (`SELECT ... FOR UPDATE`) so no one else can touch it
until you commit:
```sql
BEGIN;
  SELECT inventory FROM products WHERE id = 42 FOR UPDATE;  -- others wait here
  -- ... your multi-step logic (validation, etc.) ...
  UPDATE products SET inventory = inventory - 1 WHERE id = 42;
COMMIT;
```

**Other ways to express "a rule" in Postgres:**

| Tool | Use it for | Example |
|---|---|---|
| **`CHECK`** | Simple per-row value rules | `CHECK (inventory >= 0)` |
| **`NOT NULL`** | Field must have a value | `inventory integer NOT NULL` |
| **`UNIQUE`** | No duplicates | `UNIQUE (email)` |
| **`FOREIGN KEY`** | Must reference a valid row | `REFERENCES customers(id)` |
| **`EXCLUDE`** | "No overlapping" rules | no double-booked rooms |
| **`SELECT ... FOR UPDATE`** | Lock a row before complex multi-step logic | bank transfers |
| **Trigger** | Complex rules across tables | log every stock change |

> **Interview-ready answer:** "I'd enforce it with a `CHECK (inventory >= 0)` constraint so negative
> stock is structurally impossible, and I'd do the decrement atomically with
> `UPDATE ... SET inventory = inventory - 1` (or `SELECT ... FOR UPDATE` for complex flows) so
> concurrent buyers can't oversell. The constraint plus MVCC row locking makes the second buyer's
> transaction fail and roll back."

#### Can a `CHECK` use `AND` / `OR`? (yes — and the gotchas)

A `CHECK` constraint can hold almost any boolean expression: **`AND`**, **`OR`**, **`NOT`**,
parentheses, comparisons, `BETWEEN`, `IN`, `LIKE`/regex, `IS NULL`, math, and functions.
```sql
CREATE TABLE products (
    id        serial PRIMARY KEY,
    price     numeric NOT NULL,
    discount  numeric,
    inventory integer,

    CHECK (price > 0 AND inventory >= 0),            -- AND: both must be true
    CHECK (discount IS NULL OR discount < price)     -- OR: at least one must be true
);
```
Combine them with parentheses for richer rules:
```sql
CHECK (
    (status = 'active'  AND ends_at IS NULL)
 OR (status = 'expired' AND ends_at IS NOT NULL)
)
```

**What you can put inside a CHECK:**

| You can use | Example |
|---|---|
| Comparisons | `CHECK (age >= 18)` |
| `AND` / `OR` / `NOT` | `CHECK (a > 0 AND (b = 0 OR c = 0))` |
| `BETWEEN`, `IN` | `CHECK (rating BETWEEN 1 AND 5)`, `CHECK (status IN ('new','paid','shipped'))` |
| `LIKE` / regex | `CHECK (email LIKE '%@%')`, `CHECK (code ~ '^[A-Z]{3}$')` |
| `IS NULL` / `IS NOT NULL` | `CHECK (discount IS NULL OR discount > 0)` |
| Math & functions | `CHECK (char_length(username) >= 3)` |
| Multiple columns | `CHECK (end_date > start_date)` |

**Name the constraint** so violations are readable (`violates check constraint "valid_pricing"`):
```sql
ALTER TABLE products
  ADD CONSTRAINT valid_pricing
  CHECK (price > 0 AND (discount IS NULL OR discount < price));
```

**Three important gotchas:**

1. **NULL makes a CHECK pass, not fail.** A CHECK only rejects a row when the expression evaluates to
   **`FALSE`**. If any part is `NULL` (unknown), the result is `NULL`, which is **treated as passing**.
   ```sql
   CHECK (discount < price)   -- if discount IS NULL → expression is NULL → row is ALLOWED
   ```
   That's why you often write `discount IS NULL OR discount < price`, or add `NOT NULL` separately if
   a value is required.
2. **Single-column vs table-level.** Use the **table-level** form whenever your `AND`/`OR` rule spans
   more than one column:
   ```sql
   price numeric CHECK (price > 0)            -- column constraint (one column only)
   CHECK (price > 0 AND discount < price)     -- table constraint (can reference many columns)
   ```
3. **CHECK must be deterministic & row-local.** It can only look at the **current row's** columns.
   You **cannot** reference other tables/subqueries (`CHECK (qty <= (SELECT ...))`) or use volatile
   functions like `now()`/`random()`. For cross-row or cross-table rules, use a `FOREIGN KEY`, an
   `EXCLUDE` constraint, or a trigger instead.

**Real example tying it together:**
```sql
CREATE TABLE bookings (
    id         serial PRIMARY KEY,
    seats      integer NOT NULL,
    price      numeric NOT NULL,
    coupon     text,
    start_date date,
    end_date   date,

    CONSTRAINT valid_booking CHECK (
        seats > 0
        AND price >= 0
        AND (coupon IS NULL OR char_length(coupon) = 8)
        AND (end_date IS NULL OR end_date >= start_date)
    )
);
```

### 2.2 Rich Data Types & JSON Support
Standard databases only understand simple things like plain text and integers. PostgreSQL understands
**rich data types** — geographic maps, dates with specific time zones, and even entire files.

- **The structure:** For a book you have a solid structure: Title (text), Price (decimal), Publish
  Date (date).
- **JSON Support:** But what about details that change for every book (e.g., some have "Illustrator",
  some have "Translator", some have "Dust jacket color")? Instead of creating 50 empty columns, you
  use a single **JSON column** to store a flexible list of messy, varying details directly in that
  row.

### 2.3 MVCC (Multi-Version Concurrency Control)
Imagine a spreadsheet. If you are editing Row 5, the entire spreadsheet freezes and your coworker has
to wait for you to finish before they can even read it. That would ruin an online bookstore.

MVCC fixes this by taking **snapshots**. If a manager is updating the price of a book from \$20 to
\$25, PostgreSQL doesn't lock the row. Instead, it creates a **new "version"** of that row. While the
manager is busy typing, a customer buying the book at that exact second simply reads the **older
version** (\$20). No one has to wait in line just to look at the screen.

### 2.4 Indexing & Full-Text Search
- **Indexing (the textbook index):** If your bookstore has 10 million books and a customer searches
  for ID #543,211, a normal database scans all 10 million rows top to bottom. An **index** is like
  the index at the back of a textbook — it tells PostgreSQL exactly what page and row that ID lives
  on, speeding searches from seconds to milliseconds.
- **Full-Text Search (Google-like search):** Standard databases can only look for exact matches.
  Full-text search lets a customer type "wizard boy magic" and PostgreSQL is smart enough to handle
  typos, ignore words like "and" or "the", and surface Harry Potter.

### 2.5 Extensibility (custom functions & data types)
You can teach PostgreSQL new tricks it didn't know out of the box.

- **Custom Data Type:** You want to store book dimensions. Instead of saving Width, Height, and Depth
  in three columns, you can invent a brand-new data type called `box_size` that holds all three
  together.
- **Custom Function:** You can write a mini-program directly inside the database. For instance, a
  function `calculate_shipping_cost()` that automatically calculates tax and shipping at checkout —
  without your main website software doing the math.

### Summary Checklist

| Feature | In Plain English | Bookstore Example |
|---|---|---|
| **ACID** | Total data safety; no glitches. | Money isn't stolen if the server crashes mid-purchase. |
| **Rich Data / JSON** | Holds complex or messy data shapes. | Storing a flexible list of book details that change per genre. |
| **MVCC** | People can read while others are writing. | Customers can buy a book even while the price is being edited. |
| **Indexing & FTS** | Super-fast, smart searching. | Finding a book instantly out of millions using a typo-friendly search. |
| **Extensibility** | Teaching the database custom code. | A custom tool that automatically calculates shipping inside the table. |

---

## 3. Is an `UPDATE` really a `DELETE` + `INSERT`?

Yes, it is a fundamental architectural fact of how PostgreSQL handles data — **but with one massive
asterisk called HOT (Heap-Only Tuples).** So: it is **not always** a pure delete-and-insert on disk,
and it **can be highly inefficient** if not managed correctly.

### The base fact: why Postgres does this
Postgres uses **MVCC**. To allow one user to read a row while another modifies it, Postgres cannot
just overwrite the data in place. If you change a user's status from "active" to "banned", Postgres
writes a brand-new row with "banned" (the INSERT step) and flags the old row containing "active" as
"dead" so future queries ignore it (the DELETE step).

### Is it always like this? Enter "HOT Updates"
If Postgres literally performed a full separate delete and insert for every update — writing the new
row to a far-away page and updating every index — it would be incredibly slow. To fix this, Postgres
uses a brilliant optimization called **HOT (Heap-Only Tuples).**

> **First, kill the #1 misconception: HOT is NOT "in-place changing."** An `UPDATE` in Postgres
> **always** writes a brand-new row version — it **never** overwrites the old row in place, not even
> with HOT (that would break MVCC, since other transactions still need the old version). The old row
> always stays as a dead tuple until VACUUM. **HOT does not change that.**

**So what does HOT actually change? Just two things:** (1) **where** the new row version is written,
and (2) **whether the indexes get touched.** That's it.

**Without HOT (the expensive case):** the new version lands on a **different page**, and **every
index** must be updated to point to its new location.
```
PAGE 5                          PAGE 9
+------------------+            +------------------+
| old row (dead) X |            | NEW row (live) V |  <- new version goes here
+------------------+            +------------------+
        ^                                ^
        |                                |
   index used to                  index now must
   point here ...   --updated-->   point here
   (EVERY index on the table gets a new entry = write amplification + bloat)
```

**With HOT (the cheap case):** the new version is written on the **same page** (because there was free
space), and the old tuple keeps a tiny **pointer** to the new one (a "HOT chain"). **The indexes are
never touched** — they still point at the old slot, and Postgres just *follows the pointer* on that
same page to find the live version.
```
PAGE 5 (same page!)
+------------------------------------+
| old row (dead) X --+               |
|                    +--> NEW row V  |   <- new version, same page
+------------------------------------+
        ^
        |
   index STILL points here -- never updated!
   Postgres follows the in-page pointer to reach the live row.
```

**Now the two conditions make sense. HOT happens ONLY IF:**

1. **No indexed column changed.** The indexes are still "correct" pointing at the old slot, so Postgres
   is *allowed* to skip updating them. (If you change an indexed column, the index value itself is now
   wrong and **must** be updated → no HOT possible.)
2. **There is room on the same page.** The new version must physically fit next to the old one. (If the
   page is full, the new version goes to another page → indexes must point there → no HOT possible.)
   You reserve this free space with the table's **`fillfactor`** setting (e.g., 85–90%).

| | Non-HOT update | HOT update |
|---|---|---|
| New row version created? | Yes | Yes (still!) |
| Old row overwritten in place? | No | No |
| New version location | possibly another page | **same page** |
| Indexes updated? | every index (slow, bloat) | **none** (fast) |
| Old version cleaned by | VACUUM | VACUUM |

> **One-line interview answer:** "HOT doesn't update in place — Postgres still writes a new row
> version. The win is that the new version goes on the **same page** and the old tuple **points** to
> it, so **none of the indexes need updating**. It's possible only when no indexed column changes and
> the page has free room (which you reserve via `fillfactor`)." In short: **HOT = "new version, same
> page, skip the index updates"** — not in-place editing.

### Is it efficient?
It depends entirely on your database design.

- **Highly INEFFICIENT (the trap):** If you frequently update columns that have indexes on them,
  Postgres cannot use HOT.
  - **Index Bloat:** Postgres must go to **every single index** on that table and insert a new
    pointer to the new row location.
  - **Table Bloat:** The old rows ("dead tuples") stay on disk taking up space until **VACUUM** cleans
    them up. If you update thousands of rows a second, your database size skyrockets rapidly.
- **EFFICIENT:** If you keep indexes lean and configure your table's **`fillfactor`** correctly
  (telling Postgres to leave, say, 10% of every page empty specifically to give HOT updates room to
  breathe), Postgres handles updates beautifully with minimal overhead.

### Summary
- **Is it a fact?** Yes. Conceptually and architecturally, an `UPDATE` is always a `DELETE` + `INSERT`
  to maintain MVCC.
- **Is it always true on disk?** No. If a HOT update triggers, Postgres optimizes it heavily on the
  physical layer so it doesn't touch the indexes.
- **Is it efficient?** Highly efficient for read-heavy workloads (readers never block writers), but it
  requires careful indexing strategies to stay efficient for write-heavy workloads.

---

## 4. Indexing — every type, with pros, cons & best practices

Indexes turn slow, painful disk searches into lightning-fast queries. But they aren't magic — they
are physical data structures that take up space and slow down writes.

### 4.1 B-Tree Index (the default workhorse)
If you don't specify an index type (e.g. `CREATE INDEX ON users (email);`), Postgres defaults to a
B-Tree. It sorts data into a balanced tree, allowing rapid logarithmic search (note: a B-Tree, not a
binary tree — see the box below).

- **Best Used For:** Equal matches (`=`), range queries (`>`, `<`, `BETWEEN`), and sorting (`ORDER BY`).
- **Pros:** Highly optimized, extremely reliable, handles almost all standard queries.
- **Cons:** Can become massive (bloat) if indexed on large or frequently updated text columns.
- **Example:** Searching for a user by exact ID, email, or filtering orders placed between January
  and March.

```sql
-- Create a B-Tree index (the default — USING BTREE is optional)
CREATE INDEX idx_users_email ON users (email);

-- Queries that use it: equality, ranges, and sorting
SELECT * FROM users WHERE email = 'sam@x.com';
SELECT * FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-03-31'
ORDER BY created_at;
```

> **Important: a B-Tree is NOT a binary tree!** A common confusion. The "B" means **Balanced**
> (not "Binary"). A binary tree has **2 children per node and 1 key per node**; a **B-Tree is a
> balanced _m-way_ tree** where **each node is a disk page (8 KB) holding hundreds of keys**, so it
> has many children per node.
>
> | | Binary tree (BST/AVL/Red-Black) | **B-Tree (Postgres)** |
> |---|---|---|
> | Children / node | 2 | **many (hundreds)** |
> | Keys / node | 1 | **many (a full page)** |
> | Depth for 1M rows | ~20 levels | **~2–3 levels** |
> | Built for | in-memory data | **disk/block storage** |
>
> **Why databases use B-Trees, not binary trees:** it's all about **disk I/O**. Disks read in 8 KB
> pages, and each read is expensive. A binary tree (1 key/node) would need ~20 disk reads to find a
> row in a million; a B-Tree packs hundreds of keys per page, staying **wide and shallow** so it
> reaches any row in just **2–3 page reads**. Postgres actually uses a **B+‑tree** variant: all row
> pointers live in the **leaf** nodes, and the leaves are **linked together** in a doubly-linked list,
> which is what makes range scans (`BETWEEN`, `ORDER BY`) fast — you just walk the linked leaves.
>
> **Interview line:** "Postgres's default index is a **B-Tree, not a binary tree** — a balanced
> *m-way* tree where each node is a disk page of many keys, so it's only 2–3 levels deep. That
> minimizes **disk reads**, which a 20-level-deep binary tree would not."

### 4.2 BRIN Index (Block Range Index)
Designed for massive, multi-gigabyte tables where data is **naturally sorted on disk** as inserted
(usually by time or incremental IDs). Instead of indexing every row, BRIN stores just the **min and
max values for a "block"** (page range) of data.

- **Best Used For:** Huge append-only tables (logs, clickstreams, IoT sensor data) queried by
  date/time ranges.
- **Pros:** Incredibly tiny — up to **99% smaller** than a B-Tree, saving massive RAM and disk.
- **Cons:** Only works if physical data on disk is physically ordered. If you resort or randomly
  update rows, BRIN becomes useless.
- **Example:** A `system_logs` table sorted by `created_at` where you query data by specific days.

```sql
-- Create a BRIN index on the time-ordered column
CREATE INDEX idx_logs_created_brin ON system_logs USING BRIN (created_at);

-- Query that uses it: a date range on the huge, naturally-ordered table
SELECT * FROM system_logs
WHERE created_at >= '2024-02-10' AND created_at < '2024-02-11';
```

> **Don't confuse BRIN with partitioning or pagination — three different things!** The names
> get mixed up, but:
>
> | Term | What it actually is |
> |---|---|
> | **BRIN** | An **index type** — stores min/max per *block range*, for huge naturally-ordered tables |
> | **Partitioning** | **Splitting one big table into smaller physical sub-tables** (a table-design feature) |
> | **Pagination** | **Returning query results in pages** to the user (`LIMIT`/keyset) — a query technique |
>
> The "R" in BRIN is **Range** as in *block range* (a group of adjacent disk pages), **not** table
> partitioning. (See §4.8 and §4.9 below for partitioning and pagination.)
>
> **How BRIN works visually** — it stores one tiny min/max summary per block range:
> ```
> Table on disk (physically ordered by date):
>   Block range 1 (pages 1–128):   min=2024-01-01, max=2024-01-15
>   Block range 2 (pages 129–256): min=2024-01-15, max=2024-01-31
>   Block range 3 (pages 257–384): min=2024-02-01, max=2024-02-14
> ```
> Query `WHERE created_at = '2024-02-10'` → only range 3 *could* match → skip all other blocks.
>
> **Interview line:** "BRIN stores the min/max value per block range instead of per row, so it's
> 1000× smaller than a B-Tree — but it only helps when the table is **physically ordered on disk** by
> the indexed column, like timestamps in an append-only log."

### 4.3 GIN Index (Generalized Inverted Index)
Think of a GIN index like the index at the back of a textbook — look up "database" and it points you
to pages 12, 45, 89. GIN splits composite data into individual components and indexes those.

- **Best Used For:** Searching inside complex data such as arrays, JSONB documents, or full-text
  search tokens.
- **Pros:** Instantly finds rows where a JSON document contains a specific key/value pair or an array
  contains a specific item.
- **Cons:** Very slow and expensive to update during `INSERT`/`UPDATE` because it modifies multiple
  pointers.
- **Example:** Searching inside a JSONB column to find all users with the preference
  `{"theme": "dark"}`.

```sql
-- JSONB: index the whole document, then search with the @> "contains" operator
CREATE INDEX idx_users_prefs_gin ON users USING GIN (prefs);
SELECT * FROM users WHERE prefs @> '{"theme": "dark"}';

-- Array column: find rows whose tags array contains 'sql'
CREATE INDEX idx_posts_tags_gin ON posts USING GIN (tags);
SELECT * FROM posts WHERE tags @> ARRAY['sql'];
```

### 4.4 GiST & SP-GiST Indexes (Generalized Search Tree)
Used when your data **cannot be simply sorted** from "less than" to "greater than." Builds a tree out
of abstract, geometric, or hierarchical data shapes.

- **Best Used For:** Geographic shapes (coordinates, polygons), range types (IP ranges, scheduling
  intervals), and full-text search.
- **Pros:** Natively understands spatial relationships like "is next to", "overlaps with", "contains".
- **Cons:** Slower to build and search than standard B-Trees.
- **Example:** Finding all restaurants within a 5-mile radius of a user's latitude/longitude using
  the PostGIS extension.

```sql
-- Geospatial: index a geometry/geography column, then query "nearby"
CREATE INDEX idx_places_geom_gist ON places USING GIST (location);
SELECT name FROM places
WHERE ST_DWithin(location, ST_MakePoint(-122.4, 37.8)::geography, 8047);  -- ~5 miles

-- Range type: prevent overlapping reservations for the same room
CREATE INDEX idx_resv_during_gist ON reservations USING GIST (during);
SELECT * FROM reservations WHERE during && tstzrange('2024-06-01','2024-06-03');  -- && = overlaps
```

### 4.5 Hash Index
Runs your column data through a hash function to generate a shorthand key.

- **Best Used For:** Strictly exact matches (`=`).
- **Pros:** Slightly faster than B-Trees for exact equality lookups.
- **Cons:** Cannot handle range queries (`>`) or sorting. Historically lacked crash-safety (fixed in
  Postgres 10). Still, B-Trees are generally preferred.
- **Example:** Checking if an MD5 string token exactly matches a token in your database.

```sql
-- Hash: only equality (=), no ranges or sorting
CREATE INDEX idx_sessions_token_hash ON sessions USING HASH (token);
SELECT * FROM sessions WHERE token = 'a1b2c3d4e5f6';
```

### 4.6 Advanced Indexing Strategies (best practices)
To truly master indexing, rarely just use basic single-column indexes. Use these three strategies:

**A. Partial Indexes (the space saver)** — If you frequently query only a subset of rows, only index
rows that match a `WHERE` clause.
```sql
CREATE INDEX idx_unprocessed_orders ON orders (created_at) WHERE status = 'pending';
```
**Why:** The index stays tiny and fast because it ignores the millions of 'completed' orders.

**B. Covering Indexes (`INCLUDE` clause)** — Bake extra data directly into the index leaf nodes.
```sql
CREATE INDEX idx_user_email ON users (email) INCLUDE (username);
```
**Why:** `SELECT username FROM users WHERE email = 'x'` is answered entirely from the index — never
touching the main table ("Index-Only Scan"). (Full deep dive in §5.)

**C. Multi-Column (Composite) Indexes** — If queries filter by multiple columns together (e.g.
`WHERE last_name = 'Smith' AND first_name = 'John'`), a composite index on `(last_name, first_name)`
is very efficient.
> **Crucial Rule — Order matters!** Postgres can use this index if you search by `last_name` alone,
> but **not** efficiently if you search by `first_name` alone. Put the most frequently filtered or
> highest-cardinality column first.

### 4.7 The Golden Rules of Production Indexing
1. **Never build indexes in production with a standard `CREATE INDEX`.** It locks the table,
   preventing writes. Always use **`CREATE INDEX CONCURRENTLY`** — slower to build, but no lockout.
2. **Monitor for unused indexes.** Every index slows down `INSERT`/`UPDATE`/`DELETE`. Use system
   views like `pg_stat_user_indexes` to find indexes where `idx_scan = 0` and drop them.
3. **Watch out for functional indexes.** An index on `email` is ignored by
   `WHERE LOWER(email) = 'user@test.com'`. You must index the function itself:
   `CREATE INDEX ON users (LOWER(email));`.

### 4.8 Partitioning (splitting one big table into smaller sub-tables)

**What it is:** Partitioning breaks **one logical table** into many smaller **physical sub-tables
(partitions)** behind the scenes. You still query the one "parent" table; Postgres automatically routes
rows to the right partition and — crucially — **skips irrelevant partitions when querying** ("partition
pruning").

> **Partitioning ≠ BRIN ≠ sharding.** Partitioning splits a table across sub-tables **on the same
> server**. *Sharding* splits data across **different servers/machines**. BRIN is just an *index type*.

**The three types of partitioning:**

| Type | How rows are split | Best for |
|---|---|---|
| **Range** | By a value range (e.g., one partition per month) | Time-series, logs, anything by date |
| **List** | By a discrete value (e.g., one partition per country/region) | Categorical data |
| **Hash** | By a hash of the key (even spread) | Spreading load evenly when there's no natural range |

**Example — range partitioning by month:**
```sql
CREATE TABLE orders (
    id bigint, created_at timestamptz, amount numeric
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2024_01 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE orders_2024_02 PARTITION OF orders
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
```
Now `SELECT * FROM orders WHERE created_at >= '2024-02-10'` only scans `orders_2024_02` — the rest are
**pruned** (never touched).

- **Pros:** Queries scan far less data; you can **drop a whole month instantly** (`DROP TABLE
  orders_2024_01`) instead of a slow mass `DELETE`; maintenance (VACUUM, indexes) runs per-partition;
  smaller indexes per partition.
- **Cons:** More objects to manage; the **partition key must be in your queries** to get pruning;
  `UNIQUE` constraints must include the partition key; over-partitioning hurts planning time.
- **Interview line:** "Partitioning gives **partition pruning** (skip irrelevant sub-tables) and
  **cheap data lifecycle** — dropping an old partition is instant versus a huge `DELETE`. The golden
  rule is to query on the partition key, or pruning can't kick in."

> **BRIN + partitioning combo:** these two are a classic pairing for time-series — partition by month
> *and* put a BRIN index on `created_at` inside each partition. Both rely on data being time-ordered.

### 4.9 Pagination (returning results in pages) — OFFSET vs Keyset

**What it is:** Showing query results a page at a time (page 1, page 2…) instead of all at once. This
is a **query technique**, not storage — unrelated to BRIN or partitioning.

**Two ways to do it:**

**1. OFFSET/LIMIT pagination (the simple, common way):**
```sql
SELECT * FROM products ORDER BY created_at DESC
LIMIT 20 OFFSET 40;   -- page 3 (skip 40, take 20)
```
- **Pros:** Dead simple; can jump to any page number.
- **Cons:** **Gets slower as you go deeper.** `OFFSET 1000000` makes Postgres read and throw away
  1,000,000 rows first. Also, if rows are inserted/deleted between page loads, items can **shift,
  duplicate, or be skipped**.

**2. Keyset / "cursor" pagination (the scalable way):**
```sql
-- first page
SELECT * FROM products ORDER BY id DESC LIMIT 20;
-- next page: remember the last id you saw (e.g. 8801) and continue AFTER it
SELECT * FROM products WHERE id < 8801 ORDER BY id DESC LIMIT 20;
```
- **Pros:** **Constant speed at any depth** — it uses the index to jump straight to where you left off
  (no rows thrown away). Stable even as data changes. This is how "infinite scroll" feeds work.
- **Cons:** Can't jump to an arbitrary page number (only next/previous); needs a stable, unique
  `ORDER BY` column (usually an indexed `id` or `created_at, id`).

| | OFFSET/LIMIT | **Keyset (cursor)** |
|---|---|---|
| Speed at page 1 | Fast | Fast |
| Speed at page 100,000 | **Very slow** | **Still fast** |
| Jump to arbitrary page | Yes | No (next/prev only) |
| Stable when data changes | Can skip/duplicate | Stable |
| Best for | Small datasets, admin tables with page numbers | Large datasets, APIs, infinite scroll |

> **Interview line:** "For deep pagination at scale, avoid `OFFSET` — it scans and discards every
> skipped row. Use **keyset pagination**: `WHERE id < :last_seen ORDER BY id LIMIT n`, which uses the
> index to resume in constant time. The trade-off is you lose 'jump to page N'."

---

## 5. Covering Indexes (the `INCLUDE` clause) — deep dive

To understand why covering indexes are a game-changer, picture your table as a **giant library**, and
your index as the **library catalog card system.**

### The standard way (without `INCLUDE`)
With a standard index on just the `email` column:
```sql
CREATE INDEX idx_user_email ON users (email);
```
Running:
```sql
SELECT username FROM users WHERE email = 'alice@email.com';
```
Postgres does a **two-step dance:**
1. **Index Scan:** Goes to the index, flips to "alice@email.com", finds it. But the index only holds
   the email and a **physical address** to the actual row (a TID / Tuple ID). It doesn't know Alice's
   username.
2. **Heap Fetch / Table Scan:** Postgres takes that physical address, jumps to the main table (the
   "Heap"), opens that row, grabs the username ("Alice123"), and hands it back.

**The problem:** Jumps to the main table disk space are expensive and slow, especially when fetching
hundreds of rows.

### The covering index way (with `INCLUDE`)
```sql
CREATE INDEX idx_user_email ON users (email) INCLUDE (username);
```
You are telling Postgres: "Build a B-Tree sorted by `email`, but at the very bottom level (the leaf
nodes), glue a copy of the `username` right next to it." Now the same query finds "alice@email.com"
and the username is **already sitting right there inside the index.** Postgres completely **skips
Step 2** and never touches the main table. This is an **Index-Only Scan** — incredibly fast because
it cuts the physical disk work in half.

### Why not just a composite index on `(email, username)`?
There's a huge structural difference between **key columns** and **`INCLUDE` columns:**

- **Composite Index `(email, username)`:** Postgres sorts by `email` first, then by `username`.
  Because it must sort by both, maintaining this index on every `INSERT`/`UPDATE` takes a lot of CPU
  and structural overhead.
- **Covering Index `email INCLUDE (username)`:** Postgres only sorts by `email`. The `username` is
  just **dead-weight payload** tagged along at the end. It doesn't affect the tree structure or
  sorting logic, making it **much cheaper to maintain.**

### When should you use this? (best practices)
Covering indexes are a specialized tool — use them when you have a specific, high-frequency query you
need to optimize to the absolute maximum.

- **Great Use Case:** A login system. You constantly run `SELECT id, password_hash FROM users WHERE
  email = $1;`. A covering index on `email INCLUDE (id, password_hash)` makes logins blindingly fast.
- **Bad Use Case:** Including too many columns. `INCLUDE (username, bio, profile_picture_url, age)`
  makes the index massive and bloated, wiping out any gains by eating your RAM.
- **Rule of Thumb:** Only `INCLUDE` small columns (IDs, dates, short strings) that are queried
  constantly alongside your primary search column.

---

## 6. Three hidden behaviors every developer trips over

### 6.1 `EXPLAIN ANALYZE` (your X-ray vision)
You can build the most perfect indexes in the world, but Postgres can still choose to ignore them.
How do you know what it's actually doing? Paste `EXPLAIN ANALYZE` right before your query and Postgres
gives a step-by-step roadmap of exactly how it retrieved the data.
```sql
EXPLAIN ANALYZE SELECT username FROM users WHERE email = 'test@email.com';
```
It tells you things like:
- **Sequential Scan (Seq Scan):** Bad news. Postgres ignored your indexes and read every row on disk.
- **Index Scan:** Good news. It used your index to jump right to the row.
- **Index-Only Scan:** Best news! It used your covering index and skipped touching the main table
  entirely.

> **Tricky interview detail:** A standard `EXPLAIN` just **guesses** based on statistics.
> `EXPLAIN ANALYZE` **actually runs** the query, measures the exact milliseconds, and tells you what
> happened. Never optimize a slow query without running `EXPLAIN ANALYZE` first.

### 6.2 The Statistics Collector (why indexes get ignored)
Why would Postgres ignore a perfectly good index? Because it uses a **Cost-Based Optimizer.** A
background process constantly takes notes on your tables (e.g., "Table X has 1,000 rows, 90% with
status 'active'"). When you run a query, Postgres does a quick math equation to decide if using an
index is faster than reading the whole table.

- **The Small Table Trap:** If your table has only 200 rows, Postgres will completely ignore your
  index — it's physically faster to read 200 rows in one quick sweep (Sequential Scan) than to open
  an index file, look up the address, and jump back to the table file.
- **Stale Stats:** If you suddenly insert 5 million rows into an empty table, Postgres might still
  think the table is empty and use a slow sequential scan. Fix it by running **`ANALYZE users;`**,
  forcing Postgres to update its notes.

### 6.3 Connection Pooling (the silent bottleneck)
In Postgres, **every single user connection is a separate operating system process.** If your app
suddenly gets popular and 1,000 users connect directly at the same time, the server spawns 1,000
heavy processes — instantly maxing out RAM and CPU and crashing the database.

- **The Solution:** You should almost never connect your backend directly to Postgres in production.
  Use a **Connection Pooler** (like **PgBouncer** or **Supavisor**).
- **How it works:** The pooler sits between your app and Postgres. Your app opens 1,000 "fake"
  connections to the pooler, but the pooler routes them through just 20–30 "real", highly optimized
  connections to Postgres, sharing them dynamically — keeping the database fast and stable.

### Summary Checklist for a Production-Ready Postgres Application
- Always use **JSONB** instead of plain JSON for rapid read performance and indexing.
- Always use **`CREATE INDEX CONCURRENTLY`** so you don't lock tables and freeze your app.
- Put a **Connection Pooler** (like PgBouncer) in front of Postgres before launching to handle spikes.
- Run **`EXPLAIN ANALYZE`** on any query taking more than a few milliseconds to find the bottleneck.

---

## 7. Locking in PostgreSQL — every level & type

Locking is how Postgres ensures data integrity when multiple users try to modify the same data at the
same time. Think of it like a reservation system: if you are editing data, Postgres "locks the door"
so no one else can overwrite your changes or read half-finished data. There are three categories:
**Table-level**, **Row-level**, and **Advisory** locks.

### Part 1: The 8 Table-Level Lock Modes
Listed from least restrictive to most restrictive. General rule: low-numbered locks can run at the
same time as other low-numbered locks; high-numbered locks block almost everything below them.

**Level 1 — `ACCESS SHARE`** — Automatically requested by any read-only query.
- **Triggered By:** `SELECT`
- **Pros:** Maximum concurrency. Millions of users can view the same table simultaneously.
- **Cons:** None for reading, but it blocks Level 8 operations (like dropping a table) until reads
  finish.

**Level 2 — `ROW SHARE`** — Requested when you intend to update rows but haven't changed them yet.
- **Triggered By:** `SELECT ... FOR UPDATE` or `SELECT ... FOR SHARE`
- **Pros:** Locks specific target rows while leaving the rest of the table wide open for reads/writes.
- **Cons:** Slower than a standard select because it must log row reservations.

**Level 3 — `ROW EXCLUSIVE`** — The standard write lock, requested when modifying data.
- **Triggered By:** `INSERT`, `UPDATE`, `DELETE`
- **Pros:** Highly efficient. Allows concurrent writes on different rows, and never blocks readers.
- **Cons:** Blocks table alterations (Level 5–8) like adding a column while data is actively written.

**Level 4 — `SHARE UPDATE EXCLUSIVE`** — Protective lock for background maintenance & non-destructive
schema changes.
- **Triggered By:** `VACUUM` (without FULL), `ANALYZE`, `CREATE INDEX CONCURRENTLY`,
  `ALTER TABLE VALIDATE CONSTRAINT`
- **Pros:** Allows normal `SELECT`/`INSERT`/`UPDATE`/`DELETE` to run uninterrupted while the database
  maintains itself.
- **Cons:** Only one maintenance task at a time; blocks other Level 4 locks (e.g., can't run two
  `VACUUM`s on the same table simultaneously).

**Level 5 — `SHARE`** — A stricter read lock that prevents anyone from changing any data.
- **Triggered By:** `CREATE INDEX` (standard, non-concurrent)
- **Pros:** Guarantees data stays 100% frozen while building an index, ensuring perfect accuracy.
- **Cons:** Completely blocks `INSERT`/`UPDATE`/`DELETE`. Your write traffic queues up and likely
  times out.

**Level 6 — `SHARE ROW EXCLUSIVE`** — Like Level 5 but exclusive against itself and Level 4.
- **Triggered By:** Certain rare forms of `ALTER TABLE` or explicit manual triggers.
- **Pros:** Prevents concurrent data modifications and background maintenance simultaneously.
- **Cons:** Rarely used explicitly; highly restrictive to write traffic.

**Level 7 — `EXCLUSIVE`** — Blocks data modification and concurrent reads via specialized tools.
- **Triggered By:** Explicit `LOCK TABLE ... IN EXCLUSIVE MODE` commands.
- **Pros:** Allows standard `SELECT` reads, but completely blocks all writes and concurrent index
  builds.
- **Cons:** Shuts down all application data inputs.

**Level 8 — `ACCESS EXCLUSIVE` (the "nuclear" lock)** — The most restrictive lock possible; completely
isolates the table.
- **Triggered By:** `DROP TABLE`, `ALTER TABLE` (adding/dropping columns, changing data types),
  `VACUUM FULL`, `TRUNCATE`.
- **Pros:** Absolute safety for structural alterations. Guarantees no query reads/writes corrupted
  structural formats.
- **Cons:** **Total application downtime** for that table. It blocks even basic `SELECT` statements.
  If a Level 8 lock takes 10 seconds, your app spins and throws 504 gateway timeouts for 10 seconds.

### Part 2: The 4 Row-Level Lock Modes
When rows are modified, Postgres locks individual tuples (rows) to prevent concurrent corruption.

**1. `FOR UPDATE` (Exclusive Write Lock)**
- **Behavior:** Completely locks the row for both updates and deletes.
- **Pros:** Safest lock for financial transactions. Guarantees nobody else can touch this row until
  you're done.
- **Cons:** Heavy performance penalty. If multiple users hit the same row (shared inventory item),
  they must wait sequentially in a queue.

**2. `FOR NO KEY UPDATE` (Weaker Exclusive Lock)**
- **Behavior:** Locks the row for modification, unless the modification changes a primary/foreign key
  column.
- **Pros:** This is what standard `UPDATE` statements use under the hood. It allows HOT updates and
  optimizes indexing speed.
- **Cons:** Can still cause transaction blocking if two queries target the exact same row.

**3. `FOR SHARE` (Shared Read Lock)**
- **Behavior:** Multiple transactions can hold a `FOR SHARE` lock on the same row. It prevents anyone
  from deleting or updating the row, but anyone can read it.
- **Pros:** Excellent for foreign-key integrity (e.g., ensuring a Parent record isn't deleted while
  you insert a Child record linked to it).
- **Cons:** If a transaction holding a `FOR SHARE` lock decides it needs to upgrade to a write lock,
  it frequently triggers immediate deadlocks.

**4. `FOR KEY SHARE`**
- **Behavior:** A weaker version of `FOR SHARE`. Allows other transactions to update the row, provided
  they don't change the key columns (like the ID).
- **Pros:** Minimizes blocking. Validates foreign keys without preventing unrelated data updates.
- **Cons:** Requires precise architectural understanding; rarely called manually by developers.

### Part 3: Advisory Locks (application-level control)
What if you want to lock something that **isn't** a table or row? For example, you want your
background email worker to run only one instance across 5 servers. Postgres provides **Advisory
Locks** for this.

**How it works:** You invent an arbitrary number (e.g. 42). You tell Postgres
`SELECT pg_advisory_lock(42);`. Postgres checks if any other connection has claimed the number 42.
If not, it grants the lock. It has **no effect on your tables**; it is purely a flag for your
application logic.

- **Pros:**
  - **No Database Bloat:** It doesn't write to tables, create dead tuples, or trigger VACUUM. It lives
    entirely in the server's shared memory.
  - **Replaces Redis/ZooKeeper:** You don't need a separate distributed locking tool like Redis
    Redlock if you already have Postgres.
- **Cons:**
  - **Manual Responsibility:** Postgres won't automatically clean up "Session-level" advisory locks.
    If your app crashes without calling `pg_advisory_unlock(42);`, that lock stays active until the
    connection is forcefully killed.

### The Master Matrix: What Blocks What?

| Current Lock held on Table | Can someone `SELECT`? | Can someone `INSERT`/`UPDATE`? | Can someone `ALTER`/`DROP`? |
|---|---|---|---|
| `ACCESS SHARE` (Select) | YES | YES | NO (Blocks till Select ends) |
| `ROW EXCLUSIVE` (Update) | YES | YES (Different rows) | NO |
| `ACCESS EXCLUSIVE` (Alter) | NO | NO | NO |

### Production Best Practices for Locking

**A. Keep transactions short.** Locks are only released when a transaction ends (`COMMIT`/`ROLLBACK`).
If your code opens a transaction, updates a row, then makes a slow API call to Stripe that takes 5
seconds, that row stays locked for 5 seconds.
> **Rule:** Never do network calls or heavy processing inside a database transaction. Get in, update,
> get out.

**B. Use `NOWAIT` or `SKIP LOCKED`.**
- `FOR UPDATE NOWAIT`: "Try to lock this row. If someone else is using it, crash immediately with an
  error instead of making my user wait."
- `FOR UPDATE SKIP LOCKED` (perfect for background queues): If multiple background workers grab tasks,
  worker #2 should ignore tasks worker #1 is already processing. `SKIP LOCKED` jumps over locked rows
  and finds the next free one.

**C. Always update in the same order.** To completely prevent deadlocks, ensure your code always
updates rows in the exact same sequential order (e.g., always update the lowest `user_id` first). If
both Transaction A and B lock Alice first, one simply waits in line behind the other — entirely
avoiding a deadlock.

---

## 8. Storing Arrays and Polygons

Storing complex data types like arrays and geometric polygons is remarkably straightforward — they're
built right into the core system, no plugins needed.

### 8.1 Storing Arrays (e.g., e-commerce tags)
Define an array column by adding square brackets `[]` to the end of the data type (e.g., `text[]`,
`integer[]`).
```sql
-- 1. Create the table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    tags TEXT[] -- This defines an array of text
);

-- 2. Insert data using the ARRAY[...] syntax
INSERT INTO products (name, tags)
VALUES ('Running Shoes', ARRAY['sports', 'footwear', 'sale']);

-- 3. Alternative insert format (using string literals)
INSERT INTO products (name, tags)
VALUES ('Winter Jacket', '{"clothing", "winter", "heavy"}');
```
**How to query arrays:**
```sql
-- Find all products that have the tag 'sports' (@> containment operator)
SELECT * FROM products WHERE tags @> ARRAY['sports'];

-- Grab a specific item by index (1-based index)
SELECT name, tags[1] FROM products;
```

### 8.2 Storing Polygons (e.g., delivery zones)
A polygon is stored as a series of connected coordinates `(x,y)` that close back on themselves. The
format is `'((x1,y1), (x2,y2), (x3,y3), ...)'`.
```sql
-- 1. Create the table
CREATE TABLE restaurants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    delivery_zone POLYGON -- Native geometric type
);

-- 2. Insert a square delivery zone
-- Coordinates: Top-Left (0,10), Top-Right (10,10), Bottom-Right (10,0), Bottom-Left (0,0)
INSERT INTO restaurants (name, delivery_zone)
VALUES ('Downtown Pizza', '((0,10), (10,10), (10,0), (0,0))');
```
**How to query polygons:**
```sql
-- Check if a point is inside a polygon (@> operator)
-- If a customer drops a pin at (5,5), are they inside the delivery zone?
SELECT name FROM restaurants
WHERE delivery_zone @> point(5,5); -- Returns 'Downtown Pizza'

-- Check if two delivery zones overlap (&& operator)
SELECT * FROM restaurants
WHERE delivery_zone && polygon '((9,9), (15,15), (15,9), (9,9))';
```

> **Pro-Tip — Going advanced with PostGIS:** The native `polygon` type is great for simple flat-grid
> coordinates and basic shapes. But for a real-world mapping app (like Uber or Google Maps) dealing
> with real GPS latitudes/longitudes on the curved surface of the Earth, activate the **PostGIS**
> extension:
> ```sql
> CREATE EXTENSION postgis;
> -- Now you can use GEOMETRY types that map to real GPS coordinates
> CREATE TABLE stores (
>     name VARCHAR(100),
>     boundary GEOMETRY(Polygon, 4326) -- 4326 is the standard GPS format
> );
> ```

---

## 9. Advanced Interview Questions & Answers (no gaps)

### Q1: The "hidden" data bloat (MVCC & Vacuum)
**Question:** "You have a table with 10 million rows. You run an `UPDATE` that changes a single boolean
flag column from false to true across all 10 million rows. What happens to the physical size of the
database on disk immediately after that query completes? How does MVCC factor into this?"

**The Trap:** Candidates often think an `UPDATE` modifies data in place, so the size shouldn't change.

**The Answer:** The table size on disk will **roughly double instantly.** Because of MVCC, Postgres
does not modify rows in place — an `UPDATE` is a `DELETE` followed by an `INSERT`. Postgres marks all
10 million old rows as "dead tuples" (invisible to new transactions but still occupying disk) and
writes 10 million brand-new versions. The disk space won't be freed until **VACUUM** runs, and even
then standard VACUUM only marks that space as **reusable for future Postgres data** — it doesn't
return the space to your operating system.

### Q2: The unused index trap (HOT Updates)
**Question:** "You added a B-Tree index to a highly updated column to speed up queries, but write
performance slowed drastically. However, indexing a rarely-updated column barely changed write speeds.
Why do updates on indexed columns hurt performance so much more in Postgres?"

**The Trap:** Assuming all indexes add the same write overhead.

**The Answer:** It comes down to **HOT (Heap-Only Tuples)** optimization. When you update a row and
the indexed column **doesn't change**, Postgres can often store the new row on the same data page and
have the old row point directly to it — the index doesn't need to change (a **HOT update**). But if
you update a column that **is indexed**, Postgres cannot use HOT. It is forced to create a brand-new
entry in **every single index** on that table, pointing to the new row location — causing massive
write amplification and index bloat.

### Q3: The BRIN index vs. B-Tree choice
**Question:** "You have a logs table that grows by 50 GB every day. Data is inserted in chronological
order by a `created_at` timestamp. Most queries look for data within specific date ranges. Why is a
standard B-Tree a poor choice, and what should you use instead?"

**The Trap:** Automatically reaching for a standard B-Tree for every query requirement.

**The Answer:** Use a **BRIN (Block Range Index).** Because the log data is inserted in physical order
of time, a BRIN index doesn't map individual rows — it stores the **minimum and maximum timestamp for
each block** of data (e.g., every 1MB). When querying for a date, Postgres checks the BRIN map to see
which blocks could contain that date and skips the rest. A BRIN index is **up to 99% smaller** than a
B-Tree, saving gigabytes of memory while maintaining near-identical search speed for sequential data.

### Q4: JSON vs. JSONB performance
**Question:** "Postgres supports both `JSON` and `JSONB`. If a developer says they want plain `JSON`
because it makes data insertion significantly faster, are they right? What architectural trade-off are
they making?"

**The Trap:** Thinking text-based JSON is always worse than binary JSONB.

**The Answer:** The developer is technically correct about **writes**, but wrong about **reads**.
- **Plain `JSON`** stores an exact text copy of what you input. Postgres doesn't parse it on write —
  it just checks the syntax is valid. So inserting is faster. **But** every time you query a key
  inside it, Postgres re-parses the entire text string from scratch — incredibly slow — and you
  **cannot index individual keys.**
- **`JSONB`** decomposes the JSON into a binary format on write. It takes a little more CPU to insert,
  but reads are lightning-fast because Postgres jumps straight to the key without parsing text.
  Crucially, JSONB supports **GIN indexing**, letting you index keys inside the object. For 99% of
  production apps, **JSONB is the correct choice.**

### Q5: UPDATE bloat — why, and how to mitigate
**Answer:** "Because of MVCC, Postgres treats an `UPDATE` as a `DELETE` followed by an `INSERT`. It
leaves the old row on disk as a dead tuple and writes a brand-new row. If the updated column has an
index, Postgres is forced to create new entries in **every single index** on that table, pointing to
the new row location. This leads to heavy disk and index bloat. To mitigate this, we optimize for
**HOT (Heap-Only Tuples) Updates.** If we ensure our update avoids changing indexed columns, and we
leave sufficient empty space on the data page using a tuned **`fillfactor`** setting (e.g., 85–90%),
Postgres places the new row version on the same physical page and uses an internal pointer. This
completely bypasses the index update step and eliminates index bloat."

### Q6: Index exists but Postgres uses a Sequential Scan — why?
**Answer:** "There are three primary reasons:
1. **Data Distribution Statistics:** The Cost-Based Optimizer determines the filter matches a very
   high percentage of the table's data (typically over 20–30%). In that case, sequential multi-block
   reads are physically faster than hopping between an index file and data blocks.
2. **Stale Table Statistics:** The table experienced high write churn but planner statistics weren't
   updated. Running manual `ANALYZE` corrects this.
3. **Functional Index Mismatch:** The query modifies the column inline (e.g.,
   `WHERE LOWER(email) = 'user@email.com'`), invalidating a standard index on `(email)`. We must build
   a functional index: `CREATE INDEX ON users (LOWER(email));`."

### Q7: What is a Deadlock, how does Postgres resolve it, and how do you prevent it?
**Answer:** "A deadlock occurs when Transaction 1 holds a lock on Row A and requests a lock on Row B,
while Transaction 2 concurrently holds a lock on Row B and requests a lock on Row A. Neither can
proceed. Postgres handles this via an internal **deadlock detection timer** (defaulting to 1 second).
When triggered, it analyzes the lock matrix, intentionally aborts one of the transactions to clear the
logjam, and rolls its changes back. To prevent deadlocks, the codebase must enforce a **strict,
uniform resource allocation order** — for example, always sort target resource IDs in code and lock
them sequentially from lowest to highest ID. If both transactions attempt to lock Row A first, one
simply waits in a clean queue behind the other rather than trapping each other."

> **Pro-Tip for answering advanced Postgres questions:** Whenever you're caught in a tricky situation,
> trace your answer back to **MVCC** (how Postgres copies rows instead of overwriting them) or **the
> WAL (Write-Ahead Log).** Almost every unique performance quirk or optimization behavior in Postgres
> stems from how it protects data integrity via these two systems.

---

## 10. PostgreSQL vs MySQL — head to head

| Feature Layer | PostgreSQL (Latest Core Architecture) | MySQL (Latest via InnoDB) |
|---|---|---|
| **MVCC Implementation** | Appends rows directly to the main table space. Old row versions stay in place as dead tuples until Autovacuum purges them. | Utilizes an **Undo Log**. Overwrites rows in place on the table and writes historical versions into a separate Undo tablespace. |
| **Write Optimization Overhead** | `UPDATE` operations can trigger heavy index amplification across the entire table unless optimized via HOT updates. | `UPDATE` operations only modify the row in place; indexes remain unaffected unless the actual indexed key column changes. |
| **Extensibility & Data Modeling** | Deeply native Object-Relational system. Out-of-the-box support for Arrays, Custom Types, Ranges, Key-Value, and Geospatial. | Strictly traditional Relational. Limited complex data processing outside standard schemas and basic JSON wrappers. |
| **Data Integrity Enforcement** | Ultra-strict compliance. Will aggressively reject formatting errors, overflow states, or invalid data types. | Historically lenient; can be configured to truncate strings or drop invalid dates gracefully depending on `SQL_MODE` states. |

---

## 11. Crucial Modern Feature Upgrades (PostgreSQL 17 & 18)

Knowing these features demonstrates that you are highly active and deeply current with modern
production database design.

### Asynchronous I/O (AIO) Engine
- **What it is:** A complete re-engineering of the internal I/O layer. Instead of database processes
  blocking synchronously on disk reads, Postgres fires **parallel asynchronous requests** directly
  through modern kernel architectures like Linux `io_uring`.
- **Good For:** Wiping out physical I/O bottlenecks. It provides a **2x–3x performance leap** for
  large sequential table scans, vacuum execution speeds, and heavy analytics queries on high-latency
  cloud block storage.

### Native UUIDv7 Engine
- **What it is:** Out-of-the-box support for **time-sortable**, globally unique identifiers via native
  functions (`uuidv7()`).
- **Good For:** High-velocity distributed applications. Traditional UUIDv4 strings are completely
  random, which shatters B-Tree index memory layouts during heavy inserts because they trigger
  constant structural page splits. Because UUIDv7 includes an embedded **timestamp prefix**, new
  inserts compile sequentially at the outer leaf edge of the B-Tree index. This **eliminates index
  page splits and dramatically slashes RAM utilization.**

### Virtual Generated Columns
- **What it is:** Columns that compute their value **on-demand at read time** based on other row
  expressions, without dedicating any space on physical storage.
- **Good For:** Saving massive disk capacity. Perfect for string concatenations, runtime mathematical
  formulas, or JSON data extractions. It accelerates write speeds (`INSERT`/`UPDATE`) because the
  engine does not compute or write extra data bytes to disk when records mutate.

### Zero-Lock `NOT NULL` Schema Validation
- **What it is:** Allows adding a `NOT NULL` constraint to massive tables in a `NOT VALID` state
  initially, followed by safe background validation.
- **Good For:** Multi-terabyte schema migrations with **zero application downtime.** Previously,
  executing an `ALTER TABLE ADD NOT NULL` forced a complete table scan under a nuclear
  `ACCESS EXCLUSIVE` lock, blocking application traffic for minutes or hours. This framework applies
  the rule **instantly to future records**, while checking historical rows using a gentle,
  non-blocking `SHARE UPDATE EXCLUSIVE` background process.

### Dual-State `RETURNING` Clause (OLD vs. NEW)
- **What it is:** An extension of the `RETURNING` syntax that allows a single modification query to
  capture and output **both** the original pre-update row state (`OLD`) **and** the transformed
  post-update state (`NEW`).
- **Good For:** Wiping out race conditions in application event streams and audit trails. It removes
  the need to execute a separate `SELECT` query prior to running an update or attaching heavy,
  complex procedural database triggers to track state changes.

---

## 12. The Complete SQL Query Cheatsheet (every query + tricks)

A practical, copy-ready reference for **every kind of query you'll write or be asked about** — with the
tricks, gotchas, and senior-level patterns interviewers look for.

### 12.1 SELECT basics & filtering
```sql
SELECT id, name FROM users;                      -- pick columns (avoid SELECT * in prod)
SELECT DISTINCT country FROM users;              -- unique values
SELECT * FROM users WHERE age >= 18 AND active;  -- filter
SELECT * FROM users WHERE country IN ('US','UK');-- set membership
SELECT * FROM users WHERE name LIKE 'Jo%';       -- pattern (case-sensitive)
SELECT * FROM users WHERE name ILIKE 'jo%';      -- pattern (case-INsensitive) PG-specific
SELECT * FROM users WHERE email IS NULL;         -- NULL test (NEVER use = NULL!)
SELECT * FROM users WHERE age BETWEEN 18 AND 30; -- inclusive range
SELECT * FROM orders WHERE total > 100 ORDER BY total DESC NULLS LAST LIMIT 10;
```
> **NULL traps:** `= NULL` is always unknown — use `IS NULL`. `NULL` sorts as the *largest* value
> by default; control it with `NULLS FIRST/LAST`. `WHERE x <> 5` **excludes NULL rows** too — add
> `OR x IS NULL` if you want them.

### 12.2 Sorting, paging, sampling
```sql
ORDER BY created_at DESC, id DESC          -- tiebreak with a unique column (stable paging)
LIMIT 20 OFFSET 40                         -- simple paging (slow when deep — see §4.9)
FETCH FIRST 10 ROWS ONLY                   -- SQL-standard form of LIMIT
ORDER BY random() LIMIT 1                   -- random row (slow on big tables)
TABLESAMPLE SYSTEM (1)                      -- fast ~1% sample of a huge table
```

### 12.3 Aggregation & GROUP BY
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
> **Trick — `FILTER`:** `COUNT(*) FILTER (WHERE paid)` lets you do multiple conditional counts in
> one pass: `SELECT COUNT(*) FILTER (WHERE paid) AS paid, COUNT(*) FILTER (WHERE NOT paid) AS unpaid`.
>
> **GROUP BY rule:** every non-aggregated column in `SELECT` must appear in `GROUP BY`.
> `GROUPING SETS`, `ROLLUP`, and `CUBE` produce subtotals/grand totals in one query.

### 12.4 JOINs (the heart of relational queries)
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
-- Find rows with NO match (anti-join) — classic interview trick:
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

### 12.5 Subqueries & EXISTS
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
> beware **`NOT IN` with NULLs** — if the subquery returns a single NULL, `NOT IN` returns **no rows**.
> Use `NOT EXISTS` instead.

### 12.6 CTEs (WITH) & recursion
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

### 12.7 Window functions (analytics without collapsing rows)
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

> **Classic interview task — "top N per group":** use `ROW_NUMBER() OVER (PARTITION BY group ORDER BY
> metric DESC)` in a subquery/CTE, then `WHERE rn <= N`. (Or use `LATERAL`, §12.4.)
> ```sql
> SELECT * FROM (
>   SELECT *, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) rn
>   FROM employees
> ) t WHERE rn <= 3;                            -- top 3 earners per department
> ```

### 12.8 INSERT / UPDATE / DELETE (writing data)
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
> atomic "insert-or-update" — far safer than check-then-insert (no race condition). `TRUNCATE` is much
> faster than `DELETE` for emptying a table but can't be filtered and resets sequences (`RESTART
> IDENTITY`).

### 12.9 Set operations
```sql
SELECT id FROM a UNION     SELECT id FROM b;   -- combine + remove duplicates
SELECT id FROM a UNION ALL SELECT id FROM b;   -- keep duplicates (faster — no dedup)
SELECT id FROM a INTERSECT SELECT id FROM b;   -- in both
SELECT id FROM a EXCEPT    SELECT id FROM b;    -- in a but not b
```
> `UNION` dedups (sorts — costs more); use **`UNION ALL`** unless you truly need uniqueness.

### 12.10 CASE, COALESCE & conditional logic
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

### 12.11 Strings, numbers, dates
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

### 12.12 JSON / JSONB (semi-structured data)
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

### 12.13 Performance & inspection commands
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

### 12.14 Transactions, locking & concurrency tricks
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
> in plain SQL — multiple workers each grab different rows without blocking each other. **`FOR UPDATE`**
> prevents lost updates by locking the selected rows until commit.

### 12.15 DDL quick reference (schema)
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
CREATE INDEX CONCURRENTLY idx_users_country ON users(country);   -- no table lock (§4.7)
CREATE VIEW active_users AS SELECT * FROM users WHERE active;
CREATE MATERIALIZED VIEW daily_sales AS SELECT date_trunc('day',created_at) d, SUM(total) FROM orders GROUP BY 1;
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales;
```
> **View vs Materialized view:** a plain **view** is a saved query (always live, computed each time);
> a **materialized view** stores the *result* (fast reads, but must be `REFRESH`ed). Use materialized
> views for expensive dashboards/reports.

### 12.16 The "gotcha" cheat list (memorize these)
- `= NULL` never matches → use **`IS NULL`**.
- `NOT IN (subquery with NULL)` returns **zero rows** → use **`NOT EXISTS`**.
- `WHERE col <> x` **drops NULL rows** → add `OR col IS NULL`.
- `LEFT JOIN` + filter on the right table in `WHERE` → becomes an **INNER JOIN** (filter in `ON`).
- `COUNT(col)` ignores NULLs; `COUNT(*)` doesn't.
- Joining on a non-unique key **multiplies rows** and inflates aggregates.
- `OFFSET` deep-paging is slow → use **keyset pagination** (§4.9).
- `UNION` dedups (slow) → use **`UNION ALL`** when duplicates are fine.
- Integer division: `5 / 2 = 2` → cast first: `5::numeric / 2 = 2.5`.
- `HAVING` filters groups (after aggregation); `WHERE` filters rows (before).
- An index on `email` is **not used** for `WHERE LOWER(email)=...` → index the expression.
- `TRUNCATE` can't be rolled back in some engines (in PG it *can* inside a transaction) and bypasses
  row triggers.

---

## 13. Practical Recipes — How to Actually Apply Each Feature

Copy-ready, real-world snippets for setting up indexes, full-text search, partitioning, and the rest —
with *when* and *why* to use each.

### 13.1 Creating each index type on a real field
```sql
-- B-Tree (the default): equality, ranges, sorting
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_orders_created ON orders (created_at);
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC); -- composite (order matters!)

-- UNIQUE index (enforces no duplicates + speeds lookups)
CREATE UNIQUE INDEX uq_users_email ON users (email);

-- PARTIAL index: only index the rows you actually query — smaller & faster
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
> table gives you a ~1000× smaller index than B-Tree — *as long as rows are inserted in time order*
> (so they're physically ordered on disk). Tune `pages_per_range` lower for more precision, higher for
> a smaller index.
>
> **Composite index rule:** put the column you filter by **equality** first, the **range/sort**
> column second. `(user_id, created_at)` serves `WHERE user_id=? ORDER BY created_at` perfectly but
> *not* a query on `created_at` alone (leftmost-prefix rule).

### 13.2 Full-Text Search (FTS) — searching natural language
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

**The production-grade setup — a stored, indexed `tsvector` column:**
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

### 13.3 Fuzzy / typo-tolerant search (pg_trgm)
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

### 13.4 Setting up partitioning end-to-end
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

### 13.5 Materialized view for an expensive dashboard
```sql
CREATE MATERIALIZED VIEW sales_by_day AS
SELECT date_trunc('day', created_at) AS day, count(*) AS orders, sum(total) AS revenue
FROM orders GROUP BY 1;

CREATE UNIQUE INDEX ON sales_by_day (day);              -- needed for CONCURRENTLY refresh
REFRESH MATERIALIZED VIEW CONCURRENTLY sales_by_day;    -- update without locking readers
```

### 13.6 Constraints that enforce business rules
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
> overlapping reservations" — impossible to express with a normal `UNIQUE` constraint.

### 13.7 Useful extensions to name-drop
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

---

*End of handbook. Good luck with your interview!*
