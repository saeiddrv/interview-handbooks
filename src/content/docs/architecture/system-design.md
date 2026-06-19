---
title: "System Design — Interview Handbook"
description: "A complete, easy-to-understand guide to designing large-scale systems: the building blocks, the patterns, the real problems you hit at scale, and how to…"
sidebar:
  label: "System Design"
---

> A complete, easy-to-understand guide to designing large-scale systems: the building blocks, the
> patterns, the real problems you hit at scale, and how to answer the interview. Plain English,
> real examples, trade-offs, and a deep Q&A bank.
>

---

## 1. How to Answer a System Design Interview (the framework)

The interview isn't about the "right" answer — it's about **how you think and make trade-offs.**
Follow this 6-step structure every time so you never freeze:

1. **Clarify requirements (3–5 min).** Don't jump to a diagram. Split into:
   - **Functional:** what it does (e.g., "post a tweet, see a feed").
   - **Non-functional:** scale, latency, availability, consistency, read/write ratio.
   - **Scope:** "Should I include notifications? Let's focus on the feed first."
2. **Estimate scale (back-of-envelope).** Users, QPS, storage, bandwidth. This *drives* every later
   decision (a 100-user app and a 100M-user app look nothing alike).
3. **Define the API.** A few key endpoints — it pins down the data flowing in/out.
4. **High-level design.** Draw the boxes: clients → load balancer → services → cache → database →
   queue. Get the happy path working end to end.
5. **Deep dive.** The interviewer picks a piece ("how does the feed scale?") and you go deep:
   data model, sharding, caching, bottlenecks.
6. **Address bottlenecks & trade-offs.** Single points of failure, hot spots, scaling limits. State
   what you'd monitor and what you'd do next.

> **Senior signal:** Always say the trade-off out loud — *"I'll use X, which gives us Y but costs
> us Z."* There's rarely a perfect choice; showing you know the cost is the whole point.

> **Trap:** Designing for 1 billion users when they asked for 10,000. **Match the design to the
> scale.** Over-engineering is as bad as under-engineering.

---

## 2. The Numbers Every Engineer Should Know

**Latency ladder (orders of magnitude — memorize the *gaps*, not exact figures):**

| Operation | Rough time |
|---|---|
| L1/L2 CPU cache | ~1 ns |
| Main memory (RAM) read | ~100 ns |
| Read 1 MB from RAM | ~10 µs |
| SSD random read | ~100 µs |
| Round trip within a datacenter | ~0.5 ms |
| Read 1 MB from SSD | ~1 ms |
| Disk (HDD) seek | ~10 ms |
| Network round trip US↔Europe | ~150 ms |

**Takeaway:** RAM is ~100,000× faster than a cross-continent round trip. This is **why we cache, keep
data close to users (CDN), and avoid chatty cross-service calls.**

**Estimation cheat values:**
- 1 day ≈ **86,400 s** (≈ 100k for quick math).
- "1 million writes/day" ≈ **~12 writes/sec** average → but **plan for peak (×2–10)**.
- Storage: rows × bytes/row × replication factor × growth.

> **Example estimate:** 100M daily users, each makes 10 requests → 1B requests/day ÷ ~100k s ≈
> **~10,000 QPS average**, maybe **~50,000 QPS peak**. Now you know you need horizontal scaling, load
> balancing, and caching — not one big server.

---

## 3. Core Building Blocks

| Block | What it does | Real example |
|---|---|---|
| **Client** | Browser/mobile/app sending requests | React app, iOS app |
| **DNS** | Maps domain → IP | `api.example.com` → 1.2.3.4 |
| **Load Balancer** | Spreads traffic across servers | Nginx, AWS ELB |
| **Web/App Server** | Runs your business logic | Node, Java, Go services |
| **Database** | Durable storage | Postgres, DynamoDB |
| **Cache** | Fast in-memory lookups | Redis, Memcached |
| **CDN** | Serves static content near users | Cloudflare, CloudFront |
| **Message Queue** | Decouples & buffers async work | Kafka, RabbitMQ, SQS |
| **Object Storage** | Big files (images/video) | S3, GCS |
| **Search Index** | Full-text / relevance search | Elasticsearch, OpenSearch |

**The shape of almost every web system:**
```
Client → DNS → CDN (static) ─┐
                             ▼
                       Load Balancer → App Servers ──→ Cache (Redis)
                                            │              │ miss
                                            ▼              ▼
                                      Message Queue     Database (primary + replicas)
                                            │
                                            ▼
                                    Workers (async jobs)
```

---

## 4. Scaling Fundamentals

### Vertical vs Horizontal scaling
- **Vertical (scale up):** bigger machine (more CPU/RAM). Simple, but a ceiling exists and it's a
  single point of failure. Good early.
- **Horizontal (scale out):** more machines. Near-unlimited, fault-tolerant, but needs load balancing
  and **stateless** servers. The real answer for scale.

> **Key principle:** Keep app servers **stateless** (no user session stored on the server) so any
> server can handle any request. Push state to a shared store (Redis/DB). This is what makes
> horizontal scaling and auto-scaling possible.

### Load Balancing
Distributes requests across servers and removes dead ones (health checks).
- **Algorithms:** round-robin, least-connections, IP-hash (sticky), weighted.
- **L4 (transport)** vs **L7 (application/HTTP-aware, can route by path/header).**
- **Don't let the LB be a single point of failure** — run it redundantly (active-passive / DNS).

### Stateless + the session problem
If servers are stateless, where do logins/sessions live? Options: a shared cache (Redis), or
**stateless tokens (JWT)** the client carries. (Trade-off: JWTs are hard to revoke before expiry.)

---

## 5. Caching (and its hard problems)

Caching stores hot data in fast memory to cut latency and database load. **It's the #1 scaling lever**
— but it introduces *the two hardest problems in computer science: naming things, cache invalidation,
and off-by-one errors.* 🙂

### Where caches live
- **Client/browser cache**, **CDN** (static + edge), **application cache** (Redis/Memcached),
  **database cache** (query/buffer), **in-process** (local memory).

### Caching strategies
| Strategy | How it works | Best for |
|---|---|---|
| **Cache-aside (lazy)** | App checks cache; on miss, reads DB and populates cache | Most read-heavy apps |
| **Read-through** | Cache library loads from DB on miss automatically | Cleaner code |
| **Write-through** | Write to cache + DB together (sync) | Consistency over write speed |
| **Write-back (write-behind)** | Write to cache, flush to DB later (async) | Write-heavy; risk data loss on crash |

### The hard problems
- **Invalidation:** when data changes, stale cache must be updated/evicted. Hard to get right.
- **TTL (expiry):** simplest invalidation — let entries expire. Trade freshness vs load.
- **Eviction policies:** **LRU** (least recently used), LFU, FIFO — what to drop when full.
- **Cache stampede / thundering herd:** a hot key expires and thousands of requests hit the DB at
  once. Fixes: **locking/single-flight** (only one request rebuilds it), **staggered TTL/jitter**,
  **stale-while-revalidate**.
- **Hot keys:** one key (a celebrity's profile) overwhelms a single cache node. Fixes: replicate the
  key, add a local cache layer.

> **Classic question — "How do you keep cache and DB consistent?"** There's no perfect answer.
> Common pattern: **cache-aside + write invalidation** (on update, write DB then delete the cache
> key). Accept a tiny staleness window, or use write-through if you need stronger consistency. Say
> the trade-off.

---

## 6. Databases: SQL vs NoSQL, Replication, Sharding

### SQL vs NoSQL — pick by need, not hype
| | SQL (Postgres, MySQL) | NoSQL (DynamoDB, Mongo, Cassandra) |
|---|---|---|
| **Model** | Tables, relations, joins | Key-value, document, wide-column, graph |
| **Schema** | Fixed, enforced | Flexible |
| **Consistency** | Strong (ACID) | Often eventual (BASE), tunable |
| **Scale** | Vertical + read replicas; sharding is manual | Horizontal scaling built in |
| **Best for** | Complex queries, transactions, integrity (payments) | Massive scale, simple access patterns, high write throughput |

> "Default to a relational DB until a real requirement (scale, write throughput, flexible schema)
> forces NoSQL. 'Boring' Postgres handles far more than people think."

### Replication (copies for reads & safety)
- **Primary–replica (leader–follower):** writes go to primary, reads spread across replicas.
  - **Pros:** scales reads, high availability, backups.
  - **Cons:** **replication lag** → a replica may serve slightly stale data (read-your-writes
    problem). **Async** = fast but can lose recent writes on failover; **sync** = safe but slower.
- **Multi-primary:** multiple write nodes → write conflicts to resolve (hard).

### Sharding (partitioning) — splitting data across machines
When data/writes outgrow one machine, split the dataset into **shards**.
- **Strategies:**
  - **Range-based** (e.g., A–M / N–Z): simple, but **hot spots** if data is skewed.
  - **Hash-based:** even spread, but range queries become hard.
  - **Consistent hashing:** minimizes data movement when adding/removing nodes (used by Cassandra,
    DynamoDB, caches).
  - **Directory/lookup:** a service maps keys → shard (flexible, but the directory is a dependency).
- **Hard parts:** cross-shard joins/transactions, rebalancing, hot shards, and picking a good
  **shard key** (the single most important decision — a bad key creates hotspots).

> **"How do you choose a shard key?"** Pick something with **high cardinality and even access** so
> load spreads (e.g., `user_id` hashed), and that matches your most common query so you avoid
> cross-shard fan-out. Avoid low-cardinality keys (like `country`) or monotonically increasing keys
> (like timestamps) that create hot shards.

---

## 7. The CAP Theorem & Consistency Models

**CAP:** in a distributed system, during a **network partition (P)** you must choose between
**Consistency (C)** and **Availability (A)** — you can't have both at that moment.

- **CP (consistency over availability):** refuse/err on some requests to avoid serving stale/wrong
  data. Example: a banking ledger.
- **AP (availability over consistency):** always respond, even if data is slightly stale; reconcile
  later. Example: social feed, shopping cart.

> **Nuance interviewers love:** CAP is about behavior **during a partition**. When the network is
> healthy you can have both. The real-world spectrum is **PACELC**: *if Partition → choose A or C;
> Else (normal) → choose Latency or Consistency.*

**Consistency models (from strong to weak):**
- **Strong/linearizable:** everyone sees the latest write immediately (slow, costly).
- **Read-your-own-writes:** you always see your own updates (common UX expectation).
- **Eventual:** all replicas converge *eventually*; reads may be briefly stale (cheap, highly
  available).

**ACID vs BASE:** SQL leans **ACID** (Atomic, Consistent, Isolated, Durable). Many NoSQL systems lean
**BASE** (Basically Available, Soft state, Eventual consistency).

---

## 8. Asynchronous Processing: Queues & Streaming

**The idea:** don't make the user wait for slow work. Accept the request, drop a job on a **queue**,
return immediately, and let **workers** process it in the background.

```
User → API (fast: "accepted") → Queue → Workers → DB / email / video transcode
```

**Why queues are a superpower:**
- **Decoupling:** producer and consumer don't need to be up at the same time.
- **Buffering / load leveling:** absorb traffic spikes; workers drain at their own pace.
- **Resilience:** if a worker dies, the job stays in the queue and is retried.
- **Scaling:** add more workers to go faster.

**Queue vs Stream:**
- **Message queue (RabbitMQ, SQS):** a job is consumed once and removed. Good for task processing.
- **Event stream (Kafka, Kinesis):** an append-only log; many consumers read independently, can
  replay history. Good for event-driven architectures, analytics, CDC.

**Delivery guarantees:**
- **At-most-once** (may lose), **at-least-once** (may duplicate — make consumers **idempotent!**),
  **exactly-once** (hard/expensive; usually approximated with idempotency + dedup keys).

**Other must-knows:**
- **Dead-letter queue (DLQ):** where messages go after repeated failures, for inspection.
- **Idempotency:** processing the same message twice must not double-charge a card — use an
  idempotency key.
- **Ordering:** global ordering is expensive; Kafka guarantees order **per partition** only.

> "Anything slow or failure-prone — emails, payments, video processing, notifications — goes async
> behind a queue with retries, a DLQ, and idempotent consumers."

---

## 9. Communication: REST, gRPC, GraphQL, WebSockets

| Style | What | Best for | Trade-off |
|---|---|---|---|
| **REST** | HTTP + JSON resources | Public APIs, simple CRUD | Over/under-fetching; many round trips |
| **GraphQL** | Client asks for exactly the fields it needs | Complex/varied frontends; mobile | Server complexity, caching harder, N+1 risk |
| **gRPC** | Binary (protobuf) RPC over HTTP/2 | Fast internal service-to-service | Not browser-native; less human-readable |
| **WebSockets** | Persistent two-way connection | Real-time (chat, live updates) | Stateful connections to manage at scale |
| **Webhooks / SSE** | Server pushes events to client/3rd party | Notifications, one-way streams | Delivery/retry handling |

- **Polling vs Long-polling vs WebSockets vs SSE** for "live" features:
  - **Polling:** ask repeatedly (simple, wasteful).
  - **Long-polling:** hold the request until data is ready (better, still HTTP).
  - **SSE:** server→client stream over HTTP (one-way, simple).
  - **WebSockets:** full duplex (chat, games, collaborative editing).

> **API design basics they probe:** versioning (`/v1/`), pagination (cursor > offset at scale),
> idempotency keys for writes, rate limiting, auth (OAuth/JWT), and clear status codes.

---

## 10. Architecture Patterns

### Monolith
One deployable app. **Pros:** simple to build/deploy/debug early; no network between modules.
**Cons:** scales as one unit, one bug can take it all down, hard to grow with a big team.
> **Start with a (well-structured) monolith.** Most "we need microservices" decisions are
> premature. Split out services when team size, scaling, or deploy independence demands it.

### Microservices
Many small, independently deployable services, each owning its data.
- **Pros:** independent scaling/deploys, team autonomy, fault isolation, tech flexibility.
- **Cons:** distributed-systems complexity — network failures, data consistency across services,
  testing, observability, "distributed monolith" if coupled wrong.
- **Key rules:** each service owns its **own database** (no sharing); communicate via APIs/events;
  design around **business capabilities**.

### Event-Driven Architecture
Services emit **events**; others react. Loose coupling, great for scale and extensibility.
- **CQRS (Command Query Responsibility Segregation):** separate the write model from optimized read
  models. Good when reads and writes have very different scale/shape.
- **Event Sourcing:** store the **sequence of events** as the source of truth (rebuild state by
  replaying). Powerful audit/history, but complex.
- **Saga pattern:** manage a transaction **across multiple services** without a distributed lock —
  a series of local transactions with **compensating actions** to undo on failure (e.g., cancel the
  order if payment fails). The standard answer to "how do microservices do transactions?"

### API Gateway & Service Discovery
- **API Gateway:** single entry point — auth, rate limiting, routing, aggregation.
- **Service discovery:** services find each other dynamically (Consul, etcd, k8s DNS).
- **Service mesh (Istio/Linkerd):** handles service-to-service traffic, retries, mTLS, observability.

---

## 11. Resilience Patterns (the system won't fall over)

Real systems **partially fail all the time.** These patterns keep failures contained:

| Pattern | Problem it solves |
|---|---|
| **Timeout** | Don't wait forever on a slow dependency |
| **Retry (with exponential backoff + jitter)** | Recover from transient blips without stampeding |
| **Circuit breaker** | Stop calling a failing service; "open" the circuit, fail fast, recover gradually |
| **Bulkhead** | Isolate resources so one overloaded part doesn't sink the whole ship |
| **Rate limiting / throttling** | Protect against abuse & overload (token bucket, leaky bucket) |
| **Load shedding** | Drop low-priority work under extreme load to stay alive |
| **Graceful degradation** | Serve a reduced experience instead of total failure (e.g., feed without recommendations) |
| **Idempotency** | Safe retries — no double effects |
| **Health checks + auto-restart** | Replace dead instances automatically |
| **Redundancy / failover** | No single point of failure; standby takes over |

> **"What happens when the database goes down?"** Promote a replica (failover), serve reads from
> cache/replicas, queue writes if possible, return graceful errors, and have the circuit breaker stop
> hammering it. Multi-AZ/region redundancy avoids a single point of failure.

> **Retry storms:** naive retries during an outage make it worse. Always use **backoff + jitter**
> and a **circuit breaker**.

---

## 12. Real Scaling Challenges & How to Solve Them

The problems you actually hit as systems grow — interviewers love these.

**1. The database is the bottleneck (most common).**
→ Add **read replicas** for reads, **cache** hot reads, **shard** for writes, move heavy work to
**async queues**, add **connection pooling** (e.g., PgBouncer), and use **CDC** to feed search/
analytics instead of querying the primary.

**2. Hot spots / hot keys / celebrity problem.**
→ One key (Taylor Swift's profile, a viral tweet) overwhelms one node. Solutions: replicate hot data,
add a local/edge cache, dedicate capacity, or **fan-out on read** for celebrities (see feed example).

**3. Thundering herd / cache stampede.**
→ Single-flight locks, TTL jitter, stale-while-revalidate, pre-warming caches.

**4. Read-your-own-writes under replication lag.**
→ Route a user's reads to the primary right after they write, or read from cache you just updated, or
use sticky sessions briefly.

**5. Distributed transactions across services.**
→ Avoid 2-phase commit; use the **Saga pattern** with compensating actions and the **outbox pattern**
(write event + data in one local transaction, then publish reliably).

**6. Duplicate processing / double charges.**
→ **Idempotency keys** + dedup tables; at-least-once delivery means consumers must be idempotent.

**7. Global users / latency.**
→ **CDN** for static, **multi-region** deployments, geo-DNS / geo-routing, edge caching, data
locality (store data near the users who use it).

**8. Generating unique IDs at scale.**
→ Don't rely on a single auto-increment. Use **UUIDs** (random) or **Snowflake IDs** (timestamp +
machine + sequence) for sortable, distributed, collision-free IDs.

**9. Big files (images/video).**
→ Don't put blobs in the DB. Store in **object storage (S3)**, serve via **CDN**, keep only metadata
+ URL in the DB. Use **pre-signed URLs** for direct upload/download.

**10. Observability gap — "why is it slow?"**
→ The three pillars: **metrics** (Prometheus), **logs** (ELK), **traces** (OpenTelemetry/Jaeger).
Plus dashboards, alerting on **SLOs**, and distributed tracing to follow a request across services.

**11. Backpressure.**
→ When a downstream can't keep up, signal upstream to slow down (bounded queues, rate limits) instead
of collapsing.

**12. Data growth / cost.**
→ Tiered storage (hot/warm/cold), archiving, TTL on old data, compression, partitioning by time.

---

## 13. Designing for Specific Concerns

- **Full-text search:** don't `LIKE '%...%'` a huge SQL table. Use **Elasticsearch/OpenSearch**, fed
  asynchronously (CDC) from the primary DB.
- **Geospatial / "nearby":** geohashing, quadtrees, or PostGIS / specialized geo indexes.
- **Rate limiter design:** token bucket / sliding window in Redis (a classic standalone question).
- **Notification system:** queue + workers + per-channel (push/email/SMS) + user prefs + dedup.
- **Analytics / data pipeline:** stream events to Kafka → process (Spark/Flink) → data warehouse
  (Snowflake/BigQuery). Keep OLTP (transactions) separate from OLAP (analytics).
- **File upload at scale:** pre-signed S3 URLs (client uploads directly), then a worker processes
  (thumbnails/transcoding) via a queue.

---

## 14. Worked Example: Design a URL Shortener (bit.ly)

A favorite warm-up. Walk the framework:

**Requirements:** shorten a long URL → short code; redirect short → long. Read-heavy (~100:1
reads:writes). Low latency, high availability.

**Scale estimate:** say 100M new URLs/month ≈ ~40 writes/s, but billions of redirects → **reads
dominate** → cache + replicas.

**API:**
```
POST /shorten { url } → { short_url }
GET  /{code}         → 301 redirect to long URL
```

**Core design — how to make the short code:**
- **Option A:** hash the URL (e.g., base62 of a hash) — risk of collisions, handle by retry.
- **Option B (cleaner):** a **counter / ID generator** → base62-encode the unique ID into a short
  code (`https://short.ly/aZ4k`). Guaranteed unique, no collisions. Use a distributed ID generator
  (Snowflake) or pre-allocated ID ranges per server.

**Data model:** `code (PK) → long_url, created_at, owner, expiry`. A simple **key-value store**
(DynamoDB/Redis) is ideal because the access pattern is "look up by code."

**Read path (the hot path):**
```
GET /aZ4k → check Redis cache → hit: redirect
                              → miss: read DB, populate cache, redirect
```
**Scaling:** CDN/edge + Redis for the massive read volume; replicas; the write path is tiny.

> **Trade-offs to mention:** base62 counter (no collisions, but needs a distributed counter) vs
> hashing (stateless but collisions). Custom aliases need a uniqueness check. Add analytics via async
> events so counting clicks doesn't slow redirects.

---

## 15. Worked Example: Design a News Feed (Twitter/Instagram)

**The central question: fan-out on write vs fan-out on read.**

- **Fan-out on write (push):** when you post, immediately write the post into **every follower's**
  precomputed feed (in a cache/store).
  - **Pros:** reading the feed is instant (just read your list).
  - **Cons:** a celebrity with 100M followers triggers 100M writes per post (the **celebrity
    problem**).
- **Fan-out on read (pull):** build the feed **when the user opens the app** by pulling recent posts
  from everyone they follow and merging.
  - **Pros:** cheap writes; great for users who follow many/celebrities.
  - **Cons:** slow, heavy reads.

> **The real answer is hybrid:** push for normal users (fast feeds), **pull for celebrities**
> (merge their posts in at read time). This is what large platforms actually do.

**Other pieces:** feed stored in Redis (per-user list of post IDs), posts in a data store, media in
S3+CDN, ranking service for "top posts," and async pipelines for counts/notifications.

---

## 16. Worked Example: Design a Chat App (WhatsApp)

**Requirements:** 1:1 + group messaging, online status, delivery/read receipts, real-time, history.

**Core:**
- **Real-time transport:** **WebSockets** (persistent connection per online user). A **connection/
  presence service** tracks which server holds each user's socket.
- **Send flow:** A → gateway → message service → store message → look up B's connection → push via B's
  WebSocket. If B is offline, store and deliver on reconnect (+ push notification).
- **Storage:** huge write volume + simple access by conversation → **wide-column store (Cassandra)**
  partitioned by conversation ID, sorted by time.
- **Group chat:** fan-out the message to each member's delivery path.
- **Scale challenges:** millions of **persistent connections** (need many gateway servers + a way to
  route a message to the right server holding a recipient's socket — via a presence registry /
  pub-sub like Redis), ordering per conversation, delivery guarantees (at-least-once + dedup),
  end-to-end encryption.

> They're testing: do you know **WebSockets + a presence/routing layer + a write-optimized store**,
> and can you reason about delivering to offline users and scaling persistent connections?

---

## 17. Interview Q&A Bank

**Q: Vertical vs horizontal scaling?**
> Vertical = bigger machine (simple, has a ceiling, single point of failure). Horizontal = more
> machines (near-unlimited, fault-tolerant, needs stateless servers + load balancing). Scale out for
> real growth.

**Q: Why keep app servers stateless?**
> So any server can handle any request, enabling load balancing, auto-scaling, and easy failover.
> Push state to shared stores (Redis/DB) or stateless tokens.

**Q: Explain the CAP theorem.**
> Under a network partition you must choose Consistency or Availability — not both at that moment. CP
> systems refuse to serve possibly-stale data (banking); AP systems stay available and reconcile
> later (social feed). PACELC adds the normal-case latency-vs-consistency trade-off.

**Q: How do you scale reads vs writes?**
> Reads: caching + read replicas + CDN. Writes: sharding/partitioning, async queues to absorb spikes,
> batching, write-optimized stores. Identify your read:write ratio first.

**Q: How do you keep cache consistent with the DB?**
> Cache-aside with invalidation: on update, write the DB then delete/refresh the cache key; use TTLs
> for safety. Accept a small staleness window, or write-through for stronger consistency. State the
> trade-off and watch for stampedes (locks/jitter).

**Q: SQL or NoSQL — how do you decide?**
> By access pattern and requirements: relational/ACID/complex queries → SQL; massive horizontal scale,
> flexible schema, simple key access, high write throughput → NoSQL. Default to SQL until a real
> requirement forces NoSQL.

**Q: How do you handle a transaction across microservices?**
> Avoid distributed 2PC. Use the **Saga pattern** — local transactions with compensating actions to
> undo on failure — plus the **outbox pattern** for reliable event publishing and idempotent
> consumers.

**Q: What's a message queue for?**
> Decoupling, buffering spikes, resilience (retries/DLQ), and scaling via more workers. Move anything
> slow or failure-prone off the request path. Make consumers idempotent (at-least-once delivery).

**Q: How do you prevent one failing service from taking down everything?**
> Timeouts, retries with backoff+jitter, **circuit breakers**, bulkheads, rate limiting, graceful
> degradation, and redundancy. Contain failures; fail fast.

**Q: How do you design for a global audience?**
> CDN for static, multi-region deployments, geo-routing, edge caching, and data locality. Watch
> cross-region latency and consistency.

**Q: How would you find and fix a latency spike in production?**
> Observability: metrics + logs + distributed traces to locate the slow hop. Common culprits: DB
> queries (add index/cache), N+1 calls, cache misses/stampede, a slow downstream (circuit-break),
> GC/CPU saturation, or replication lag. Measure, then fix one thing.

**Q: How do you generate unique IDs across many servers?**
> UUIDs (random, no coordination) or Snowflake-style IDs (timestamp + machine + sequence) for sortable,
> distributed, collision-free IDs — instead of a single auto-increment bottleneck.

**Q: Fan-out on write vs read for feeds?**
> Write = precompute feeds on post (fast reads, expensive for celebrities). Read = build on request
> (cheap writes, slow reads). Use a hybrid: push for normal users, pull for celebrities.

**Q: What's idempotency and why does it matter?**
> The same operation applied twice has the same effect as once. Essential because retries and
> at-least-once delivery cause duplicates — protect with idempotency keys (e.g., no double charge).

---

## 18. Cheat Sheet

- **Always:** clarify → estimate → API → high-level → deep dive → bottlenecks. Say trade-offs out loud.
- **Match the design to the scale.** Don't over-engineer.
- **Stateless servers** + load balancer = horizontal scale.
- **Cache** is your biggest lever; **invalidation + stampedes** are the hard parts.
- **Read replicas** scale reads; **sharding** scales writes; pick a good **shard key**.
- **CAP/PACELC:** choose C vs A during partitions; consistency vs latency otherwise.
- **Queues** for anything slow/async; make consumers **idempotent**; use **DLQs**.
- **Saga + outbox** for cross-service transactions.
- **Resilience:** timeout, retry+backoff+jitter, circuit breaker, bulkhead, graceful degradation.
- **Global:** CDN + multi-region + data locality.
- **IDs:** UUID/Snowflake, not a single counter.
- **Files:** object storage + CDN, not the DB.
- **Observe everything:** metrics, logs, traces, SLOs.
- **Default to a monolith;** split to microservices when team/scale demands it.

---

*End of handbook. Remember: there's no single right answer — interviewers want to see you reason about
trade-offs at the right scale. Talk through the "why," not just the "what." 🏗️*
