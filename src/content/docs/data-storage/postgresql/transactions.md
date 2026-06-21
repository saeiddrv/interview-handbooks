---
title: "PostgreSQL Transactions & Isolation — Interview Handbook"
description: "PostgreSQL transactions and isolation levels: read phenomena, Read Committed vs Repeatable Read vs Serializable, lost updates, and retry patterns."
sidebar:
  label: "Transactions & Isolation"
---

> Isolation is the "I" in ACID, and the part interviewers probe hardest. This page explains the
> read phenomena, the three isolation levels you actually use in PostgreSQL, how MVCC implements
> them, and the lost-update problem every senior engineer must know how to solve.

---

## 1. What a Transaction Actually Is

A **transaction** is a group of statements that succeed or fail as a single unit. Postgres wraps
every statement in a transaction automatically; you make it explicit with `BEGIN ... COMMIT`.

```sql
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- debit
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- credit
COMMIT;   -- both happen, or neither does (ROLLBACK undoes everything)
```

**Savepoints** let you roll back *part* of a transaction without losing the whole thing:
```sql
BEGIN;
  INSERT INTO orders (user_id) VALUES (42);
  SAVEPOINT after_order;
  INSERT INTO shipments (order_id) VALUES (999);  -- oops, bad data
  ROLLBACK TO after_order;                         -- undo just the shipment
  -- the order INSERT is still alive
COMMIT;
```

> **Trap:** in Postgres, once *any* statement in a transaction errors, the whole transaction is
> **aborted** — every following statement fails with `"current transaction is aborted"` and nothing
> will work until you recover. You have two options:
> - **No savepoint before the error:** you must `ROLLBACK` the entire transaction. Everything is lost.
> - **Savepoint set before the error:** `ROLLBACK TO savepoint_name` undoes only from that point
>   forward — the transaction stays open and you can continue.
>
> `ROLLBACK TO` is an **undo**, not a retry. After rolling back to a savepoint you must take a
> different path — skipping or replacing the failing statement. Rolling back and immediately
> running the exact same failing statement again will fail again for the same reason.

---

## 2. The Read Phenomena (what isolation protects you from)

Isolation levels are defined by which **concurrency anomalies** they allow. You must be able to name
these:

| Phenomenon | What happens | Plain-English example |
|---|---|---|
| **Dirty read** | You read another transaction's *uncommitted* change | You see a balance that gets rolled back a second later |
| **Non-repeatable read** | You read a row twice and get different values (someone committed an UPDATE in between) | A price is \$20, then \$25 within the same transaction |
| **Phantom read** | You run the same query twice and get *different rows* (someone committed an INSERT/DELETE) | `COUNT(*)` returns 10, then 11 |
| **Lost update** | Two transactions read-modify-write the same row; one overwrites the other | Both add \$10 to a balance, but only one \$10 sticks |
| **Serialization anomaly (write skew)** | Two transactions read the same data, each make a valid change to a different row, but their combined result breaks a rule that neither could detect alone | Two users share an account ($100). Both check the balance, both see $100 ≥ their withdrawal. Both withdraw $80. Final balance: −$60. Each was valid alone — together they broke the rule. |

> **Senior framing:** "Isolation levels are a dial trading **correctness for concurrency**. Higher
> isolation removes more anomalies but causes more conflicts (and retries). The job is to pick the
> lowest level that is still correct for the invariant I care about."

---

## 3. The Isolation Levels in PostgreSQL

The SQL standard defines four levels but **Postgres effectively has three** — it never allows dirty
reads at any level, so `READ UNCOMMITTED` behaves identically to `READ COMMITTED`. Setting it
explicitly has no effect.

| Level | Dirty read | Non-repeatable read | Phantom read | Write skew | Default? |
|---|---|---|---|---|---|
| **Read Committed** | Never | Possible | Possible | Possible | **Yes** |
| **Repeatable Read** | Never | No | **No** (stricter than the standard) | Possible | |
| **Serializable** | Never | No | No | **No** | |

> **Read Uncommitted** is accepted as a valid syntax but Postgres silently runs it as
> Read Committed. It is not a separate behaviour — do not use it.

```sql
-- Set the level for one transaction:
BEGIN ISOLATION LEVEL REPEATABLE READ;
  -- ...
COMMIT;

-- Or set it as the statement enters:
BEGIN;
  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  -- ...
COMMIT;
```

> **Nice to know:** Postgres's **Repeatable Read prevents phantom reads**, which the SQL standard
> technically allows at that level. That's because Postgres implements it as full **snapshot
> isolation** (see §4). Mentioning this distinction is a strong signal.

---

## 4. How MVCC Implements Isolation (the mechanism)

Every isolation level in Postgres is built on **MVCC snapshots**. A snapshot is a frozen view of
"which transactions had committed at the moment the snapshot was taken." A row version is visible to
you only if the transaction that created it was committed in your snapshot.

The only thing that changes between levels is **when the snapshot is taken**:

| Level | Snapshot taken | Effect |
|---|---|---|
| **Read Committed** | At the start of **each statement** | Every new statement sees freshly committed data |
| **Repeatable Read** | Once, at the **first statement** of the transaction | The whole transaction sees one consistent frozen view |
| **Serializable** | Same snapshot as Repeatable Read **+ conflict tracking** | Snapshot isolation plus detection of dangerous interleavings |

This is why Postgres readers never block writers and writers never block readers — visibility is a
snapshot comparison, not a lock.

---

## 5. Read Committed (the default) — and its sharp edge

Each **statement** gets a fresh snapshot. So within one transaction, two identical `SELECT`s can
return different data if someone committed in between (a non-repeatable read).

The subtle part interviewers love is what happens when two transactions update the same row at the same time:

```sql
-- balance starts at 100

-- Transaction A runs this:
UPDATE accounts SET balance = balance - 50 WHERE id = 1 AND balance >= 50;

-- Transaction B commits first and sets balance to 30.
-- Now Transaction A gets the row lock and is about to run.
```

At this point Postgres does **not** use A's original snapshot (where balance was 100).
It **re-reads the row** — sees balance is now 30 — and **re-evaluates the `WHERE` clause**:
`30 >= 50` is false, so the UPDATE affects 0 rows. No money is deducted. The check worked.

This only works because the math (`balance - 50`) is in the SQL itself, computed on the fresh value.
If you read the balance in your app first and write back a fixed number, Postgres has nothing to re-evaluate:

```sql
-- UNSAFE: app reads balance = 100, computes 100 - 50 = 50, writes it back as a literal
UPDATE accounts SET balance = 50 WHERE id = 1;
-- B already set balance to 30 — this silently overwrites it back to 50. Money is created from nowhere.
```

> **Senior answer:** "Read Committed gives statement-level snapshots, so a single statement is
> consistent but the transaction as a whole is not. On a write conflict it re-reads the latest row
> and re-checks the `WHERE` — which is why `SET balance = balance - 50` is safe but
> `SET balance = 50` (computed in the app) is not."

---

## 6. Repeatable Read (snapshot isolation)

One snapshot for the entire transaction. Every statement sees the database exactly as it was at the
first statement — no non-repeatable reads, no phantoms.

The cost: if your transaction tries to `UPDATE`/`DELETE` a row that another transaction has already
modified and committed, Postgres **cannot silently re-read** (that would break your frozen view).
Instead it aborts you:

```
ERROR:  could not serialize access due to concurrent update
```

This is a **serialization failure (SQLSTATE 40001)**. Your application must **catch it and retry the
whole transaction.**

> **Use it for:** reports and multi-statement reads that must all see one consistent point in time
> (e.g. a financial statement that sums several tables), or batch jobs where a retry is cheap.

---

## 7. The Lost Update Problem (and the three fixes)

This is the single most common real-world concurrency bug. Two transactions read the same value,
both modify it, and one silently overwrites the other.

```sql
-- BAD: read in the app, compute, write back a literal
-- Both sessions read balance = 100
-- Session 1 writes 110, Session 2 writes 105  → the +10 is lost
UPDATE accounts SET balance = 105 WHERE id = 1;
```

**Fix 1 — Atomic write (let the database do the math).** Best when the change is a simple delta:
```sql
UPDATE accounts SET balance = balance + 10 WHERE id = 1;  -- no lost update, any isolation level
```

**Fix 2 — Pessimistic lock (`SELECT ... FOR UPDATE`).** Best when logic is multi-step:
```sql
BEGIN;
  SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;  -- others wait here
  -- ... complex validation in the app ...
  UPDATE accounts SET balance = :new_balance WHERE id = 1;
COMMIT;
```

**Fix 3 — Optimistic locking (a version column).** Best for high-read, low-conflict web apps:
```sql
-- Each row carries a version number; the UPDATE only succeeds if nobody changed it
UPDATE products
SET price = 149, version = version + 1
WHERE id = 7 AND version = 3;       -- 0 rows updated → someone else won → reload & retry
```

| Strategy | When to use | Cost |
|---|---|---|
| **Atomic `x = x + n`** | Simple counters, balances, stock | None — always prefer it |
| **`FOR UPDATE`** | Multi-step logic on a hot row | Blocks other writers; keep the transaction short |
| **Optimistic / version** | Web forms, rare conflicts | Must handle retry in app; wasteful under high contention |

---

## 8. Serializable (the strongest) — and write skew

Serializable makes concurrent transactions behave **as if they ran one after another**. It is the
only level that prevents **write skew**.

**Write skew example:** a hospital rule says "at least one doctor must stay on call." Two on-call
doctors each check "is anyone else still on call?", both see *yes*, and both go off-call at the same
time. Each transaction is valid alone; together they break the invariant.

```sql
-- Both run at SERIALIZABLE:
BEGIN ISOLATION LEVEL SERIALIZABLE;
  SELECT count(*) FROM doctors WHERE on_call = true;  -- both see 2
  UPDATE doctors SET on_call = false WHERE id = :me;  -- each goes off-call
COMMIT;
-- One of the two COMMITs fails with 40001 → retried → second doctor sees count = 1 → blocked
```

Postgres implements this with **SSI (Serializable Snapshot Isolation)**: it tracks read/write
dependencies between transactions and aborts one if it detects a cycle that could produce a
non-serializable outcome.

> **Senior answer:** "Serializable in Postgres is SSI — optimistic, not lock-based. It lets
> transactions run on snapshots and aborts one with a 40001 if it detects a dangerous read/write
> dependency cycle. It's the only level that stops write skew, and the price is that the app **must**
> have a retry loop."

---

## 9. The Retry Loop (required for RR and Serializable)

Any code using Repeatable Read or Serializable **must** retry on serialization failure. This is not
optional — it's part of the contract.

```python
# Pseudocode — retry on SQLSTATE 40001 (serialization_failure) / 40P01 (deadlock)
for attempt in range(5):
    try:
        with db.transaction(isolation="serializable"):
            run_business_logic()
        break                          # success
    except SerializationFailure:
        if attempt == 4:
            raise
        sleep(backoff(attempt))        # exponential backoff, then retry
```

> **Trap:** developers enable Serializable for safety, forget the retry loop, and then see random
> "could not serialize access" errors in production. High isolation without retry logic is a bug.

---

## 10. Choosing a Level

| Situation | Level | Real-world example |
|---|---|---|
| Normal CRUD web app | **Read Committed** (default) | Creating a user, placing an order, posting a comment |
| Multi-statement read that must be point-in-time consistent | **Repeatable Read** | Generating a financial report that sums orders, refunds, and fees — all must reflect the same moment |
| Invariant spanning multiple rows/tables (write skew risk) | **Serializable** + retry loop | Booking a seat only if the flight is not full — two concurrent bookings must not both see "1 seat left" |
| Simple counter / balance update | **Read Committed** + atomic `x = x + n` | Decrementing inventory on purchase, adding points to a loyalty account |

The rule: **start at Read Committed, escalate only when a real anomaly threatens an invariant**, and
when you do escalate, add the retry loop.

---

> **Interview questions for this topic** are in the central
> [Interview Q&A](/data-storage/postgresql/q-and-a/#transactions--concurrency) bank.

## Cheat Sheet

```sql
-- Set isolation level
BEGIN ISOLATION LEVEL READ COMMITTED;   -- default
BEGIN ISOLATION LEVEL REPEATABLE READ;  -- snapshot for whole txn
BEGIN ISOLATION LEVEL SERIALIZABLE;     -- + write-skew protection (needs retry loop)

-- Savepoints (partial rollback)
SAVEPOINT sp1;  ...  ROLLBACK TO sp1;

-- Prevent lost updates
UPDATE t SET n = n + 1 WHERE id = 1;                 -- atomic (best)
SELECT * FROM t WHERE id = 1 FOR UPDATE;             -- pessimistic lock
UPDATE t SET x = ?, version = version + 1            -- optimistic lock
  WHERE id = 1 AND version = ?;                      -- 0 rows → retry
```

**The three rules:**
1. **Default to Read Committed** — escalate only for a real invariant.
2. **Never read-modify-write in the app** for simple deltas — use atomic `x = x + n`.
3. **Repeatable Read and Serializable need a retry loop** for `40001` — no exceptions.
