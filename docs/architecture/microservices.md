# Microservices Patterns — Advanced Interview Handbook

> A deep, easy-to-understand guide to microservices for senior interviews: when (and when NOT) to use
> them, decomposition, the data problem, communication patterns, distributed transactions (Saga,
> Outbox), resilience, observability, deployment, the service mesh, and the tricky distributed-systems
> failure modes that separate seniors from juniors — plus a deep Q&A bank.
>

---

## 1. What & Why (and the honest downsides)

**Microservices** = an application built as a suite of **small, independently deployable services**,
each owning a **business capability** and its **own data**, communicating over the network.

**Benefits:** independent deployment & scaling, team autonomy, fault isolation, tech flexibility.

**Costs (say these — it signals maturity):** you trade code complexity for **distributed-systems
complexity** — network failures, eventual consistency, distributed debugging, data duplication,
operational overhead, and testing pain.

> **Senior framing:** "Microservices are an **organizational and scaling** solution, not a technical
> upgrade. They trade in-process simplicity for network complexity. The biggest mistake is adopting them
> for a problem you don't have — most teams should **start with a modular monolith** and extract
> services when team size, scaling, or deploy-independence actually demands it."

---

## 2. Monolith vs Microservices vs Modular Monolith

| | Monolith | Modular Monolith | Microservices |
|---|---|---|---|
| Deploy | One unit | One unit | Many independent |
| Boundaries | Often messy | **Clear modules** | Network-enforced |
| Data | One DB | One DB (logical modules) | DB per service |
| Complexity | Low | Low-medium | **High (distributed)** |
| Scaling | Whole app | Whole app | Per service |
| Best when | Small app/team | Most apps! | Large org, real scale needs |

> **"Would you start a new project with microservices?"** Usually **no** — start with a **modular
> monolith** (clean module boundaries, one deploy). It's faster to build, easier to refactor boundaries
> (which you'll get wrong at first), and you can extract services later. Premature microservices = a
> **distributed monolith**: all the pain, none of the benefits.

---

## 3. Decomposition: How to Split Services

The hardest part: **where are the boundaries?**

- **By business capability** — Orders, Payments, Inventory, Shipping (not by technical layer).
- **Domain-Driven Design (DDD)** — model **bounded contexts**; each maps to a service. Aggregates define
  consistency boundaries.
- **Single Responsibility / high cohesion, low coupling** — a service changes for one business reason.

> **Wrong ways to split:** by technical tier (a "database service", a "UI service"), or too fine
> ("nano-services") → chatty, coupled, hard to change. If two services always change together, they
> should probably be one.

> "I decompose along **bounded contexts** from DDD — business capabilities with high internal cohesion
> and clear, stable contracts. The test: a service should be **independently deployable and own its
> data**. If a change ripples across many services, the boundary is wrong."

---

## 4. The Data Problem: Database-per-Service

**The defining rule:** each service **owns its own database**; others can **never** touch it directly —
only via the service's API/events.

```
Order Service → Order DB        Payment Service → Payment DB
   (no service reaches into another's database — ever)
```

**Why:** loose coupling and independent schema evolution. If services shared a DB, a schema change
breaks everyone and you're back to a monolith.

**The cost:** you lose easy **joins** and **ACID transactions** across services. You now face:
- **No cross-service joins** → data duplication / API composition / read models.
- **No distributed ACID** → eventual consistency + Sagas (§8).
- **Reporting** spanning services → a separate read store / data warehouse (via events/CDC).

> **"How do you query data across services?"** Options: **API composition** (gateway/BFF calls each
> service and joins in memory — simple, but N calls & partial-failure handling), or **CQRS read models**
> (services publish events; a denormalized view is built for queries). Never reach into another
> service's DB.

> "Database-per-service is the rule that makes microservices *micro*. The price is giving up
> cross-service joins and ACID — which is why Sagas, the outbox pattern, and eventual consistency exist."

---

## 5. Communication: Sync vs Async

| | **Synchronous** (REST/gRPC) | **Asynchronous** (events/messages) |
|---|---|---|
| Style | Request/response, caller waits | Fire-and-forget via broker |
| Coupling | **Temporal** (both must be up) | Loose (broker buffers) |
| Failure | Cascades if callee down | Resilient, retried |
| Consistency | Immediate | Eventual |
| Best for | Queries needing an answer now | Events, decoupling, spikes |

- **Sync:** REST (simple, ubiquitous) or **gRPC** (fast, typed, internal). **Synchronous chains
  cascade failures** and add latency (A→B→C→D). Minimize call depth.
- **Async:** an event broker (**Kafka/RabbitMQ**). Services publish **events** ("OrderPlaced") and react.
  Decouples teams and absorbs load.

> **"Sync or async between services?"** Prefer **async events** for inter-service workflows to avoid
> tight coupling and cascading failures; use **sync** only when the caller genuinely needs an immediate
> answer (and protect it with timeouts/circuit breakers). Deep synchronous chains are an anti-pattern.

> **Orchestration vs Choreography:**
> - **Orchestration** — a central coordinator tells services what to do (explicit, easier to reason
>   about/monitor, but a coupling point).
> - **Choreography** — services react to events independently (loose, scalable, but emergent behavior is
>   harder to trace). Most systems mix both.

---

## 6. API Gateway & BFF

**API Gateway** — a single entry point in front of all services. Handles **auth, rate limiting, routing,
TLS, request aggregation, caching** — so clients don't call dozens of services directly and services
stay simple.

**BFF (Backend-for-Frontend)** — a gateway **per client type** (web, mobile, partner) tailored to that
client's needs (different data shapes, aggregation), avoiding a one-size-fits-all gateway.

> **Gateway traps:** it can become a **single point of failure** (run it HA) and a **god object** if
> you put business logic in it. Keep it to cross-cutting concerns and routing.

---

## 7. Service Discovery & Load Balancing

Services have dynamic IPs (containers come and go) — they need to **find** each other.

- **Service registry** — services register; clients look up (Consul, etcd, Eureka, **Kubernetes DNS**).
- **Client-side discovery** — client queries the registry and load-balances itself.
- **Server-side discovery** — a load balancer/gateway routes (e.g., k8s Service).
- **Health checks** remove dead instances from rotation.

> "On Kubernetes I get service discovery and load balancing for free via **Services + DNS + kube-
> proxy** (or a service mesh for smarter, per-request L7 balancing)."

---

## 8. Distributed Transactions: Saga Pattern

**The problem:** a business operation spans services (Order → Payment → Inventory → Shipping). You can't
use a single ACID transaction or 2-phase commit (slow, tightly-coupling, blocking).

**Saga** = a sequence of **local transactions**, each in one service, where each step publishes an
event/command triggering the next. If a step fails, you run **compensating transactions** to undo the
prior steps.

```
OrderCreated → ReservePayment → ReserveInventory → ScheduleShipping
   if Inventory fails → RefundPayment (compensate) → CancelOrder (compensate)
```

**Two coordination styles:**
- **Choreography saga** — services react to each other's events (no central brain). Loose but hard to
  trace as it grows.
- **Orchestration saga** — a **saga orchestrator** drives the steps and compensations explicitly.
  Clearer for complex flows; easier to monitor.

> **"How do microservices do transactions?"** Not 2PC — use the **Saga pattern**: local transactions
> + compensating actions, coordinated by choreography (events) or an orchestrator. Accept **eventual
> consistency** and design **compensations** (e.g., refund, cancel). No isolation — design for
> intermediate states (an order can be "pending").

> "Sagas trade atomicity for availability. The hard parts are **idempotent steps**, **compensating
> logic**, and handling **semantic locks** (a 'pending' state) since there's no isolation."

---

## 9. The Outbox Pattern & Dual-Write Problem

**Dual-write problem:** a service must **update its DB *and* publish an event**. If it does them as
two separate steps, a crash between them leaves them **inconsistent** (DB updated but event lost, or
vice-versa). You **cannot** atomically write to a DB and a broker.

**Transactional Outbox pattern** — write the business change **and** an event row to an **outbox
table** in the **same local DB transaction** (atomic). A separate **relay/poller** (or **CDC** via
Debezium) reads the outbox and publishes to the broker, marking rows sent.

```
BEGIN
  INSERT order ...
  INSERT outbox (event='OrderPlaced', payload=...)   -- same transaction → atomic
COMMIT
→ relay/CDC publishes outbox rows to Kafka, then marks them published
```

**Inbox pattern** — the consumer records processed message IDs to **dedupe** (idempotent consumption).

> **"How do you reliably publish an event when you update the DB?"** The **outbox pattern**: persist
> the event in the same transaction as the data, then relay it to the broker (polling or CDC). This is
> *the* answer to the dual-write problem. At-least-once delivery means consumers must be **idempotent**.

---

## 10. CQRS & Event Sourcing

- **CQRS (Command Query Responsibility Segregation)** — separate the **write model** (commands) from
  optimized **read models** (queries). Useful when reads and writes have very different shapes/scale, or
  to build cross-service query views from events. Adds complexity + eventual consistency between
  write and read sides — don't use it everywhere.
- **Event Sourcing** — store state as an **immutable sequence of events** (the log is the source of
  truth); rebuild current state by replaying. Gives a perfect audit trail and temporal queries.
  Complex: schema/event versioning, replay cost (use **snapshots**), and "no easy UPDATE/DELETE."

> "CQRS and event sourcing often pair: events are the write side, projections build read models. They
> shine for auditability and complex domains — but they're advanced tools, not defaults. Most services
> just need CRUD."

---

## 11. Resilience Patterns

Networks fail constantly; design for **partial failure**.

| Pattern | Problem it solves |
|---|---|
| **Timeout** | Don't wait forever on a slow dependency |
| **Retry (backoff + jitter)** | Recover from transient blips without stampeding |
| **Circuit Breaker** | Stop calling a failing service; fail fast; recover gradually |
| **Bulkhead** | Isolate resource pools so one overloaded dependency can't sink everything |
| **Rate limiting / throttling** | Protect from overload/abuse |
| **Fallback / Graceful degradation** | Serve a reduced response instead of failing |
| **Load shedding** | Drop low-priority work under extreme load |

**Circuit breaker states:** **Closed** (normal) → **Open** (failing, reject fast) → **Half-Open** (test
a few requests) → back to Closed/Open.

> **"What happens when a downstream service is down?"** Timeouts so you don't hang, a **circuit
> breaker** to fail fast and stop hammering it, **retries with backoff + jitter** for transients, a
> **fallback** for graceful degradation, and **bulkheads** so the failure doesn't exhaust threads and
> cascade. Naive retries cause **retry storms** — always backoff + jitter + breaker.

---

## 12. Observability (the 3 pillars)

In a distributed system, "why is it slow/broken?" is hard — you can't attach a debugger across 20
services.

- **Metrics** (Prometheus + Grafana) — rates, errors, durations (RED/USE), SLOs, alerting.
- **Logs** (ELK/Loki, structured + **correlation IDs**) — searchable, tied to a request.
- **Distributed tracing** (OpenTelemetry → Jaeger/Tempo/Zipkin) — follow **one request across all
  services** via a propagated **trace ID**; find the slow hop.

> "The key is a **correlation/trace ID** propagated through every hop (and into logs), so I can
> reconstruct a single request's path across services. Without distributed tracing, debugging
> microservices is guesswork."

---

## 13. Service Mesh & Sidecars

A **service mesh** (Istio, Linkerd) handles **service-to-service networking** via **sidecar proxies**
(Envoy) injected next to each service — **without changing app code**:
- **mTLS** (encrypt + authenticate service-to-service), traffic management (canary/splitting), retries/
  timeouts/circuit breaking, and observability (metrics/traces) at the infra layer.

> **"Why a service mesh?"** It moves cross-cutting concerns (mTLS, retries, traffic shaping,
> telemetry) out of every service and into the platform, consistently across languages. Cost: extra
> latency, complexity, and resource overhead — don't add it until the number of services justifies it.

---

## 14. Deployment & Release Patterns

- **Containers + orchestration** (Docker + Kubernetes) — the standard substrate.
- **CI/CD per service** — independent pipelines = independent deploys.
- **Release strategies:** **Rolling** (gradual), **Blue/Green** (two envs, instant switch/rollback),
  **Canary** (route a small % to the new version, watch metrics, ramp up), **Feature flags** (decouple
  deploy from release).
- **Backward/forward-compatible contracts** — deploy services independently means you **can't** break
  the API others depend on; evolve additively (versioning, tolerant readers, consumer-driven contract
  tests).

> **Versioning trap:** independently deployed services run **mixed versions simultaneously** — every
> change must be backward-compatible during rollout. Use expand-then-contract (parallel change) for
> breaking schema/API changes.

---

## 15. Data Consistency & Idempotency

- **Eventual consistency** is the norm — design UIs/flows for it (pending states, "processing").
- **Idempotency** — at-least-once delivery + retries mean operations run more than once. Make handlers
  idempotent (idempotency keys, dedupe/inbox table, upserts) so duplicates are safe (no double charge).
- **Distributed locks / leader election** (e.g., Redis, ZooKeeper) for "run once" tasks — but avoid if
  you can.
- **Data duplication is OK** — services keep local copies of data they need (updated via events), trading
  storage for autonomy.

> **"How do you avoid double-processing?"** Idempotent consumers: a dedup/inbox table keyed by message
> ID, or naturally idempotent operations/upserts. Combine with the outbox pattern for reliable
> exactly-once *effect* even with at-least-once delivery.

---

## 16. Anti-Patterns & Advanced Gotchas

1. **Distributed monolith** — services so coupled they must deploy together. The worst outcome; usually
   from wrong boundaries or shared DBs.
2. **Shared database** across services — breaks independence; forbidden.
3. **Chatty / synchronous chains** (A→B→C→D) — latency multiplies, failures cascade. Prefer async/
   aggregation.
4. **Nano-services** — too fine-grained → overhead and coupling.
5. **No idempotency** — duplicates cause double charges/effects.
6. **Dual-write** without outbox — DB and broker drift.
7. **Ignoring partial failure** — no timeouts/circuit breakers → cascading outages.
8. **Distributed transactions via 2PC** — slow, blocking; use Sagas.
9. **No correlation IDs / tracing** — undebuggable in production.
10. **Breaking API changes** during independent deploys — must be backward-compatible.
11. **Premature microservices** — adopting them before you have the scale/team to justify the cost.
12. **Synchronous orchestration everywhere** — a central service calling all others synchronously
    recreates a monolith with network latency.

> "The senior signals: **start modular-monolith-first**, **database-per-service**, **async events +
> Saga + Outbox** for the data problem, **resilience patterns** for partial failure, **idempotency**
> everywhere, and **distributed tracing** to stay debuggable. The cardinal sin is the **distributed
> monolith**."

---

## 17. Interview Q&A Bank

**Q: What are microservices and their main trade-off?**
> Small, independently deployable services owning a business capability and their data. They trade
> in-process simplicity for distributed-systems complexity (network, eventual consistency, ops).

**Q: Would you start a new app with microservices?**
> Usually no — start with a modular monolith, get boundaries right, and extract services when team/scale
> demands it. Premature microservices create a distributed monolith.

**Q: How do you decide service boundaries?**
> By business capability / DDD bounded contexts — high cohesion, low coupling, independently deployable,
> owning its data. If services always change together, merge them.

**Q: Why database-per-service?**
> Loose coupling and independent schema evolution. Sharing a DB recreates a monolith. The cost is losing
> cross-service joins and ACID, handled via API composition/CQRS and Sagas.

**Q: How do you query across services?**
> API composition (call each and join) or CQRS read models built from events. Never read another
> service's database.

**Q: Sync vs async communication?**
> Async events for decoupling and resilience (Kafka/RabbitMQ); sync (REST/gRPC) only when an immediate
> answer is needed, protected by timeouts/circuit breakers. Deep sync chains cascade failures.

**Q: How do you handle transactions across services?**
> The Saga pattern: local transactions + compensating actions, via choreography (events) or an
> orchestrator. Accept eventual consistency; no cross-service ACID/2PC.

**Q: What's the dual-write problem and the outbox pattern?**
> You can't atomically write to a DB and publish to a broker. The outbox writes the event in the same DB
> transaction as the data; a relay/CDC publishes it reliably. Consumers dedupe (inbox/idempotency).

**Q: Orchestration vs choreography?**
> Orchestration uses a central coordinator (explicit, monitorable, coupling point); choreography uses
> events (loose, scalable, harder to trace). Mix per use case.

**Q: How do you make services resilient?**
> Timeouts, retries with backoff+jitter, circuit breakers, bulkheads, rate limiting, and fallbacks. Avoid
> retry storms; fail fast and degrade gracefully.

**Q: How do you debug a slow request across services?**
> Distributed tracing with a propagated trace/correlation ID (OpenTelemetry/Jaeger) plus metrics and
> structured logs to find the slow hop.

**Q: What's CQRS / event sourcing and when?**
> CQRS separates read/write models; event sourcing stores state as an event log (replayable, auditable).
> Powerful for complex/auditable domains, but advanced — not defaults.

**Q: What is a service mesh and its cost?**
> Sidecar proxies (Istio/Linkerd/Envoy) providing mTLS, traffic management, retries, and telemetry
> without app changes — at the cost of latency, complexity, and resources.

**Q: How do you deploy breaking API changes?**
> You don't break — services run mixed versions during rollout. Use additive/backward-compatible changes
> and expand-then-contract (parallel change), with consumer-driven contract tests.

**Q: What is a distributed monolith?**
> Services so tightly coupled (shared DB, sync chains, lock-step deploys) that you get microservice pain
> without the benefits. The main anti-pattern.

---

## 18. Cheat Sheet

- **Microservices = independently deployable, business-capability services owning their data.** Trade:
  distributed complexity. **Start modular-monolith-first.**
- **Decompose by DDD bounded contexts**, not technical tiers; high cohesion, low coupling.
- **Database-per-service** (never share a DB) → no cross-service joins/ACID → use **API composition /
  CQRS**.
- **Prefer async events** (Kafka/RabbitMQ); sync (REST/gRPC) only when needed; avoid deep sync chains.
- **API Gateway / BFF** for a single entry point (HA it; keep logic out).
- **Saga** for distributed transactions (local txns + compensations; orchestration vs choreography).
- **Outbox pattern** solves the **dual-write problem**; **inbox/idempotency** for at-least-once dupes.
- **CQRS / event sourcing** = advanced read/write separation + event log (not defaults).
- **Resilience:** timeout, retry+backoff+jitter, **circuit breaker**, bulkhead, fallback.
- **Observability:** metrics + logs + **distributed tracing** with correlation IDs.
- **Service mesh** (Istio/Linkerd) for mTLS/traffic/telemetry via sidecars — only when justified.
- **Deploy:** per-service CI/CD, canary/blue-green, **backward-compatible contracts** (mixed versions).
- **Avoid:** distributed monolith, shared DB, chatty sync chains, no idempotency, 2PC, premature
  microservices.

---

*End of handbook. The senior signal: microservices are a **distributed-systems** discipline — own your
data, communicate async, use **Saga + Outbox** for consistency, design for **partial failure**, and stay
**observable**. The cardinal sin is the distributed monolith. 🧩*
