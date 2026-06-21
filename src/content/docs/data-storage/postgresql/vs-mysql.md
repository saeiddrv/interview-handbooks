---
title: "PostgreSQL vs MySQL — Interview Handbook"
description: "PostgreSQL vs MySQL: MVCC and storage engines, indexing, transactions, isolation levels, replication, HA, data types, and when to choose each."
sidebar:
  label: "PostgreSQL vs MySQL"
---

> "Why Postgres over MySQL?" is one of the most common database interview questions. The honest
> answer is *both are excellent* — but they make different architectural choices. This page compares
> them across everything covered in the handbook so you can give a precise, senior-level answer
> instead of "Postgres is better."

---

## 1. Storage & MVCC

How each engine stores rows and handles concurrent versions is the deepest architectural difference.

| Aspect | PostgreSQL | MySQL (InnoDB) |
|---|---|---|
| **MVCC implementation** | Appends new row versions directly to the table. Old versions stay in place as **dead tuples** until Autovacuum purges them. | Uses an **Undo Log**: updates the row **in place** and writes the historical version to a separate undo tablespace. |
| **Write overhead** | An `UPDATE` can trigger index amplification across the whole table unless optimized via **HOT updates**. | An `UPDATE` modifies the row in place; indexes are untouched unless an **indexed key column** changes. |
| **Table layout** | **Heap-organized.** Rows live in an unordered heap; *every* index (including the primary key) is secondary and points to a physical row location. | **Index-organized (clustered).** The table *is* the primary-key B-Tree; secondary indexes store the PK, so they need a second lookup to reach the row. |
| **Cleanup** | Requires **VACUUM** to reclaim dead tuples (covered in the handbook). | A background **purge thread** removes old undo versions automatically. |

> **Senior answer:** "The core difference is MVCC: Postgres keeps old row versions in the heap and
> needs VACUUM to clean them, while InnoDB updates in place using undo logs. And InnoDB is
> clustered — the table is the primary-key index — so PK lookups are very fast but secondary-index
> lookups do a double hop. Postgres heaps treat all indexes equally."

---

## 2. Indexing

| Feature | PostgreSQL | MySQL (InnoDB) |
|---|---|---|
| **Index types** | B-Tree, **GIN, GiST, SP-GiST, BRIN**, Hash | B-Tree, R-Tree (spatial), FULLTEXT, Hash (MEMORY engine only) |
| **Partial indexes** | Yes (`WHERE status = 'pending'`) | **No** |
| **Expression / functional indexes** | Yes (`LOWER(email)`) | Yes (8.0+) |
| **Covering indexes** | `INCLUDE` clause for an index-only scan | Naturally covered by the clustered PK; `INVISIBLE`/covering via secondary indexes |
| **Clustered index** | No (heap) — you can `CLUSTER` once, but it isn't maintained | Always (the primary key) |

> **Trap:** candidates say "MySQL has fewer index types so Postgres is better." The real point is
> *fit*: Postgres's BRIN, GIN, and partial/expression indexes make it far stronger for time-series,
> JSON, arrays, and selective subsets — but InnoDB's clustered PK makes primary-key range scans
> exceptionally fast.

---

## 3. Transactions & Concurrency

| Aspect | PostgreSQL | MySQL (InnoDB) |
|---|---|---|
| **Default isolation level** | **Read Committed** | **Repeatable Read** |
| **Phantom prevention at RR** | Snapshot isolation prevents phantoms | Prevents them with **next-key / gap locks** (a locking approach, not pure snapshot) |
| **Serializable** | **SSI** — optimistic, aborts with `40001` and you retry | Lock-based serializable |
| **Connection model** | **Process per connection** — heavier, so you need a pooler (PgBouncer) | **Thread per connection** — lighter, scales to many connections more cheaply |

> **Senior answer:** "Their defaults differ — Postgres is Read Committed, InnoDB is Repeatable Read
> with gap locks. And the connection model matters operationally: Postgres forks a process per
> connection so I put PgBouncer in front, whereas MySQL's thread-per-connection handles high
> connection counts more gracefully out of the box."

---

## 4. Replication & High Availability

| Aspect | PostgreSQL | MySQL (InnoDB) |
|---|---|---|
| **Mechanism** | **Physical WAL streaming** + **logical replication** | **Binlog replication** (row / statement / mixed) with GTIDs |
| **Sync option** | Synchronous standbys | Semi-synchronous replication |
| **Automated HA** | Patroni + etcd/ZooKeeper/Consul | **Group Replication / InnoDB Cluster**, or Galera |
| **Multi-primary** | Not native (logical + conflict handling) | Group Replication / Galera support multi-primary |

---

## 5. Data Types & Features

| Feature | PostgreSQL | MySQL (InnoDB) |
|---|---|---|
| **Extensibility & data modeling** | Deeply native object-relational: Arrays, Custom Types, Ranges, Key-Value, Geospatial out of the box | Strictly traditional relational; limited complex data outside standard schemas and basic JSON |
| **Data integrity** | Ultra-strict — rejects formatting errors, overflow, invalid types | Historically lenient; depends on `SQL_MODE` (can truncate or coerce) |
| **JSON** | **JSONB** with GIN indexing and rich operators (`@>`, path queries) | `JSON` (binary), but indexed only via generated/functional columns |
| **Full-text search** | `tsvector` + GIN, language-aware (see Recipes) | `FULLTEXT` indexes |
| **Materialized views** | Yes (`REFRESH ... CONCURRENTLY`) | **No native support** (must emulate with a table) |
| **Geospatial** | **PostGIS** — the industry gold standard | Built-in spatial types (capable, but less powerful) |
| **Booleans** | Real `boolean` type | `TINYINT(1)` alias |
| **Window functions / CTEs** | Long-standing, very complete | Supported since 8.0 |

---

## 6. When to Choose Which

| Choose **PostgreSQL** when… | Choose **MySQL** when… |
|---|---|
| You need complex queries, strict data integrity, or rich types (JSON, arrays, geospatial) | You run simple, read-heavy, high-throughput web workloads |
| You want advanced indexing (BRIN, GIN, partial, expression) | You need huge connection counts with minimal tuning |
| You do analytics, time-series, or geospatial (PostGIS) | Primary-key point lookups dominate (clustered index wins) |
| You value extensibility and standards compliance | Your team/ecosystem is already deep in MySQL |

> **Senior answer:** "Both are production-grade. I reach for Postgres when the data model is rich or
> the queries are complex — JSON, arrays, geospatial, advanced indexing, strict integrity. I'd stay
> on MySQL for a simple, read-heavy app with very high connection counts where InnoDB's clustered
> primary key and lightweight threads shine. The decision is about workload fit, not 'which is
> better.'"

---

> **Interview questions for this topic** are in the central
> [Interview Q&A](/data-storage/postgresql/q-and-a/) bank.
