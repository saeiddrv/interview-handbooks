---
title: "PostgreSQL 17 & 18 Features — Interview Handbook"
description: "PostgreSQL 17 & 18 features for senior interviews: async I/O, native UUIDv7, virtual generated columns, zero-lock NOT NULL, and dual-state RETURNING."
sidebar:
  label: "Modern Features (17 & 18)"
---

> Knowing these features demonstrates that you are highly active and deeply current with modern
> production database design. Each one removes a long-standing pain point — name them in an interview
> to show you track PostgreSQL releases, not just the basics.

---

## 1. Asynchronous I/O (AIO) Engine
- **What it is:** A complete re-engineering of the internal I/O layer. Instead of database processes
  blocking synchronously on disk reads, Postgres fires **parallel asynchronous requests** directly
  through modern kernel architectures like Linux `io_uring`.
- **Good For:** Wiping out physical I/O bottlenecks. It provides a **2x-3x performance leap** for
  large sequential table scans, vacuum execution speeds, and heavy analytics queries on high-latency
  cloud block storage.

## 2. Native UUIDv7 Engine
- **What it is:** Out-of-the-box support for **time-sortable**, globally unique identifiers via native
  functions (`uuidv7()`).
- **Good For:** High-velocity distributed applications. Traditional UUIDv4 strings are completely
  random, which shatters B-Tree index memory layouts during heavy inserts because they trigger
  constant structural page splits. Because UUIDv7 includes an embedded **timestamp prefix**, new
  inserts compile sequentially at the outer leaf edge of the B-Tree index. This **eliminates index
  page splits and dramatically slashes RAM utilization.**

## 3. Virtual Generated Columns
- **What it is:** Columns that compute their value **on-demand at read time** based on other row
  expressions, without dedicating any space on physical storage.
- **Good For:** Saving massive disk capacity. Perfect for string concatenations, runtime mathematical
  formulas, or JSON data extractions. It accelerates write speeds (`INSERT`/`UPDATE`) because the
  engine does not compute or write extra data bytes to disk when records mutate.

## 4. Zero-Lock `NOT NULL` Schema Validation
- **What it is:** Allows adding a `NOT NULL` constraint to massive tables in a `NOT VALID` state
  initially, followed by safe background validation.
- **Good For:** Multi-terabyte schema migrations with **zero application downtime.** Previously,
  executing an `ALTER TABLE ADD NOT NULL` forced a complete table scan under a nuclear
  `ACCESS EXCLUSIVE` lock, blocking application traffic for minutes or hours. This framework applies
  the rule **instantly to future records**, while checking historical rows using a gentle,
  non-blocking `SHARE UPDATE EXCLUSIVE` background process.

## 5. Dual-State `RETURNING` Clause (OLD vs. NEW)
- **What it is:** An extension of the `RETURNING` syntax that allows a single modification query to
  capture and output **both** the original pre-update row state (`OLD`) **and** the transformed
  post-update state (`NEW`).
- **Good For:** Wiping out race conditions in application event streams and audit trails. It removes
  the need to execute a separate `SELECT` query prior to running an update or attaching heavy,
  complex procedural database triggers to track state changes.

---

> **Interview questions for this topic** are in the central
> [Interview Q&A](/data-storage/postgresql/q-and-a/) bank.
