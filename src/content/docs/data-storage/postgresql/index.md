---
title: "PostgreSQL Core Concepts — Interview Handbook"
description: "PostgreSQL from the ground up: MVCC, indexing, locking, partitioning, and locking — with real examples for senior-level interviews."
sidebar:
  label: "Core Concepts"
---

> **This is a multi-page handbook.** Start here for the core concepts, then dive into
> [Transactions & Isolation](/data-storage/postgresql/transactions/),
> [SQL Cheatsheet](/data-storage/postgresql/sql-cheatsheet/),
> [Practical Recipes](/data-storage/postgresql/recipes/),
> [Performance](/data-storage/postgresql/performance/),
> [Replication](/data-storage/postgresql/replication/),
> [Operations & Security](/data-storage/postgresql/operations/),
> [PostgreSQL vs MySQL](/data-storage/postgresql/vs-mysql/),
> [Modern Features (17 & 18)](/data-storage/postgresql/modern-features/), and the
> [Interview Q&A](/data-storage/postgresql/q-and-a/) bank.

---

## What is PostgreSQL?

**PostgreSQL** (often called **Postgres**) is a free, open-source **Object-Relational Database
Management System (ORDBMS)**. It was born in 1986 as a research project at UC Berkeley, became
open-source in 1996, and has been actively developed by a global community ever since - making it
one of the most battle-tested databases in existence.

At its core, PostgreSQL stores data in **tables with rows and columns** (just like any relational
database), but it goes further: it lets you define custom data types, write functions in multiple
languages (SQL, PL/pgSQL, Python, etc.), and work natively with complex data like JSON, arrays,
geometric shapes, and full-text documents - all with full ACID guarantees.

Today it powers everything from small side projects to hyper-scale systems at companies like
Apple, Instagram, Spotify, and Shopify. It is consistently ranked among the top three most
popular databases in the world (DB-Engines ranking).

**What makes it stand out at a senior level:**
- Full SQL compliance plus powerful extensions (e.g. PostGIS for geospatial queries)
- Rock-solid concurrency via MVCC - readers never block writers
- Extensible by design: define custom data types and functions inside the database
- Native table partitioning for managing large datasets efficiently

---

## 1. What is an Object-Relational Database?

In simple words, an **Object-Relational Database Management System (ORDBMS)** like PostgreSQL is a
**hybrid database**. It combines the best of two worlds: it acts like a traditional spreadsheet-style
database, but it also understands complex, real-world "objects" just like modern programming
languages do.

### The "Relational" Part (the traditional base)
At its core it's a relational database - it stores data in **tables with rows and columns**, much
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

Let's break the key features down using a single real-world example: **building an online
bookstore** (think Amazon) that must handle customers, orders, books, and inventory smoothly.

### 2.1 ACID Transactions (the safety net)
ACID is a set of four rules that guarantees your data never gets corrupted, even if the power goes
out mid-click.

- **Atomicity (All or Nothing):** A customer buys a book. The database must do two things: subtract
  \$20 from their bank account **AND** subtract 1 book from inventory. If the power cuts out exactly
  halfway through, PostgreSQL cancels the whole thing. You never get money taken but no book ordered.
  (guaranteed by the **Write-Ahead Log - WAL**)
- **Consistency (No Rule-Breaking):** You have a rule that says "inventory cannot be less than 0". If
  two people try to buy the very last copy at the exact same time, the database blocks the second
  sale because it would break the rule.
  (enforced by **constraints** - e.g. `CHECK`, `NOT NULL`, `UNIQUE`)
- **Isolation (No Peeking):** If 10,000 people are buying books at the exact same moment, the database
  processes them so they don't trip over each other. Each purchase feels like it's the only one
  happening.
  (achieved via **MVCC** - Multi-Version Concurrency Control)
- **Durability (Saved Forever):** Once the database says "Order Confirmed," that data is written to
  the hard drive. Even if the server gets unplugged a millisecond later, your order is safe.
  (guaranteed by the **Write-Ahead Log - WAL**)

> **Accuracy note (good to know for interviews):** Durability and crash recovery come from the
> **Write-Ahead Log (WAL)** - before changing the data files, Postgres writes the change to the log
> first. On restart after a crash, Postgres **replays (redoes)** committed changes from the WAL.
> (Technically WAL is a *redo* log; uncommitted work is simply ignored via MVCC, not "undone" from
> the WAL - a subtle point that can impress an interviewer.)

### How do you actually define that "inventory cannot be less than 0" rule? (and prevent overselling)

This is **two things working together**: a **rule (constraint)** that makes negative inventory
*impossible*, and a **safe write pattern** that makes the rule fire correctly when two buyers race for
the last copy.

**Step 1 - The rule itself: a `CHECK` constraint.** Postgres will reject any row that violates it.
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
whole transaction rolls back - the sale fails cleanly:
```
ERROR:  new row for relation "products" violates check constraint "inventory_non_negative"
```

**Step 2 - Make it safe under a race: do the subtraction in ONE atomic statement.** Let the database
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

**The unsafe way (a classic bug):** read into the app, do math there, then write back -
```sql
-- both buyers SELECT inventory  → both see "1"
-- both buyers UPDATE ... SET inventory = 0  → you oversell!
```
Here the `CHECK` never even triggers, because neither tried to write a negative number. Always use the
atomic `inventory = inventory - 1` form instead.

**Extra control - refuse the sale when out of stock, and detect it:**
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

### Can a `CHECK` use `AND` / `OR`? (yes — and the gotchas)

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

Most databases give you a handful of basic types: plain text, integers, and simple dates.
PostgreSQL ships with a much richer built-in type system — and lets you add your own on top.

**Types you get out of the box that most databases don't:**

| Type | What it stores | Why it matters |
|---|---|---|
| `TIMESTAMPTZ` | Date + time + timezone | Avoids the classic "times shifted in production" bug |
| `UUID` | 128-bit unique ID | Safe for distributed IDs — no collision risk across servers |
| `ARRAY` | A list inside one column | e.g. `tags text[]` — no join table needed for simple lists |
| `JSONB` | Structured JSON, binary-indexed | Flexible schema inside a typed column; fully queryable |
| `NUMERIC(p,s)` | Exact decimal | Use for money — `FLOAT` loses cents due to floating-point rounding |
| `INET` / `CIDR` | IP addresses and network ranges | Built-in subnet operators — no string parsing needed |
| `POLYGON` / PostGIS | Points, lines, polygons | Powers location-based queries |

#### INET / CIDR — IP Addresses and Subnets

`INET` stores a single IP address (`192.168.1.42`). `CIDR` stores a network block (`192.168.1.0/24`).
PostgreSQL understands subnet math natively — no string parsing or regex needed.

```sql
CREATE TABLE servers (
    id    serial PRIMARY KEY,
    name  text,
    ip    inet    -- e.g. '192.168.1.42'
);

-- Find all servers that belong to a specific subnet
SELECT name, ip
FROM servers
WHERE ip << inet '192.168.1.0/24';   -- << means "is contained within this subnet"
```

**What they're testing:** Why use `INET` instead of plain `text` for IP addresses?
With `INET`, PostgreSQL validates the format on insert, understands subnet operators
like `<<` (contained by) and `>>` (contains), and can index IP ranges efficiently.
Storing IPs as text means doing all that yourself in application code.

**Trap:** Using `text` for IPs because "it's just a string." You lose validation,
subnet operators, and the ability to do range queries without a full table scan.

#### JSONB — Flexible Schema Inside a Typed Column

Some data has a fixed shape: every book has a `title`, `price`, and `publish_date`.
But some fields vary per row: one book has an `"illustrator"`, another a `"translator"`,
another a `"dust_jacket_color"`. Instead of creating 50 mostly-empty columns, store
the variable part in a single `JSONB` column and query it directly:

```sql
CREATE TABLE books (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title         text            NOT NULL,
    price         numeric(10,2)   NOT NULL,
    publish_date  date,
    metadata      jsonb           -- flexible, varying fields go here
);

-- Query a field inside the JSON column
SELECT title
FROM books
WHERE metadata->>'illustrator' = 'Quentin Blake';
```

**What they're testing:** Do you know the difference between `JSON` and `JSONB`?
`JSONB` is stored in binary — it strips whitespace, reorders keys, and is faster
to query and index. `JSON` keeps the original text exactly as written but is slower.
Always reach for `JSONB` unless you have a specific reason to preserve the raw input.

**Trap:** Reaching for `JSONB` for everything. If a field appears on every single row
and you filter or join on it — make it a proper typed column. How indexes behave
differently on typed columns vs JSONB expressions is covered in [Section 4.5 →](#45-typed-columns-vs-jsonb-indexing).

#### ARRAY — A List Inside One Column

Define an array column by appending `[]` to any type (`text[]`, `integer[]`, etc.).
Use it when a row owns a small list and a separate join table would be overkill.

```sql
CREATE TABLE products (
    id   serial PRIMARY KEY,
    name text,
    tags text[]   -- array of text labels
);

-- Insert: use ARRAY[...] syntax or the curly-brace string literal
INSERT INTO products (name, tags)
VALUES ('Running Shoes', ARRAY['sports', 'footwear', 'sale']);

INSERT INTO products (name, tags)
VALUES ('Winter Jacket', '{"clothing", "winter", "heavy"}');

-- @> containment: find every product tagged 'sports'
SELECT * FROM products WHERE tags @> ARRAY['sports'];

-- Index access is 1-based
SELECT name, tags[1] FROM products;
```

**What they're testing:** When would you use an `ARRAY` column vs a separate join table?
Arrays are the right call when the list is small, order matters, and you never need to
query items independently. The moment you need to join on an element, enforce uniqueness,
or add per-element indexes — normalize into a proper table.

**Trap:** Treating arrays like a shortcut for all one-to-many relationships. If the list
grows large or you need to query individual elements frequently, an array becomes a
performance liability — use a join table instead.

#### POLYGON / PostGIS — Geospatial Data

A `POLYGON` is stored as a list of `(x,y)` coordinates that close back on themselves.
The native type works for simple flat-grid shapes (e.g. delivery zones on a city map).

```sql
CREATE TABLE restaurants (
    id            serial PRIMARY KEY,
    name          text,
    delivery_zone polygon   -- native geometric type
);

-- Coordinates: top-left (0,10), top-right (10,10), bottom-right (10,0), bottom-left (0,0)
INSERT INTO restaurants (name, delivery_zone)
VALUES ('Downtown Pizza', '((0,10),(10,10),(10,0),(0,0))');

-- Is a customer at point (5,5) inside the delivery zone?
SELECT name FROM restaurants
WHERE delivery_zone @> point(5,5);   -- @> means "contains this point"

-- Do two delivery zones overlap?
SELECT * FROM restaurants
WHERE delivery_zone && polygon '((9,9),(15,15),(15,9),(9,9))';   -- && means "overlaps"
```

**What they're testing:** When would you use native `POLYGON` vs PostGIS?
Native `POLYGON` is fine for flat, arbitrary coordinate grids. For real GPS
latitudes/longitudes on the curved surface of the Earth (like Uber or Google Maps),
you need **PostGIS** — otherwise distance and area calculations are wrong.

**Trap:** Using native `POLYGON` with real GPS coordinates. Flat-grid math breaks
on a sphere — two zones that look like they overlap on a map may not satisfy `&&`
because the coordinates don't account for Earth's curvature.

```sql
-- Enable PostGIS for real-world coordinates
CREATE EXTENSION postgis;

CREATE TABLE stores (
    name     text,
    boundary geometry(Polygon, 4326)  -- 4326 = WGS84, the standard GPS coordinate system
);
```

### 2.3 MVCC (Multi-Version Concurrency Control)
Imagine a spreadsheet. If you are editing Row 5, the entire spreadsheet freezes and your coworker has
to wait for you to finish before they can even read it. That would ruin an online bookstore.

MVCC fixes this by taking **snapshots**. If a manager is updating the price of a book from \$20 to
\$25, PostgreSQL doesn't lock the row. Instead, it creates a **new "version"** of that row. While the
manager is busy typing, a customer buying the book at that exact second simply reads the **older
version** (\$20). No one has to wait in line just to look at the screen.

> **Goes deeper:** snapshots are also how Postgres implements **isolation levels**. For Read
> Committed vs Repeatable Read vs Serializable, the lost-update problem, and write skew, see the
> [Transactions & Isolation](/data-storage/postgresql/transactions/) page.

### 2.4 Indexing & Full-Text Search
- **Indexing (the textbook index):** If your bookstore has 10 million books and a customer searches
  for ID #543,211, a normal database scans all 10 million rows top to bottom. An **index** is like
  the index at the back of a textbook - it tells PostgreSQL exactly what page and row that ID lives
  on, speeding searches from seconds to milliseconds.

```sql
-- Without an index: Postgres reads all 10 million rows (slow)
SELECT * FROM books WHERE id = 543211;

-- Create an index on the id column
CREATE INDEX idx_books_id ON books (id);

-- Now Postgres jumps directly to the row (fast)
SELECT * FROM books WHERE id = 543211;
```

- **Full-Text Search (Google-like search):** Standard databases can only look for exact matches.
  Full-text search lets a customer type "wizard boy magic" and PostgreSQL is smart enough to handle
  typos, ignore words like "and" or "the", and surface Harry Potter.

```sql
-- Create a GIN index for fast full-text search on the title column
CREATE INDEX idx_books_fts ON books USING GIN (to_tsvector('english', title));

-- Customer types "wizard boy magic" - PostgreSQL finds Harry Potter
SELECT title
FROM books
WHERE to_tsvector('english', title) @@ to_tsquery('english', 'wizard & boy & magic');
```

### 2.5 Extensibility (custom functions & data types)
You can teach PostgreSQL new tricks it didn't know out of the box.

- **Custom Data Type:** You want to store book dimensions. Instead of saving Width, Height, and Depth
  in three columns, you can invent a brand-new data type called `box_size` that holds all three
  together.

```sql
-- Define a composite type that groups all three dimensions together
CREATE TYPE box_size AS (
    width_cm  numeric,
    height_cm numeric,
    depth_cm  numeric
);

-- Use it as a column type - one column, three values
CREATE TABLE books (
    id      serial PRIMARY KEY,
    title   text,
    dimensions box_size          -- instead of three separate columns
);

-- Insert a book with its dimensions
INSERT INTO books (title, dimensions)
VALUES ('Harry Potter', ROW(13.2, 19.7, 3.5));
```

- **Custom Function:** You can write a mini-program directly inside the database. For instance, a
  function `calculate_shipping_cost()` that automatically calculates tax and shipping at checkout -
  without your main website software doing the math.

```sql
-- A function that lives inside the database and does the math for you
CREATE OR REPLACE FUNCTION calculate_shipping_cost(
    order_total  numeric,
    destination  text
) RETURNS numeric AS $$
BEGIN
    -- Free shipping on orders over $50
    IF order_total >= 50 THEN
        RETURN 0.00;
    END IF;
    -- International orders cost more
    IF destination = 'international' THEN
        RETURN 19.99;
    END IF;
    RETURN 4.99;  -- standard domestic
END;
$$ LANGUAGE plpgsql;

-- Your app just calls this - no math needed in application code
SELECT calculate_shipping_cost(34.00, 'domestic');   -- returns 4.99
SELECT calculate_shipping_cost(60.00, 'domestic');   -- returns 0.00
```

### Summary

| Feature | In Plain English | Bookstore Example |
|---|---|---|
| **ACID** | Total data safety; no glitches. | Money isn't stolen if the server crashes mid-purchase. |
| **Rich Data / JSON** | Holds complex or messy data shapes. | Storing a flexible list of book details that change per genre. |
| **MVCC** | People can read while others are writing. | Customers can buy a book even while the price is being edited. |
| **Indexing & FTS** | Super-fast, smart searching. | Finding a book instantly out of millions using a typo-friendly search. |
| **Extensibility** | Teaching the database custom code. | A custom tool that automatically calculates shipping inside the table. |

---

## 3. Is an `UPDATE` really a `DELETE` + `INSERT`?

Yes - **always**, at the conceptual level. Postgres never overwrites a row in place.
But a smart optimization called **HOT (Heap-Only Tuples)** makes most updates cheap on disk.
Understanding both the base mechanic and HOT is a reliable senior interview signal.

### 3.1 Why Postgres never overwrites in place

Postgres uses **MVCC** (Multi-Version Concurrency Control). To let one transaction read a row
while another is modifying it, Postgres must keep **both versions alive at the same time** -
it cannot just overwrite the old one.

When you run:
```sql
UPDATE users SET status = 'banned' WHERE id = 99;
```
Postgres does two things:
1. **Writes a brand-new row** with `status = 'banned'` (the INSERT step)
2. **Flags the old row** (`status = 'active'`) as a **dead tuple** - invisible to future queries
   but left on disk until `VACUUM` cleans it up (the DELETE step)

The old row is never touched or overwritten. Other transactions that started before your update
still see the original version - that is the MVCC guarantee.

### 3.2 The cost: what happens without any optimization

If Postgres had no further tricks, every single `UPDATE` would:
- Write the new row version to a **different page** on disk
- Walk to **every index** on the table and insert a new pointer to the new row location
- Leave the old row behind as a dead tuple until `VACUUM`

On a table with 10 indexes, one `UPDATE` would produce 10 index writes. At thousands of updates
per second that becomes serious **write amplification** and **index bloat**.

### 3.3 HOT (Heap-Only Tuples): the optimization

HOT eliminates index writes for updates that qualify. Before going further:

> **Kill the #1 misconception: HOT is NOT in-place editing.** Postgres **always** writes a
> brand-new row version - it never overwrites the old one, not even with HOT. The old dead
> tuple still stays until `VACUUM`. What HOT changes is only (1) **where** the new version is
> written and (2) **whether the indexes are touched**.

**Without HOT** the new version lands on a different page and every index must be updated:
```
PAGE 5                          PAGE 9
+------------------+            +------------------+
| old row (dead) X |            | NEW row (live) V |  <- written to a different page
+------------------+            +------------------+
        ^                                ^
        |                                |
   index pointed here  --updated-->  index must now point here
   (every index on the table gets a new entry = write amplification)
```

**With HOT** the new version is written on the **same page**, and the old tuple holds a tiny
pointer to it. The indexes never change - they still point at the old slot, and Postgres
follows the in-page pointer to reach the live version:
```
PAGE 5 (same page)
+------------------------------------+
| old row (dead) X --+--> NEW row V  |  <- new version, same page
+------------------------------------+
        ^
        |
   index STILL points here - never updated
   Postgres follows the in-page pointer to the live row
```

### 3.4 The two conditions for HOT

HOT happens **only when both conditions are met**:

| Condition | Why it matters |
|---|---|
| **No indexed column changed** | If an indexed value changes, the index entry is now wrong and must be updated - HOT is impossible |
| **Free space on the same page** | The new version must physically fit next to the old one - reserve this with `fillfactor` (e.g. 85-90%) |

If either condition fails, Postgres falls back to the full non-HOT path: new page + every index updated.

### 3.5 HOT vs. non-HOT at a glance

| | Non-HOT update | HOT update |
|---|---|---|
| New row version written? | Yes | Yes (always) |
| Old row overwritten? | No | No |
| New version location | possibly a different page | **same page** |
| Indexes updated? | every index | **none** |
| Old version cleaned by | `VACUUM` | `VACUUM` |

### 3.6 Summary

- **Conceptually:** an `UPDATE` is always a `DELETE` + `INSERT` - Postgres never edits rows in place.
- **On disk:** HOT skips all index writes when no indexed column changes and the page has free room.
- **Keep it efficient:** avoid indexing high-churn columns; set `fillfactor` to 85-90% on tables
  with frequent updates so pages always have room for HOT.
- **Interview line:** "HOT doesn't update in place - a new row version is always written. The win
  is that the new version lands on the **same page** and the indexes are never touched. Two
  conditions must hold: no indexed column changed, and the page has free space (reserved via
  `fillfactor`)."

---

## 4. Indexing — every type, with pros, cons & best practices

Indexes turn slow, painful disk searches into lightning-fast queries. But they aren't magic - they
are physical data structures that take up space and slow down writes.

### 4.1 B-Tree Index (the default workhorse)
If you don't specify an index type (e.g. `CREATE INDEX ON users (email);`), Postgres defaults to a
B-Tree. It sorts data into a balanced tree, allowing rapid logarithmic search (note: a B-Tree, not a
binary tree - see the box below).

- **Best Used For:** Equal matches (`=`), range queries (`>`, `<`, `BETWEEN`), and sorting (`ORDER BY`).
- **Pros:** Highly optimized, extremely reliable, handles almost all standard queries.
- **Cons:** Can become massive (bloat) if indexed on large or frequently updated text columns.
- **Example:** Searching for a user by exact ID, email, or filtering orders placed between January
  and March.

```sql
CREATE TABLE users (
    id         serial PRIMARY KEY,
    email      text NOT NULL,
    username   text
);
CREATE TABLE orders (
    id         serial PRIMARY KEY,
    user_id    int REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Create a B-Tree index (the default - USING BTREE is optional)
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
> | Depth for 1M rows | ~20 levels | **~2-3 levels** |
> | Built for | in-memory data | **disk/block storage** |
>
> **Why databases use B-Trees, not binary trees:** it's all about **disk I/O**. Disks read in 8 KB
> pages, and each read is expensive. A binary tree (1 key/node) would need ~20 disk reads to find a
> row in a million; a B-Tree packs hundreds of keys per page, staying **wide and shallow** so it
> reaches any row in just **2-3 page reads**. Postgres actually uses a **B+-tree** variant: all row
> pointers live in the **leaf** nodes, and the leaves are **linked together** in a doubly-linked list,
> which is what makes range scans (`BETWEEN`, `ORDER BY`) fast - you just walk the linked leaves.
>
> **Interview line:** "Postgres's default index is a **B-Tree, not a binary tree** - a balanced
> *m-way* tree where each node is a disk page of many keys, so it's only 2-3 levels deep. That
> minimizes **disk reads**, which a 20-level-deep binary tree would not."

### 4.2 BRIN Index (Block Range Index)
Designed for massive, multi-gigabyte tables where data is **naturally sorted on disk** as inserted
(usually by time or incremental IDs). Instead of indexing every row, BRIN stores just the **min and
max values for a "block"** (page range) of data.

- **Best Used For:** Huge append-only tables (logs, clickstreams, IoT sensor data) queried by
  date/time ranges.
- **Pros:** Incredibly tiny - up to **99% smaller** than a B-Tree, saving massive RAM and disk.
- **Cons:** Only works if physical data on disk is physically ordered. If you resort or randomly
  update rows, BRIN becomes useless.
- **Example:** A `system_logs` table sorted by `created_at` where you query data by specific days.

```sql
CREATE TABLE system_logs (
    id         bigserial PRIMARY KEY,
    message    text,
    created_at timestamptz NOT NULL DEFAULT now()  -- rows inserted in time order
);

-- Create a BRIN index on the time-ordered column
CREATE INDEX idx_logs_created_brin ON system_logs USING BRIN (created_at);

-- Query that uses it: a date range on the huge, naturally-ordered table
SELECT * FROM system_logs
WHERE created_at >= '2024-02-10' AND created_at < '2024-02-11';
```

> **Don't confuse BRIN with partitioning or pagination - three different things!** The names
> get mixed up, but:
>
> | Term | What it actually is |
> |---|---|
> | **BRIN** | An **index type** - stores min/max per *block range*, for huge naturally-ordered tables |
> | **Partitioning** | **Splitting one big table into smaller physical sub-tables** (a table-design feature) |
> | **Pagination** | **Returning query results in pages** to the user (`LIMIT`/keyset) - a query technique |
>
> The "R" in BRIN is **Range** as in *block range* (a group of adjacent disk pages), **not** table
> partitioning. (See §4.9 and §4.10 below for partitioning and pagination.)
>
> **How BRIN works visually** - it stores one tiny min/max summary per block range:
> ```
> Table on disk (physically ordered by date):
>   Block range 1 (pages 1-128):   min=2024-01-01, max=2024-01-15
>   Block range 2 (pages 129-256): min=2024-01-15, max=2024-01-31
>   Block range 3 (pages 257-384): min=2024-02-01, max=2024-02-14
> ```
> Query `WHERE created_at = '2024-02-10'` → only range 3 *could* match → skip all other blocks.
>
> **Interview line:** "BRIN stores the min/max value per block range instead of per row, so it's
> 1000× smaller than a B-Tree - but it only helps when the table is **physically ordered on disk** by
> the indexed column, like timestamps in an append-only log."

### 4.3 GIN Index (Generalized Inverted Index)
Think of a GIN index like the index at the back of a textbook - look up "database" and it points you
to pages 12, 45, 89. GIN splits composite data into individual components and indexes those.

- **Best Used For:** Searching inside complex data such as arrays, JSONB documents, or full-text
  search tokens.
- **Pros:** Instantly finds rows where a **JSONB** document contains a specific key/value pair or an
  array contains a specific item.
- **Cons:** Very slow and expensive to update during `INSERT`/`UPDATE` because it modifies multiple
  pointers.
- **Example:** Searching inside a JSONB column to find all users with the preference
  `{"theme": "dark"}`.

```sql
CREATE TABLE users (
    id    serial PRIMARY KEY,
    name  text,
    prefs jsonb            -- binary JSON: supports GIN indexing
);
CREATE TABLE posts (
    id   serial PRIMARY KEY,
    body text,
    tags text[]            -- array of text tags
);

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
CREATE TABLE places (
    name     text,
    location geography(Point, 4326)  -- PostGIS longitude/latitude point, WGS84 coordinate system
);
CREATE TABLE reservations (
    room_id  int,
    during   tstzrange               -- timestamp-with-timezone range, e.g. '[2024-06-01, 2024-06-03)'
);

-- Geospatial: index the geography column, then query "nearby"
CREATE INDEX idx_places_geom_gist ON places USING GIST (location);
SELECT name FROM places
WHERE ST_DWithin(location, ST_MakePoint(-122.4, 37.8)::geography, 8047);  -- ~5 miles

-- Range type: prevent overlapping reservations for the same room
CREATE INDEX idx_resv_during_gist ON reservations USING GIST (during);
SELECT * FROM reservations WHERE during && tstzrange('2024-06-01','2024-06-03');  -- && = overlaps
```

### 4.5 Typed Columns vs JSONB — Indexing

The JSONB Trap in Section 2.2 says "use typed columns when you filter on a field" — here is
exactly why, with proof.

**Setup:** imagine you store user emails two ways — one as a proper typed column, one buried inside JSONB:

```sql
-- Option A: typed column
CREATE TABLE users_typed (
    id     serial PRIMARY KEY,
    email  text NOT NULL
);
CREATE INDEX idx_users_email ON users_typed (email);

-- Option B: email buried in JSONB
CREATE TABLE users_json (
    id      serial PRIMARY KEY,
    profile jsonb NOT NULL
);
-- To index a JSONB field you must use an expression index
CREATE INDEX idx_users_profile_email ON users_json ((profile->>'email'));
```

**Querying both:**

```sql
-- Option A: planner sees a typed column with a direct B-Tree index
SELECT * FROM users_typed WHERE email = 'alice@example.com';
-- → Index Scan on idx_users_email  (instant)

-- Option B: planner must match the expression exactly to use the index
SELECT * FROM users_json WHERE profile->>'email' = 'alice@example.com';
-- → Index Scan on idx_users_profile_email  (works, but fragile — see Trap below)
```

**What they're testing:** Can you index a JSONB field at all, and what are the limits?
Yes — with an expression index. But the query must use the **exact same expression** as
the index definition. If a developer writes `profile->'email'` instead of
`profile->>'email'`, the index is silently skipped and Postgres does a full table scan.

**Trap:** Thinking a GIN index on the whole JSONB column replaces targeted expression
indexes. A GIN index on `profile` is great for containment queries (`@>`) but it does
**not** speed up equality on a single key like `profile->>'email' = '...'`. You need
the expression index for that. Know which operator you are querying with before
deciding which index to create:

| Query pattern | Index to use |
|---|---|
| `profile @> '{"role": "admin"}'` | `GIN (profile)` |
| `profile->>'email' = 'x@y.com'` | `B-Tree ((profile->>'email'))` expression index |
| `email = 'x@y.com'` (typed column) | `B-Tree (email)` — simplest and most reliable |

### 4.6 Hash Index

A Hash index works by running each column value through a **hash function** - an internal algorithm
that converts any value (text, number, UUID, etc.) into a fixed-size number. That number is stored
in the index alongside a pointer to the row.

At query time, Postgres hashes your search value the same way and looks up the result instantly.
You always write and compare **plain values** - the hashing is entirely internal and invisible to you.

```
  INSERT 'a1b2c3d4e5f6'  →  hash function  →  84729  →  stored in index → points to row
  WHERE token = 'a1b2c3d4e5f6'  →  hash function  →  84729  →  jump straight to row
```

Because only the **hash of the value** is stored - not the value itself - Postgres can only ask
"does this hash match exactly?". It has no way to compare magnitudes or prefixes:

| Query | Uses Hash index? |
|---|---|
| `WHERE token = 'abc'` | Yes |
| `WHERE token > 'abc'` | No - hash numbers have no meaningful order |
| `WHERE token LIKE 'abc%'` | No - prefix matching needs the actual value |
| `ORDER BY token` | No - sorting requires order, hashes have none |

Works on **any type that supports `=`**: `text`, `integer`, `uuid`, `boolean`, and more.

- **Best Used For:** Strictly exact matches (`=`) on columns that are never sorted or range-queried.
- **Pros:** Slightly faster than B-Trees for pure equality lookups - one hash lookup vs. 2-3 B-Tree level traversals.
- **Cons:** Cannot handle `>`, `<`, `BETWEEN`, `LIKE`, or `ORDER BY`. B-Trees handle all of those, so in practice a B-Tree is almost always preferred unless you have measured a concrete gain.
- **Example:** Looking up a session token - always an exact match, never sorted or range-queried.

```sql
CREATE TABLE sessions (
    id         bigserial PRIMARY KEY,
    user_id    int,
    token      text NOT NULL,    -- fixed-format hash string, equality-only lookups
    created_at timestamptz DEFAULT now()
);

-- Hash: only equality (=), no ranges or sorting
CREATE INDEX idx_sessions_token_hash ON sessions USING HASH (token);
SELECT * FROM sessions WHERE token = 'a1b2c3d4e5f6';
```

### 4.7 Advanced Indexing Strategies (best practices)
To truly master indexing, rarely just use basic single-column indexes. Use these three strategies:

---

**A. Partial Indexes (the space saver)**

A partial index only indexes the rows that match a `WHERE` condition - it completely ignores
every other row.

**When to use it:** your queries almost always target a small, well-defined subset of a large table.
Classic examples: unprocessed jobs, unpaid invoices, active users, flagged content.

**What happens without it:** a normal index on `created_at` would include every order ever placed -
pending, completed, and cancelled. You'd be maintaining and searching a huge index just to find
the small slice of rows you actually care about. Wasted disk space, wasted RAM, slower writes.

```sql
CREATE TABLE orders (
    id         serial PRIMARY KEY,
    user_id    int,
    status     text NOT NULL,    -- 'pending', 'completed', 'cancelled'
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Without partial index: indexes ALL orders (millions of completed rows you never query)
CREATE INDEX idx_all_orders ON orders (created_at);
-- index size: ~500 MB (all rows)

-- With partial index: indexes ONLY pending orders (a tiny fraction)
CREATE INDEX idx_pending_orders ON orders (created_at) WHERE status = 'pending';
-- index size: ~2 MB (only the rows that matter)
```

The query `SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at` uses the partial
index automatically - Postgres knows it only needs to look at pending rows.

**What if you create one partial index per status value?**

You can - but it only makes sense when the subset is **small relative to the total table**.
In a typical orders table the row distribution looks like this:

| Status | Typical % of rows | Partial index useful? | Why |
|---|---|---|---|
| `pending` | ~1% | Yes | Tiny index, queried constantly |
| `cancelled` | ~5% | Maybe | Still small, worth it if queried often |
| `completed` | ~94% | **No** | Index is nearly as large as a full index - zero benefit |

If `completed` holds 94% of your rows, a partial index on it is essentially a full index.
You pay all the write overhead and gain almost nothing on reads.

**The hidden cost of multiple partial indexes:** every time an order moves from `pending` →
`completed`, Postgres must update **both** indexes - remove the row from `idx_pending` and
insert it into `idx_completed`. The more partial indexes you stack, the more write
amplification on every status change.

```sql
-- Good: index only the small, frequently queried subsets
CREATE INDEX idx_pending   ON orders (created_at) WHERE status = 'pending';
CREATE INDEX idx_cancelled ON orders (created_at) WHERE status = 'cancelled';

-- Bad: indexing 'completed' (94% of rows) gains nothing - avoid this
-- CREATE INDEX idx_completed ON orders (created_at) WHERE status = 'completed';

-- For 'completed' queries, either rely on a normal full index or accept
-- that you rarely need to query the completed orders by date at high speed.
```

> **Rule of thumb:** reach for a partial index when the subset is small (ideally under 10-15%
> of the table) and queried frequently. If the subset is large, a normal full index or a
> different strategy (partitioning by status) will serve you better.

---

**B. Covering Indexes (`INCLUDE` clause)**

A covering index bakes extra column values directly into the index leaf nodes, so Postgres can
answer a query **entirely from the index** without ever visiting the main table.

**When to use it:** a query always filters by one column but also selects one or two other columns.
Classic example: a login check - always filter by `email`, always return `id` and `username`.

**What happens without it:** Postgres uses the index to find the matching row, then makes a second
trip to the main table (heap) to fetch the extra columns. With millions of logins per day,
those extra heap trips add up - more disk reads, more latency.

```sql
-- Without covering index: 2 steps per login
-- Step 1: index lookup finds the row location by email
-- Step 2: heap fetch visits the main table to get id and username
CREATE INDEX idx_users_email ON users (email);
SELECT id, username FROM users WHERE email = 'alice@example.com';
-- EXPLAIN shows: Index Scan + Heap Fetches

-- With covering index: 1 step per login
-- The index already holds id and username right next to email - no table visit needed
CREATE INDEX idx_users_email_covering ON users (email) INCLUDE (id, username);
SELECT id, username FROM users WHERE email = 'alice@example.com';
-- EXPLAIN shows: Index Only Scan (no heap fetches)
```

> **Note:** only put columns in `INCLUDE` that you **select but never filter or sort by**.
> Columns you filter or sort by belong in the main index key, not in `INCLUDE`.

---

**C. Multi-Column (Composite) Indexes**

A composite index covers multiple columns in a single index structure, built for queries that
filter by several columns together.

**When to use it:** your queries regularly filter by two or more columns at the same time.
Classic example: an employee directory - always search by `last_name` AND `first_name` together.

**What happens without it:** with two separate single-column indexes, Postgres can only use one
of them efficiently and then filter the rest in memory - or in the worst case, scan the whole
table. One composite index serves the multi-column query directly.

```sql
CREATE TABLE employees (
    id         serial PRIMARY KEY,
    last_name  text NOT NULL,
    first_name text NOT NULL,
    department text
);

-- Without composite index: two separate indexes - Postgres picks one and filters in memory
CREATE INDEX idx_last  ON employees (last_name);
CREATE INDEX idx_first ON employees (first_name);
SELECT * FROM employees WHERE last_name = 'Smith' AND first_name = 'John';
-- Postgres uses idx_last, scans all Smiths, then filters for John in memory

-- With composite index: one lookup finds exactly the right rows
CREATE INDEX idx_name ON employees (last_name, first_name);
SELECT * FROM employees WHERE last_name = 'Smith' AND first_name = 'John'; -- fast
SELECT * FROM employees WHERE last_name = 'Smith';                          -- also fast (leftmost prefix)
SELECT * FROM employees WHERE first_name = 'John';                          -- does NOT use the index
```

> **Crucial rule - column order matters.** Postgres can use a composite index if you filter by
> the **leftmost column(s)** of the index. Put the column you filter by most often, or with the
> highest cardinality (most unique values), first. `first_name` alone cannot use `(last_name, first_name)`.

### 4.8 The Golden Rules of Production Indexing
1. **Never build indexes in production with a standard `CREATE INDEX`.** It locks the table,
   preventing writes. Always use **`CREATE INDEX CONCURRENTLY`** - slower to build, but no lockout.
2. **Monitor for unused indexes.** Every index slows down `INSERT`/`UPDATE`/`DELETE`. Use system
   views like `pg_stat_user_indexes` to find indexes where `idx_scan = 0` and drop them.
3. **Watch out for functional indexes.** An index on `email` is ignored by
   `WHERE LOWER(email) = 'user@test.com'`. You must index the function itself:
   `CREATE INDEX ON users (LOWER(email));`.
4. **Run `ANALYZE` after bulk changes.** Postgres's query planner decides whether to use an index
   based on table statistics. After a large `INSERT`, `UPDATE`, `DELETE`, or a freshly created index,
   those statistics can be stale - causing the planner to ignore your index and fall back to a slow
   sequential scan. Fix it by updating the statistics manually:
   ```sql
   ANALYZE orders;          -- refresh statistics for one table
   ANALYZE;                 -- refresh statistics for the entire database
   VACUUM (ANALYZE) orders; -- reclaim dead tuples AND refresh statistics in one pass
   ```
   Autovacuum does this automatically over time, but after a large one-off bulk operation
   you should run it manually rather than waiting.

### 4.9 Partitioning (splitting one big table into smaller sub-tables)

**What it is:** Partitioning breaks **one logical table** into many smaller **physical sub-tables
(partitions)** behind the scenes. You still query the one "parent" table; Postgres automatically routes
rows to the right partition and - crucially - **skips irrelevant partitions when querying** ("partition
pruning").

> **Partitioning ≠ BRIN ≠ sharding.** Partitioning splits a table across sub-tables **on the same
> server**. *Sharding* splits data across **different servers/machines**. BRIN is just an *index type*.

**The three types of partitioning:**

| Type | How rows are split | Best for |
|---|---|---|
| **Range** | By a value range (e.g., one partition per month) | Time-series, logs, anything by date |
| **List** | By a discrete value (e.g., one partition per country/region) | Categorical data |
| **Hash** | By a hash of the key (even spread) | Spreading load evenly when there's no natural range |

**Example - range partitioning by month:**
```sql
CREATE TABLE orders (
    id bigint, created_at timestamptz, amount numeric
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2024_01 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE orders_2024_02 PARTITION OF orders
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
```
Now `SELECT * FROM orders WHERE created_at >= '2024-02-10'` only scans `orders_2024_02` - the rest are
**pruned** (never touched).

- **Pros:** Queries scan far less data; you can **drop a whole month instantly** (`DROP TABLE
  orders_2024_01`) instead of a slow mass `DELETE`; maintenance (VACUUM, indexes) runs per-partition;
  smaller indexes per partition.
- **Cons:** More objects to manage; the **partition key must be in your queries** to get pruning;
  `UNIQUE` constraints must include the partition key; over-partitioning hurts planning time.
- **Interview line:** "Partitioning gives **partition pruning** (skip irrelevant sub-tables) and
  **cheap data lifecycle** - dropping an old partition is instant versus a huge `DELETE`. The golden
  rule is to query on the partition key, or pruning can't kick in."

> **BRIN + partitioning combo:** these two are a classic pairing for time-series - partition by month
> *and* put a BRIN index on `created_at` inside each partition. Both rely on data being time-ordered.

### 4.10 Pagination (returning results in pages) — OFFSET vs Keyset

**What it is:** Showing query results a page at a time (page 1, page 2...) instead of all at once. This
is a **query technique**, not storage - unrelated to BRIN or partitioning.

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
- **Pros:** **Constant speed at any depth** - it uses the index to jump straight to where you left off
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

> **Interview line:** "For deep pagination at scale, avoid `OFFSET` - it scans and discards every
> skipped row. Use **keyset pagination**: `WHERE id < :last_seen ORDER BY id LIMIT n`, which uses the
> index to resume in constant time. The trade-off is you lose 'jump to page N'."

---

## 5. Covering Indexes (the `INCLUDE` clause) — deep dive

To understand why covering indexes are a game-changer, picture your table as a **giant library**, and
your index as the **library catalog card system.**

### 5.1 The standard way (without `INCLUDE`)
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

### 5.2 The covering index way (with `INCLUDE`)
```sql
CREATE INDEX idx_user_email ON users (email) INCLUDE (username);
```
You are telling Postgres: "Build a B-Tree sorted by `email`, but at the very bottom level (the leaf
nodes), glue a copy of the `username` right next to it." Now the same query finds "alice@email.com"
and the username is **already sitting right there inside the index.** Postgres completely **skips
Step 2** and never touches the main table. This is an **Index-Only Scan** - incredibly fast because
it cuts the physical disk work in half.

### 5.3 Why not just a composite index on `(email, username)`?
There's a huge structural difference between **key columns** and **`INCLUDE` columns:**

- **Composite Index `(email, username)`:** Postgres sorts by `email` first, then by `username`.
  Because it must sort by both, maintaining this index on every `INSERT`/`UPDATE` takes a lot of CPU
  and structural overhead.
- **Covering Index `email INCLUDE (username)`:** Postgres only sorts by `email`. The `username` is
  just **dead-weight payload** tagged along at the end. It doesn't affect the tree structure or
  sorting logic, making it **much cheaper to maintain.**

### 5.4 When should you use this? (best practices)
Covering indexes are a specialized tool - use them when you have a specific, high-frequency query you
need to optimize to the absolute maximum.

- **Great Use Case:** A login system. You constantly run `SELECT id, password_hash FROM users WHERE
  email = $1;`. A covering index on `email INCLUDE (id, password_hash)` makes logins blindingly fast.
- **Bad Use Case:** Including too many columns. `INCLUDE (username, bio, profile_picture_url, age)`
  makes the index massive and bloated, wiping out any gains by eating your RAM.
- **Rule of Thumb:** Only `INCLUDE` small columns (IDs, dates, short strings) that are queried
  constantly alongside your primary search column.

---

> **Going deeper:** For diagnosing slow queries with `EXPLAIN ANALYZE`, understanding why the
> planner ignores indexes, and tuning production performance — see the
> [Performance](/data-storage/postgresql/performance/) page. For connection pooling
> (PgBouncer vs Supavisor) — see the
> [Operations & Security](/data-storage/postgresql/operations/#7-connection-pooling) page.

---

## 6. Locking in PostgreSQL

A **lock** is a temporary signal that says: *"I am working on this — wait your turn."*
Postgres acquires locks automatically for almost every SQL statement you run.
You rarely write locking code yourself, but you must understand what is happening
behind the scenes — because the wrong lock at the wrong time is the most common
cause of production slowdowns and deadlocks.

**Locks vs. MVCC — what is the difference?**
MVCC (covered in §2.3) lets readers see a consistent snapshot without ever waiting for writers.
Locks handle a different problem: preventing two *writers* from corrupting the same data
at the same time, and preventing structural changes (like `ALTER TABLE`) from running
while queries are in flight.

This section covers three things:

| Section | What it covers |
|---|---|
| **6.1 How commands affect each other** | Which SQL commands block which — SELECT, INSERT, ALTER TABLE, etc. |
| **6.2 Locking a specific row before updating it** | How to reserve a row so no one else touches it |
| **6.3 Which row locks can coexist** | A reference table showing which row locks are compatible |
| **6.4 Locking anything in your application logic** | How to lock a concept, a job, or a resource — not just a row or table |
| **6.5 Production Best Practices** | Rules to avoid deadlocks and lock contention in production |

---

### 6.1 How commands affect each other

Every command that touches a table acquires a lock automatically.
Here is exactly what each command locks, what it blocks, and for how long:

---

**`SELECT`**
- **Blocks:** nothing — SELECT never blocks any other query
- **Blocked by:** `ALTER TABLE`, `DROP TABLE`, `TRUNCATE` (if one of those is running, SELECT waits)
- **Duration:** held while the query runs, released immediately after
```sql
SELECT * FROM orders WHERE user_id = 42;
-- INSERT, UPDATE, DELETE, other SELECTs all run freely alongside this
```

---

**`INSERT` / `UPDATE` / `DELETE`**
- **Blocks:** other writes on the **same row** — if two transactions update the same row simultaneously, one waits for the other to finish
- **Does NOT block:** `SELECT`, and writes on **different rows** run freely
- **Blocked by:** `ALTER TABLE`, `DROP TABLE`, `TRUNCATE`, `CREATE INDEX` (standard)
- **Duration:** held for the duration of the transaction
```sql
UPDATE orders SET status = 'paid' WHERE id = 1;
-- Another UPDATE on id=1 must wait until this transaction commits
-- An UPDATE on id=2 runs freely — different row, no conflict
-- A SELECT on id=1 also runs freely — MVCC gives it a snapshot
```

---

**`CREATE INDEX` (standard)**
- **Blocks:** `INSERT`, `UPDATE`, `DELETE` — writes queue up and wait
- **Does NOT block:** `SELECT` — reads continue freely
- **Blocked by:** running `INSERT`, `UPDATE`, `DELETE` transactions — waits for them to commit first
- **Duration:** held until the entire index is built (can be minutes on a large table)
```sql
CREATE INDEX ON orders (created_at);
-- All writes to orders are frozen until this finishes
-- Use CONCURRENTLY to avoid this:
CREATE INDEX CONCURRENTLY ON orders (created_at);  -- blocks nothing
```

---

**`VACUUM` / `ANALYZE` / `CREATE INDEX CONCURRENTLY`**
- **Blocks:** nothing — these run safely alongside all normal queries
- **Blocked by:** `ALTER TABLE`, `DROP TABLE`, another concurrent `VACUUM` on the same table
- **Duration:** held while the operation runs
```sql
VACUUM orders;    -- SELECT, INSERT, UPDATE, DELETE all continue normally
ANALYZE orders;   -- same — your app feels nothing
```

---

**`ALTER TABLE` / `DROP TABLE` / `TRUNCATE` / `VACUUM FULL`**
- **Blocks:** everything — SELECT, INSERT, UPDATE, DELETE all freeze
- **Blocked by:** everything — waits for every running query to finish first
- **Duration:** held until the command completes
```sql
ALTER TABLE orders ADD COLUMN note text;
-- Waits for all running queries to finish
-- Then blocks all new queries until ALTER is done
-- Then releases — everything continues
```

> **Production trap:** if a slow SELECT is running (e.g. a 30-second report), your
> `ALTER TABLE` queues behind it. Every new query then queues behind the `ALTER TABLE`.
> Your entire app stalls. Always run schema changes in a low-traffic window.

---

### 6.2 Locking a specific row before updating it

Row-level locks protect **individual rows**, not the whole table. They are acquired when you
explicitly tell Postgres to reserve a row before modifying it, or automatically during DML.

> **Plain `SELECT` never acquires a row lock.** Readers always see a consistent MVCC snapshot
> and never wait. Row locks only come into play when you use `SELECT FOR ...` or run DML.

The four row-level lock modes, from weakest to strongest:

**1. `FOR KEY SHARE` (weakest)**

Allows other transactions to update the row as long as they don't touch key columns (like `id`).
Postgres acquires this automatically when checking foreign keys.

```sql
-- Postgres acquires FOR KEY SHARE automatically when validating:
-- "does this order's user_id actually exist in the users table?"
INSERT INTO orders (user_id, total) VALUES (42, 99.00);
```

- **Blocks:** `FOR UPDATE` — prevents an exclusive lock while this is held
- **Blocked by:** `FOR UPDATE`
- **When you'd use it manually:** almost never — Postgres manages it internally

**2. `FOR SHARE`**

Multiple transactions can hold `FOR SHARE` on the same row simultaneously.
Prevents anyone from updating or deleting the row, but allows reads.

```sql
-- Ensure a parent user cannot be deleted while we are inserting a child order
BEGIN;
  SELECT * FROM users WHERE id = 42 FOR SHARE;     -- "keep this user alive"
  INSERT INTO orders (user_id, total) VALUES (42, 99.00);
COMMIT;
```

- **Blocks:** `FOR NO KEY UPDATE`, `FOR UPDATE`
- **Blocked by:** `FOR NO KEY UPDATE`, `FOR UPDATE`
- **Trap:** upgrading from `FOR SHARE` to a write lock inside the same transaction
  frequently causes a deadlock

**3. `FOR NO KEY UPDATE`**

Locks the row for modification but still allows `FOR KEY SHARE` on it.
This is what a standard `UPDATE` uses automatically under the hood.

```sql
-- A plain UPDATE acquires FOR NO KEY UPDATE automatically:
UPDATE products SET price = 149 WHERE id = 7;

-- Explicit use: lock before multi-step logic that doesn't touch the primary key
BEGIN;
  SELECT * FROM products WHERE id = 7 FOR NO KEY UPDATE;
  -- ... application logic ...
  UPDATE products SET price = 149 WHERE id = 7;
COMMIT;
```

- **Blocks:** `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR UPDATE`
- **Blocked by:** `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR UPDATE`
- **When to use manually:** when you want to lock a row for update but still allow
  foreign-key checks on it from other transactions

**4. `FOR UPDATE` (strongest)**

Fully locks the row — no other transaction can update, delete, or lock it in any way
until you commit.

```sql
-- Reserve a seat before booking (prevents double-booking)
BEGIN;
  SELECT * FROM seats WHERE id = 15 AND status = 'available' FOR UPDATE;
  -- row is now locked — any other transaction trying seat 15 waits here
  UPDATE seats SET status = 'booked', user_id = 99 WHERE id = 15;
COMMIT;

-- NOWAIT: fail immediately instead of waiting if the row is already locked
SELECT * FROM seats WHERE id = 15 FOR UPDATE NOWAIT;

-- SKIP LOCKED: skip rows already locked — perfect for job queues
SELECT * FROM jobs
WHERE status = 'pending'
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;  -- worker grabs the next free job, skips ones others hold
```

- **Blocks:** everything — `FOR KEY SHARE`, `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR UPDATE`
- **Blocked by:** everything — `FOR KEY SHARE`, `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR UPDATE`
- **When to use:** financial transactions, seat booking, inventory reservation — any
  case where two concurrent writes on the same row would cause real-world harm

### 6.3 Which row locks can coexist

Shows whether two transactions can hold their locks on the **same row** simultaneously.
`OK` = both can proceed · `Blocks` = second transaction must wait.

| Lock requested \ Lock held | `FOR KEY SHARE` | `FOR SHARE` | `FOR NO KEY UPDATE` | `FOR UPDATE` |
|---|---|---|---|---|
| `FOR KEY SHARE` | OK | OK | OK | Blocks |
| `FOR SHARE` | OK | OK | Blocks | Blocks |
| `FOR NO KEY UPDATE` | OK | Blocks | Blocks | Blocks |
| `FOR UPDATE` | Blocks | Blocks | Blocks | Blocks |

---

### 6.4 Locking anything in your application logic

What if you want to lock something that **isn't** a table or row? For example: ensure only one
instance of a background job runs across 5 servers, or prevent two processes from processing
the same file simultaneously. Postgres provides **Advisory Locks** for this.

**How it works:** you claim an arbitrary integer as a lock identifier. Postgres tracks who holds
it in shared memory — no tables, no disk writes, no dead tuples.

```sql
-- Session-level: held until explicitly released or the connection closes
SELECT pg_advisory_lock(42);       -- claim lock 42 (blocks if another session holds it)
-- ... do the protected work ...
SELECT pg_advisory_unlock(42);     -- release it

-- Transaction-level: released automatically at COMMIT/ROLLBACK (safer)
BEGIN;
  SELECT pg_advisory_xact_lock(42);  -- released automatically at end of transaction
  -- ... do the protected work ...
COMMIT;

-- Try-lock: returns true if acquired, false if someone else holds it — never blocks
SELECT pg_try_advisory_lock(42);
```

- **No database bloat:** lives entirely in server shared memory, never touches tables
- **Replaces Redis/ZooKeeper** for simple distributed locking if you already have Postgres
- **Trap:** session-level advisory locks are **not** released on `ROLLBACK`. If your app
  crashes without calling `pg_advisory_unlock`, the lock stays until the connection is killed.
  Prefer `pg_advisory_xact_lock` (transaction-level) to avoid this.

---

### 6.5 Production Best Practices for Locking

**A. Keep transactions short.**
Locks are held until `COMMIT` or `ROLLBACK`. A transaction that opens, locks a row, then makes
a slow external API call holds that lock for the entire duration — blocking every other writer
on that row.

```sql
-- Bad: lock held during a slow external call
BEGIN;
  SELECT * FROM orders WHERE id = 1 FOR UPDATE;
  -- ... call Stripe API (500ms) ...
  UPDATE orders SET status = 'paid' WHERE id = 1;
COMMIT;

-- Good: do the external work first, then open a short transaction
-- 1. call Stripe API (outside any transaction)
BEGIN;
  SELECT * FROM orders WHERE id = 1 FOR UPDATE;   -- fast lock
  UPDATE orders SET status = 'paid' WHERE id = 1; -- fast update
COMMIT;                                           -- lock released immediately
```

> **Rule:** never make network calls or run heavy processing inside a transaction.
> Get in, update, get out.

**B. Always acquire locks in the same order to prevent deadlocks.**

A deadlock happens when Transaction A waits for Transaction B, and B waits for A — neither
can proceed. Postgres detects this and kills one of them.

```
Transaction A: locks row 1, waits for row 2  →
Transaction B: locks row 2, waits for row 1  ←  deadlock!
```

Fix: always lock rows in the same order (e.g. ascending `id`):

```sql
-- Both transactions follow the same sequence — one simply waits behind the other
SELECT * FROM accounts WHERE id IN (1, 2) ORDER BY id FOR UPDATE;
```

**C. Use `NOWAIT` or `SKIP LOCKED` instead of waiting indefinitely.**

```sql
-- NOWAIT: fail fast — let the app retry or show a user-friendly error
SELECT * FROM seats WHERE id = 15 FOR UPDATE NOWAIT;

-- SKIP LOCKED: job queue workers grab the next unlocked job and ignore the rest
SELECT * FROM jobs WHERE status = 'pending'
ORDER BY created_at LIMIT 1
FOR UPDATE SKIP LOCKED;
```



