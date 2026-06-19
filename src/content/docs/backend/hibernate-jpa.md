---
title: "Hibernate & JPA — Interview Handbook"
description: "A complete, easy-to-understand guide to Hibernate (the leading JPA ORM): how it really works, the persistence context, entity lifecycle, mappings &…"
sidebar:
  label: "Hibernate & JPA"
---

> A complete, easy-to-understand guide to Hibernate (the leading JPA ORM): how it really works, the
> persistence context, entity lifecycle, mappings & relationships, the infamous N+1 and
> LazyInitializationException traps, fetching, caching, transactions, locking, HQL/JPQL/Criteria — and
> a dedicated section on using Hibernate in **Spring Boot** and **Ktor**, with the tricky interview
> points spelled out.
>

---

## 1. What Is an ORM & Where Hibernate Fits

**ORM (Object-Relational Mapping)** bridges two worlds: your **object-oriented** code (classes,
objects, references) and a **relational database** (tables, rows, foreign keys). This mismatch is
called the **object-relational impedance mismatch** (objects have inheritance/associations; tables
don't).

**Hibernate** automates the translation: you work with Java/Kotlin objects, and Hibernate generates
the SQL to load/save them.

> **Senior framing:** "Hibernate lets me persist an object graph without writing boilerplate JDBC.
> But the abstraction leaks — you still must understand the SQL it generates, or you hit N+1 queries,
> lazy-loading exceptions, and accidental full-table loads."

**Pros:** less boilerplate, database portability (dialects), caching, dirty checking, lazy loading,
transaction & relationship management.
**Cons:** hides SQL (easy to write inefficient queries), a learning curve, and "magic" that bites
you if you don't understand the persistence context.

---

## 2. Hibernate vs JPA vs Spring Data (clearing the confusion)

A classic source of confusion — these are **layers**, not competitors:

```
Spring Data JPA   ← repositories, query derivation (highest level, least code)
       │ uses
   JPA (Jakarta Persistence)  ← the SPECIFICATION/API (interfaces, annotations)
       │ implemented by
   Hibernate         ← the IMPLEMENTATION (the engine that does the work)
       │ on top of
     JDBC            ← raw database access
```

- **JPA** = a **specification** (just interfaces & annotations like `@Entity`, `EntityManager`). It
  defines *what*, not *how*. You can't "run" JPA alone.
- **Hibernate** = the most popular **implementation** of JPA (plus extra non-standard features).
- **Spring Data JPA** = a convenience layer on top that auto-implements repositories
  (`findByEmail(...)`) — it uses Hibernate underneath.

> **"Is Hibernate the same as JPA?"** No. JPA is the spec; Hibernate is an implementation of it (the
> reference is EclipseLink). Hibernate also offers features beyond the spec (e.g., `@Type`,
> multi-tenancy, `@Formula`).

---

## 3. The Architecture: SessionFactory, Session, Transaction

| Object | JPA equivalent | What it is | Lifespan |
|---|---|---|---|
| **SessionFactory** | `EntityManagerFactory` | Heavyweight, thread-safe factory; built **once** per app; holds config, mappings, connection pool, 2nd-level cache | Application |
| **Session** | `EntityManager` | Lightweight, **NOT thread-safe**; the unit of work; manages the persistence context | One per request/transaction |
| **Transaction** | `EntityTransaction` | Atomic unit of DB work (commit/rollback) | Per business operation |

> **Trap:** `SessionFactory` is expensive and thread-safe → create **one** and share it. `Session`
> is cheap and **not thread-safe** → create one per request/thread, never share across threads.

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("myPU"); // once
EntityManager em = emf.createEntityManager();                              // per request
em.getTransaction().begin();
em.persist(new User("Sam"));
em.getTransaction().commit();
em.close();
```

---

## 4. The Persistence Context (the heart of Hibernate)

The **persistence context** (managed by the Session/EntityManager) is a **first-level cache** and an
in-memory map of all entities Hibernate is currently "managing." Understanding it explains almost
every Hibernate behavior.

**What it does for you:**
1. **Identity guarantee:** within one context, an entity with a given ID is loaded **once** — repeated
   `find()`s return the **same object instance** (`==`).
2. **First-level cache:** repeated reads of the same entity hit memory, not the DB.
3. **Dirty checking:** Hibernate snapshots loaded entities; on flush it compares and **auto-generates
   UPDATEs** for changed fields — you don't call `save()`.
4. **Write-behind:** SQL is batched and sent at **flush** time (often at commit), not immediately.

> "The persistence context is a unit-of-work + identity map + first-level cache. Dirty checking
> means I just mutate a managed entity and Hibernate writes the UPDATE at flush — no explicit save."

```java
User u = em.find(User.class, 1L);  // SELECT
u.setName("New");                  // no SQL yet — just a field change
em.getTransaction().commit();      // flush → Hibernate detects the change → UPDATE
```

---

## 5. Entity Lifecycle States

Every entity is in one of **four states** — a guaranteed interview question:

```
   new User()           persist()/save()         commit/close
  ┌──────────┐  ───────▶ ┌──────────┐  ─────────▶ ┌──────────┐
  │ TRANSIENT│           │ PERSISTENT│            │ DETACHED │
  └──────────┘           │ (managed) │ ◀───merge──└──────────┘
                         └──────────┘
                              │ remove()
                              ▼
                          ┌────────┐
                          │ REMOVED│
                          └────────┘
```

| State | Meaning | In persistence context? | In DB? |
|---|---|---|---|
| **Transient** | New object, never persisted | No | No |
| **Persistent (Managed)** | Attached & tracked; changes auto-saved | **Yes** | Yes (at flush) |
| **Detached** | Was managed, but context closed | No | Yes |
| **Removed** | Marked for deletion | Yes | Will be deleted at flush |

- `persist()` → transient becomes persistent.
- Closing the Session → entities become **detached** (this is why you get
  `LazyInitializationException` later!).
- `merge()` → copies a **detached** entity's state into a managed one (returns the managed copy).

> **`merge()` vs `update()`:** `merge()` returns a **new managed instance** and copies state in —
> the object you passed in stays detached. A super common bug is continuing to use the old reference.
> `save()/update()` are Hibernate-specific; `persist()/merge()` are JPA-standard.

---

## 6. Mapping Entities (annotations you must know)

```java
@Entity
@Table(name = "users", indexes = @Index(columnList = "email"))
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "email", nullable = false, unique = true, length = 255)
    private String email;

    @Enumerated(EnumType.STRING)          // store enum as text, NOT ordinal ()
    private Status status;

    @Column(columnDefinition = "TEXT")
    private String bio;

    @Temporal(TemporalType.TIMESTAMP)     // (legacy Date types)
    private Date createdAt;

    @Transient                            // NOT persisted
    private int computedScore;

    @Version                              // optimistic locking version
    private Long version;

    @Embedded
    private Address address;              // @Embeddable value object → columns in same table
}
```

| Annotation | Purpose |
|---|---|
| `@Entity` | Marks a class as a persistent entity |
| `@Table` | Customize table name/indexes/constraints |
| `@Id` | Primary key |
| `@GeneratedValue` | How the PK is generated (see §7) |
| `@Column` | Column details (name, nullable, unique, length) |
| `@Enumerated(STRING)` | Persist enums **by name** (avoid ordinal!) |
| `@Transient` | Field is **not** persisted |
| `@Embedded` / `@Embeddable` | Value object mapped into the same table |
| `@Version` | Version field for optimistic locking |
| `@Lob` | Large objects (CLOB/BLOB) |

> **`@Enumerated` trap:** the default is `ORDINAL` (stores 0,1,2…). If you reorder the enum, all
> stored data becomes wrong. **Always use `EnumType.STRING`.**

---

## 7. Primary Keys & ID Generation Strategies

`@GeneratedValue(strategy = ...)`:

| Strategy | How it works | Notes / trap |
|---|---|---|
| **IDENTITY** | DB auto-increment column | Simple, but **disables JDBC batch inserts** (ID known only after insert) |
| **SEQUENCE** | DB sequence object | **Preferred** (esp. Postgres/Oracle); supports batching & pre-allocation |
| **TABLE** | A separate table simulates a sequence | Portable but slow; avoid |
| **AUTO** | Hibernate picks based on dialect | Convenient; can surprise you (may create a shared sequence) |

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_seq")
@SequenceGenerator(name = "user_seq", sequenceName = "user_seq", allocationSize = 50)
private Long id;
```
> "On Postgres I use **SEQUENCE** with an `allocationSize` for batch-friendly inserts. **IDENTITY**
> blocks Hibernate's insert batching because each row needs a round trip to get its generated key."

**Natural vs surrogate keys:** prefer a **surrogate** (generated) key. If you need business keys, map
them as unique columns, not the `@Id`. **UUIDs** are great for distributed systems (`@GeneratedValue`
with `UUID`) but are larger and can fragment indexes (use UUIDv7/ordered if possible).

---

## 8. Relationships (@OneToMany, @ManyToOne, etc.)

| Annotation | Example |
|---|---|
| `@ManyToOne` | Many orders → one user (the FK side) |
| `@OneToMany` | One user → many orders |
| `@OneToOne` | User → one profile |
| `@ManyToMany` | Students ↔ courses (join table) |

```java
@Entity
class Order {
    @ManyToOne(fetch = FetchType.LAZY)     // make it LAZY!
    @JoinColumn(name = "user_id")
    private User user;                       // owning side (has the FK)
}

@Entity
class User {
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Order> orders = new ArrayList<>();   // inverse side
}
```

**Owning vs inverse side (crucial):**
- The **owning side** has the foreign key and controls the relationship in the DB.
- The **inverse side** uses `mappedBy` and is read-only for the FK.
- For a bidirectional relation, **you must set both sides in code** or the DB won't reflect it — use a
  helper: `addOrder(o){ orders.add(o); o.setUser(this); }`.

> **`mappedBy` question:** it marks the **inverse** (non-owning) side and points to the field that
> owns the relationship. Without it, Hibernate creates an unexpected extra join table or duplicate FK.

> **`@ManyToMany` trap:** in practice, model the join table as its own entity (with `@ManyToOne` on
> each side) so you can add columns (e.g., enrollment date) and avoid surprising delete/update
> behavior.

---

## 9. Fetching: Lazy vs Eager + LazyInitializationException

**Fetch type controls *when* associations load:**
- **LAZY** — load the association only when accessed (a proxy/placeholder until then).
- **EAGER** — load it immediately with the parent (a JOIN or extra query).

**Defaults (memorize!):**
| Relationship | Default fetch |
|---|---|
| `@ManyToOne` | **EAGER** |
| `@OneToOne` | **EAGER** |
| `@OneToMany` | **LAZY** |
| `@ManyToMany` | **LAZY** |

> "Best practice: make **everything LAZY** (`@ManyToOne(fetch = LAZY)`) and fetch what you need
> explicitly with **JOIN FETCH** or entity graphs. EAGER-by-default on `@ManyToOne` silently loads
> half your database."

### LazyInitializationException (the famous one)
Happens when you access a LAZY association **after the Session/transaction is closed** (the entity is
now **detached**, so the proxy can't hit the DB).

```java
User u = repo.findById(1L);   // session closes here (in a non-transactional context)
u.getOrders().size();         // 💥 LazyInitializationException — session gone
```

**Fixes (know several — a favorite follow-up):**
1. **Fetch it inside the transaction** with `JOIN FETCH` / `@EntityGraph` (best — solves N+1 too).
2. Keep the transaction **open** for the work (e.g., `@Transactional` on the service method).
3. Use a **DTO projection** — select only what you need, no lazy proxies.
4. **Avoid** `OpenSessionInView` / `spring.jpa.open-in-view=true` as a "fix" — it hides the problem,
   holds connections longer, and causes lazy queries in the view layer. Disable it and fetch
   deliberately.

> **`FetchType.EAGER` is NOT the right fix** — it just moves the cost everywhere and can cause
> cartesian-product joins. Fetch on demand per use case instead.

---

## 10. The N+1 Problem (the #1 Hibernate interview topic)

**What it is:** you run **1 query** to fetch N parents, then Hibernate fires **1 more query per
parent** to load a lazy association → **N+1 total queries.** Performance killer.

```java
List<User> users = em.createQuery("from User", User.class).getResultList(); // 1 query
for (User u : users)
    u.getOrders().size();   // N queries (one per user!)  → total N+1
```

**Why it happens:** lazy associations are loaded one-by-one as you touch them in a loop.

**Fixes (name 3–4 to sound senior):**
1. **JOIN FETCH** in JPQL — load parents + children in one query:
   ```java
   em.createQuery("select distinct u from User u join fetch u.orders", User.class);
   ```
2. **`@EntityGraph`** (JPA) — declaratively fetch associations for a query/repository method.
3. **Batch fetching** — `@BatchSize(size = 50)` or `hibernate.default_batch_fetch_size` → loads lazy
   collections in batches (`IN (...)`) instead of one-by-one (turns N+1 into N/50 + 1).
4. **DTO projection** — select exactly the columns you need in one query (no entity graph at all).

> **Tricky follow-ups:**
> - **"Does EAGER fix N+1?"** No — EAGER often *causes* N+1 (or a giant cartesian join). Use JOIN
>   FETCH/entity graphs.
> - **"Why `distinct` with `join fetch`?"** A collection join duplicates parent rows; `distinct`
>   de-dupes them in memory (add `hibernate.query.passDistinctThrough=false` to avoid the SQL DISTINCT).
> - **"Can you JOIN FETCH two collections?"** Not at once — it creates a cartesian product and
>   Hibernate throws `MultipleBagFetchException`. Fetch one collection, batch the other (or use `Set`s).

---

## 11. Cascading & orphanRemoval

**Cascade** propagates operations from parent to child so you don't manage children separately.

| CascadeType | Propagates |
|---|---|
| `PERSIST` | Saving parent saves new children |
| `MERGE` | Merging parent merges children |
| `REMOVE` | Deleting parent deletes children |
| `REFRESH` | Reload children with parent |
| `DETACH` | Detach children with parent |
| `ALL` | All of the above |

```java
@OneToMany(mappedBy="user", cascade = CascadeType.ALL, orphanRemoval = true)
private List<Order> orders;
```
- **`orphanRemoval = true`** — removing a child from the collection **deletes it from the DB**
  (`orders.remove(o)` → DELETE).
- **`CascadeType.REMOVE` vs `orphanRemoval`:** REMOVE deletes children when the **parent** is
  deleted; orphanRemoval deletes a child when it's **disassociated** from the parent. Different
  triggers!

> **Trap:** `cascade = ALL` on a `@ManyToOne` is dangerous — deleting one order would try to delete
> the shared user. Cascade usually belongs on the **parent's `@OneToMany`**, not the child's
> `@ManyToOne`.

---

## 12. Inheritance Mapping Strategies

Mapping a class hierarchy to tables — `@Inheritance(strategy = ...)`:

| Strategy | How | Pros | Cons |
|---|---|---|---|
| **SINGLE_TABLE** (default) | One table for the whole hierarchy + a **discriminator** column | Fast (no joins) | Lots of nullable columns; weak constraints |
| **JOINED** | One table per class, joined by PK | Normalized, no nulls | Joins on every query |
| **TABLE_PER_CLASS** | One full table per concrete class | No joins per class | `UNION` queries, duplicated columns; weakest |
| **@MappedSuperclass** | Not an entity — shares fields only | Simple reuse | No polymorphic queries |

> "SINGLE_TABLE is fastest and the default; JOINED when you need a clean normalized schema and
> NOT-NULL constraints. TABLE_PER_CLASS is rarely worth it."

---

## 13. Querying: JPQL/HQL, Criteria, Native, Named

| Approach | What | Use |
|---|---|---|
| **JPQL / HQL** | Object-oriented query language (queries **entities**, not tables) | Most queries |
| **Criteria API** | Type-safe, programmatic query building | Dynamic queries built at runtime |
| **Native SQL** | Raw SQL | DB-specific features, complex reports |
| **Named queries** | Predefined, validated at startup | Reused, static queries |

```java
// JPQL — note it uses ENTITY/field names, not table/column names
List<User> us = em.createQuery(
    "select u from User u where u.status = :s order by u.createdAt desc", User.class)
    .setParameter("s", Status.ACTIVE)
    .setMaxResults(20)        // pagination
    .getResultList();

// JOIN FETCH to avoid N+1
"select distinct u from User u join fetch u.orders where u.id = :id"

// Native
em.createNativeQuery("SELECT * FROM users WHERE email = ?1", User.class);
```

> **JPQL ≠ SQL:** JPQL operates on the **object model** (`User.status`), which Hibernate translates
> to SQL. Always use **bind parameters** (`:s`), never string concatenation — prevents SQL injection
> and enables plan caching.

---

## 14. Caching: First-Level, Second-Level, Query Cache

| Cache | Scope | Default | What |
|---|---|---|---|
| **First-level** | Per **Session** | **Always on** (can't disable) | The persistence context — dedupes reads within one session |
| **Second-level** | Across sessions (SessionFactory) | **Off** by default | Shared entity cache (Ehcache, Infinispan, Caffeine, Redis) |
| **Query cache** | Across sessions | Off | Caches query **result IDs** (needs 2nd-level cache too) |

```java
@Entity
@Cacheable
@org.hibernate.annotations.Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
class Country { ... }   // good 2nd-level cache candidate (rarely changes)
```

> **Tricky points:**
> - First-level cache is **mandatory and per-session** — it's why two `find()`s in one session return
>   the same instance with one SELECT.
> - Second-level cache is **shared and opt-in**; only cache **rarely-changing** reference data, or you
>   fight stale data and invalidation bugs.
> - **Query cache caches IDs, not rows** — without the 2nd-level cache it re-fetches each entity. Easy
>   to misuse and make things slower.

---

## 15. Transactions, Flush & Dirty Checking

- **Flush** = synchronize the persistence context to the DB (send the SQL). It does **not** commit.
- **Commit** triggers a flush, then commits the transaction.
- **FlushMode:** `AUTO` (default — flush before queries & at commit) vs `COMMIT` (only at commit) vs
  `MANUAL`.

**Dirty checking:** Hibernate keeps a **snapshot** of each managed entity at load time; at flush it
diffs current vs snapshot and emits UPDATEs only for changed entities — **you never call `save()` for
updates** to a managed entity.

```java
@Transactional
public void rename(Long id, String name) {
    User u = em.find(User.class, id);  // managed
    u.setName(name);                   // just mutate — no save() needed
}                                      // commit → flush → UPDATE
```

> **Trap:** mutating a **detached** entity does nothing — dirty checking only works on **managed**
> entities inside an open context. You'd need `merge()`.

> "I keep transactions short, do reads/writes inside `@Transactional`, and rely on dirty checking
> for updates. I flush manually only when I need generated IDs mid-transaction."

---

## 16. Concurrency: Optimistic vs Pessimistic Locking

Two strategies to prevent **lost updates** when concurrent transactions touch the same row:

### Optimistic locking (default choice)
Assume conflicts are rare. Add a **`@Version`** column; on update Hibernate checks the version didn't
change, else throws `OptimisticLockException`.
```java
@Version private Long version;
// UPDATE ... SET version = 2 WHERE id = ? AND version = 1   → 0 rows = conflict
```
- **Pros:** no DB locks, scales well, great for web apps.
- **Cons:** the loser must retry. Good when conflicts are infrequent.

### Pessimistic locking
Assume conflicts are likely → **lock the row in the DB** (`SELECT ... FOR UPDATE`) so others wait.
```java
em.find(Account.class, id, LockModeType.PESSIMISTIC_WRITE);
```
- **Pros:** guarantees exclusivity (e.g., financial balance updates).
- **Cons:** locks hurt concurrency; risk of deadlocks.

> "Default to **optimistic** locking with `@Version` for typical web traffic; use **pessimistic**
> for short, hot, high-contention critical sections like decrementing inventory or moving money."

---

## 17. Performance Tuning & Best Practices

- **Make associations LAZY**, fetch explicitly with `JOIN FETCH` / `@EntityGraph`.
- **Kill N+1**: join fetch, `@BatchSize`, or DTO projections.
- **Use DTO/projections** for read-only screens — skip the persistence context entirely.
- **Batch writes**: `hibernate.jdbc.batch_size=50`, `order_inserts/order_updates=true`, and use
  **SEQUENCE** (not IDENTITY) so batching works.
- **Pagination**: `setFirstResult/setMaxResults`; avoid `JOIN FETCH` + pagination on collections
  (Hibernate paginates **in memory** and warns — `HHH000104`).
- **`@Transactional(readOnly = true)`** for reads — skips dirty-check snapshots, hints flush mode.
- **Second-level cache** only for static reference data.
- **Monitor the SQL**: enable `show_sql`/`format_sql`, use `hibernate.generate_statistics`, or a tool
  like p6spy/datasource-proxy to catch N+1 in tests.
- **`@DynamicUpdate`** to update only changed columns (for wide tables).

> "My golden rule: **lazy by default, fetch on purpose.** I assert query counts in tests to catch
> N+1 before production."

---

## 18. Common Pitfalls & Tricky Gotchas

These separate seniors from juniors:

1. **`LazyInitializationException`** — accessing lazy data after the session closed. Fetch in the
   transaction or use DTOs (§9).
2. **N+1 queries** — the silent performance killer (§10).
3. **`equals()`/`hashCode()` on entities** — don't use the generated `@Id` (it's null before
   persist, breaking `Set`s). Use a **business key** or a stable UUID assigned in the constructor.
4. **`@Enumerated` defaulting to ORDINAL** — reordering enums corrupts data. Use `STRING`.
5. **`merge()` returns a new instance** — keep using the returned object, not the argument.
6. **`open-in-view = true`** (Spring default) — hides lazy issues, holds DB connections into the view
   layer. Disable and fetch deliberately.
7. **Bidirectional sync** — set both sides; otherwise the FK isn't written / stale collections.
8. **`MultipleBagFetchException`** — can't `JOIN FETCH` two `List` collections at once; use `Set` or
   batch the second.
9. **Modifying a collection's reference** (`user.setOrders(newList)`) confuses Hibernate's tracking —
   mutate the existing collection instead.
10. **Cartesian products** from multiple eager/joined collections — row explosion.
11. **Transaction boundaries** — lazy loading and dirty checking only work **inside** an open
    transaction/session.
12. **Using `getOne()`/`getReference()`** returns a **proxy** — touching it outside a session throws.

> The classic three asked together: **"Explain N+1, LazyInitializationException, and how entity
> `equals/hashCode` should work."** Know all three cold.

---

## 19. Hibernate in Spring Boot

Spring Boot makes Hibernate (via **Spring Data JPA**) almost zero-config — but the tricky points
remain.

### Setup
`spring-boot-starter-data-jpa` auto-configures Hibernate, a `DataSource` (HikariCP pool), an
`EntityManager`, and a `JpaTransactionManager`.
```properties
spring.datasource.url=jdbc:postgresql://localhost/app
spring.jpa.hibernate.ddl-auto=validate     # NEVER 'update'/'create' in prod (use Flyway/Liquibase)
spring.jpa.show-sql=true
spring.jpa.properties.hibernate.format_sql=true
spring.jpa.open-in-view=false              # disable OSIV — fetch deliberately
spring.jpa.properties.hibernate.jdbc.batch_size=50
spring.jpa.properties.hibernate.default_batch_fetch_size=50
```

### Repositories (Spring Data)
```java
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);          // derived query

    @Query("select u from User u join fetch u.orders where u.id = :id")
    Optional<User> findWithOrders(@Param("id") Long id); // JOIN FETCH to avoid N+1

    @EntityGraph(attributePaths = "orders")
    List<User> findByStatus(Status status);              // declarative fetch
}
```

### `@Transactional` — the tricky points
- **Where:** put it on **service** methods (your unit of work), not controllers or repositories alone.
- **Proxy-based:** Spring's `@Transactional` works via a proxy, so:
  - **Self-invocation fails** — calling another `@Transactional` method *in the same class* bypasses
    the proxy (no new transaction). Move it to another bean.
  - **Only `public` methods** are advised (with the default proxy mode).
- **`readOnly = true`** for queries — optimization + flush hint.
- **Propagation** (`REQUIRED` default, `REQUIRES_NEW`, `NESTED`) and **isolation** are configurable.
- **Rollback rule:** by default Spring rolls back on **unchecked** (RuntimeException) only — **not
  checked exceptions**. Use `@Transactional(rollbackFor = Exception.class)` if needed.
- **Lazy loading** works only **inside** the `@Transactional` boundary (with OSIV off) — fetch what
  you need there or return DTOs.

> **Top Spring Boot + Hibernate interview hits:**
> - **`open-in-view`**: default `true`, why to turn it off (connection held through view render,
>   hidden lazy queries).
> - **`ddl-auto`**: never `update`/`create-drop` in production — use **Flyway/Liquibase** migrations;
>   `validate` is the safe prod setting.
> - **Self-invocation** breaking `@Transactional`.
> - **N+1** in repository methods → fix with `@EntityGraph`/`JOIN FETCH`.
> - **DTO projections** (interface/class projections) for read endpoints to skip entities entirely.

---

## 20. Hibernate in Ktor (and Kotlin specifics)

Ktor (the Kotlin async web framework) has **no built-in ORM**, so you wire Hibernate/JPA manually — or
more idiomatically use **Exposed** (JetBrains' Kotlin SQL framework). Interviewers like to probe the
trade-offs.

### Using Hibernate/JPA with Ktor
You manage the `EntityManagerFactory`/`SessionFactory` yourself and the transaction per request:
```kotlin
val emf = Persistence.createEntityManagerFactory("myPU")  // once, at startup

fun <T> tx(block: (EntityManager) -> T): T {
    val em = emf.createEntityManager()
    val t = em.transaction
    try { t.begin(); val r = block(em); t.commit(); return r }
    catch (e: Exception) { if (t.isActive) t.rollback(); throw e }
    finally { em.close() }
}

routing {
    get("/users/{id}") {
        val user = tx { em -> em.find(User::class.java, call.parameters["id"]!!.toLong()) }
        call.respond(user.toDto())   // map to DTO BEFORE the session closes (avoid lazy issues)
    }
}
```

### Kotlin-specific gotchas with Hibernate (great interview points)
1. **`open` classes:** Hibernate needs to subclass entities for **proxies/lazy loading**, but Kotlin
   classes are **`final` by default** → use the **`kotlin-allopen` / `kotlin-jpa` (no-arg) Gradle
   plugins** to make `@Entity` classes `open` and give them a no-arg constructor.
2. **No-arg constructor:** JPA requires one; the **`kotlin-jpa` plugin** synthesizes it (Kotlin
   doesn't generate it otherwise).
3. **`data class` for entities is discouraged** — its generated `equals/hashCode/toString` use all
   properties (including lazy associations → triggers loading / `LazyInitializationException`, and
   breaks identity). Use a regular class with a business-key `equals/hashCode`.
4. **Nullability:** map nullable DB columns to Kotlin **nullable types** (`String?`); non-null Kotlin
   properties on nullable columns blow up on load.
5. **`val` vs `var`:** Hibernate sets fields reflectively, but mutable persistent fields generally need
   `var`.
6. **Threading/coroutines:** the JPA `EntityManager`/Session is **not thread-safe** and is bound to
   a thread; Ktor is coroutine-based, so don't share a session across `withContext`/suspension
   boundaries. Run blocking JPA on a dedicated dispatcher (`Dispatchers.IO`) and keep the session
   within one coroutine/transaction.

> "In Ktor I either use **Exposed** (idiomatic, coroutine-friendly) or wire JPA/Hibernate manually
> with the **kotlin-jpa/all-open** plugins, regular (non-data) entity classes, business-key equals,
> and a session-per-request helper — mapping to DTOs before the session closes. JPA's blocking,
> thread-bound session doesn't mix with coroutines, so I isolate it on `Dispatchers.IO`."

### Exposed (the Kotlin-native alternative)
JetBrains' **Exposed** offers a typesafe DSL and a lightweight DAO — no proxies, no
`LazyInitializationException`, coroutine support via `newSuspendedTransaction`. Worth name-dropping as
the "Kotlin-first" choice versus dragging in Hibernate.

---

## 21. Interview Q&A Bank

**Q: Hibernate vs JPA?**
> JPA is the specification (interfaces/annotations); Hibernate is the most popular implementation of
> it, with extra features. Spring Data JPA sits on top to auto-generate repositories.

**Q: Explain the persistence context.**
> A session-scoped unit of work that acts as an identity map and first-level cache, providing dirty
> checking and write-behind. It guarantees one managed instance per entity ID per session.

**Q: What are the entity lifecycle states?**
> Transient (new, unmanaged), Persistent/Managed (tracked, auto-saved), Detached (was managed, session
> closed), Removed (marked for deletion).

**Q: What is the N+1 problem and how do you fix it?**
> One query loads N parents, then one query per parent loads a lazy association → N+1 queries. Fix with
> JOIN FETCH, `@EntityGraph`, `@BatchSize`, or DTO projections. EAGER does NOT fix it.

**Q: What causes LazyInitializationException?**
> Accessing a lazy association after the session/transaction closed (entity is detached). Fix by
> fetching within the transaction (JOIN FETCH/entity graph) or returning DTOs — not by switching to
> EAGER or relying on open-in-view.

**Q: Default fetch types?**
> @ManyToOne and @OneToOne are EAGER; @OneToMany and @ManyToMany are LAZY. Best practice: make
> everything LAZY and fetch explicitly.

**Q: How does dirty checking work?**
> Hibernate snapshots managed entities at load; at flush it compares and issues UPDATEs only for
> changed ones — no explicit save needed for managed entities.

**Q: Optimistic vs pessimistic locking?**
> Optimistic uses a @Version column and detects conflicts at commit (no locks, scales, retry on
> conflict). Pessimistic locks the row in the DB (SELECT FOR UPDATE) for high-contention critical
> sections. Default to optimistic.

**Q: merge() vs persist() vs save()/update()?**
> persist() makes a transient entity managed (void, JPA). merge() copies a detached entity's state into
> a managed copy and returns it (JPA). save()/update() are Hibernate-specific. Watch that merge returns
> a new instance.

**Q: First vs second-level cache?**
> First-level = per-session, always on, dedupes within a session. Second-level = shared across
> sessions, opt-in, for rarely-changing reference data. Query cache stores result IDs and needs the
> second-level cache.

**Q: Why shouldn't entities be Kotlin data classes / use @Id in equals?**
> data classes' equals/hashCode touch all fields (triggering lazy loads, breaking identity); generated
> IDs are null before persist, breaking Set membership. Use a regular class with a stable business-key
> equals/hashCode.

**Q: Spring Boot: what is open-in-view and why disable it?**
> OSIV keeps the persistence context open through view rendering so lazy loads don't fail — but it
> holds DB connections longer and hides N+1/lazy issues. Disable it (`spring.jpa.open-in-view=false`)
> and fetch deliberately.

**Q: Why can @Transactional silently not work?**
> It's proxy-based: self-invocation (calling a @Transactional method from within the same bean) and
> non-public methods bypass the proxy. Also, by default it only rolls back on unchecked exceptions.

**Q: ddl-auto in production?**
> Use `validate` (or `none`) and manage schema with Flyway/Liquibase. Never `update`/`create`/
> `create-drop` in prod — risk of data loss and uncontrolled schema drift.

**Q: How do you use Hibernate with Ktor/Kotlin?**
> Wire JPA manually with the kotlin-jpa/all-open plugins (entities need to be open + no-arg), use
> regular non-data entity classes, manage a session-per-request, map to DTOs before closing, and keep
> the thread-bound session off coroutine boundaries — or use Exposed instead.

---

## 22. Cheat Sheet

- **Layers:** Spring Data JPA → JPA (spec) → Hibernate (impl) → JDBC.
- **SessionFactory** (one, thread-safe) vs **Session/EntityManager** (per request, NOT thread-safe).
- **Persistence context** = identity map + 1st-level cache + dirty checking + write-behind.
- **States:** Transient · Persistent · Detached · Removed.
- **Make associations LAZY; fetch with JOIN FETCH / @EntityGraph.**
- **N+1** → join fetch / @EntityGraph / @BatchSize / DTOs (NOT eager).
- **LazyInitializationException** → fetch inside the transaction / DTOs; turn **open-in-view off**.
- **IDs:** prefer **SEQUENCE** (batch-friendly) over IDENTITY; surrogate keys.
- **Enums:** `@Enumerated(STRING)`, never ordinal.
- **equals/hashCode:** business key, not generated `@Id`.
- **Cascade** propagates ops; **orphanRemoval** deletes disassociated children.
- **Locking:** optimistic (`@Version`) by default; pessimistic for hot rows.
- **Spring Boot:** `ddl-auto=validate` + Flyway/Liquibase; `open-in-view=false`; `@Transactional` on
  services; beware self-invocation & checked-exception rollback.
- **Ktor/Kotlin:** kotlin-jpa/all-open plugins, non-data entity classes, session-per-request, DTOs
  before close, keep sessions off coroutine boundaries — or use **Exposed**.

---

*End of handbook. Master the persistence context, lazy loading, and N+1 — they're behind almost every
Hibernate interview question.*
