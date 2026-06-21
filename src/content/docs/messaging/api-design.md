---
title: "API Design & GraphQL — Interview Handbook"
description: "API design: REST maturity, versioning, pagination, idempotency, rate limiting, HATEOAS, GraphQL N+1/DataLoader, and gRPC — with a Q&A bank."
sidebar:
  label: "API Design & GraphQL"
---

> How to design APIs senior/staff interviewers respect: REST done right (resources, status codes,
> versioning, pagination, idempotency, errors, rate limiting), when REST hurts, GraphQL (schema,
> resolvers, the N+1 problem and DataLoader, caching, security), gRPC, and choosing between them —
> with the tradeoffs stated out loud, plus a Q&A bank.

---

## 1. What Makes a Good API

An API is a **contract** and a **product** for other engineers. The qualities to name:

- **Consistent** — predictable naming, shapes, and errors across endpoints.
- **Evolvable** — you can add features without breaking existing clients.
- **Hard to misuse** — sensible defaults, clear required vs optional, safe by default.
- **Well-documented** — schema/contract first (OpenAPI, GraphQL SDL, protobuf).
- **Observable & protected** — versioned, rate-limited, paginated, idempotent where it matters.

> **Senior answer:** "I design the **contract first** (OpenAPI / SDL / proto), think about **backward
> compatibility from day one**, and treat the API as a long-lived product — because clients I don't
> control will depend on every quirk I ship."

---

## 2. REST Fundamentals

REST models the domain as **resources** (nouns) manipulated via **HTTP methods** (verbs):

| Method | Meaning | Safe? | Idempotent? |
|---|---|---|---|
| GET | Read | Yes | Yes |
| POST | Create / action | No | **No** |
| PUT | Replace (full) | No | **Yes** |
| PATCH | Partial update | No | Usually no |
| DELETE | Remove | No | **Yes** |

- **Resource URLs are nouns, plural:** `/users/123/orders`, not `/getUserOrders`.
- **Statelessness** — each request carries its own auth/context; no server session affinity → easy
  horizontal scaling.
- **Use status codes correctly:** 200 OK, 201 Created (+ `Location`), 204 No Content, 400 Bad Request,
  401 Unauthenticated, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable, 429 Too Many
  Requests, 500/503 server.

> **Trap:** returning `200 OK` with `{"error": ...}` for failures. Use the right status code — clients,
> proxies, and monitoring rely on it.

---

## 3. The Richardson Maturity Model

A useful vocabulary for "how RESTful":
- **Level 0** — one endpoint, RPC-over-HTTP (e.g. SOAP-ish).
- **Level 1** — resources (separate URLs per entity).
- **Level 2** — HTTP verbs + status codes correctly (where most good REST APIs live).
- **Level 3** — **HATEOAS**: responses include links to next actions, so clients discover the API.

> **Nice to know:** Level 3 (HATEOAS) is rarely fully adopted — most pragmatic APIs target a solid
> Level 2. Knowing the model signals depth without being dogmatic.

---

## 4. Versioning (do this from day one)

You will change the API; the question is how without breaking clients.

- **URI versioning** `/v1/users` — simplest, most visible, cache-friendly. Most common.
- **Header versioning** `Accept: application/vnd.api.v2+json` — cleaner URLs, less visible/discoverable.
- **The real goal is backward compatibility:** prefer **additive, non-breaking changes** (new optional
  fields, new endpoints). Reserve a version bump for genuinely breaking changes, and run versions in
  parallel with a deprecation window.

> **Senior answer:** "I avoid versioning when I can by making **additive** changes — new optional fields
> never break a tolerant reader. I bump a major version only for breaking changes, support old + new in
> parallel, and publish a deprecation timeline."

---

## 5. Pagination, Filtering, Sorting

Never return an unbounded list.

- **Offset/limit** (`?page=3&size=20`) — simple, supports jumping to a page; **but** slow on deep pages
  and can skip/duplicate rows when data changes underneath.
- **Cursor (keyset) pagination** (`?after=<opaque_cursor>`) — scales to huge datasets, stable under
  inserts, O(1)-ish. **Preferred for large/real-time data and infinite scroll.**

> **Trap:** offset pagination over a large, frequently-changing table → page drift and slow deep pages.
> Cursor pagination fixes both. (See the PostgreSQL handbook for the SQL side.)

---

## 6. Idempotency (the reliability cornerstone)

Networks retry. If a client doesn't get a response to a `POST /payments`, it may resend — and you must
not charge twice.

- **Idempotency keys:** client sends a unique `Idempotency-Key` header; the server stores the result for
  that key and returns the **same** response on a retry instead of re-executing.
- `PUT`/`DELETE` are naturally idempotent; `POST` is not — add a key for create/charge operations.

> **Senior answer:** "Any non-idempotent mutation that matters (payments, orders) takes an
> **idempotency key**, so an at-least-once retry can't double-apply. This is the API-layer version of
> the exactly-once-processing problem." (See Distributed Systems handbook.)

---

## 7. Errors, Rate Limiting, and Robustness

- **Consistent error shape** — adopt **RFC 7807 `application/problem+json`**: `type`, `title`, `status`,
  `detail`, `instance`. Same structure everywhere; include a correlation/trace ID.
- **Rate limiting** — protect the service; return **429** with `Retry-After` and
  `X-RateLimit-Remaining`. Algorithms: token bucket (bursty-friendly), sliding window.
- **Validation** — fail fast with 400/422 and field-level messages.
- **Timeouts, retries (with backoff+jitter), circuit breakers** on the client side.

---

## 8. When REST Hurts → GraphQL

REST pain points that motivate GraphQL:
- **Over-fetching** — endpoint returns more than the screen needs.
- **Under-fetching / N+1 round-trips** — the client calls `/users/1`, then `/users/1/posts`, then each
  post's comments (waterfall).
- **Endpoint sprawl** — every client/screen wants a slightly different shape.

**GraphQL** exposes a single endpoint and a **typed schema**; the client asks for **exactly the fields it
needs** in one request:

```graphql
query {
  user(id: "1") {
    name
    posts(last: 5) { title comments { text } }   # one round trip, exact shape
  }
}
```

---

## 9. GraphQL Core Concepts

- **Schema (SDL)** — strongly typed contract: `type`, `Query`, `Mutation`, `Subscription`, scalars,
  enums, interfaces, unions, `input` types.
- **Resolvers** — a function per field that fetches its data; they compose into the response tree.
- **Queries / Mutations / Subscriptions** — read / write / real-time (over WebSockets).
- **Introspection** — the schema is self-documenting (powers tooling like GraphiQL).

```graphql
type Query { user(id: ID!): User }
type User { id: ID!  name: String!  posts: [Post!]! }
```

---

## 10. The GraphQL N+1 Problem & DataLoader

The defining GraphQL gotcha: resolving `users { posts }` calls the `posts` resolver **once per user** →
N+1 database queries.

**Fix: DataLoader** — batches and caches per-request. Instead of N queries, it collects all the keys
requested in a tick and issues **one batched query** (`WHERE user_id IN (...)`), then distributes
results.

> **Trap:** naive GraphQL resolvers silently produce N+1 (or N×M) queries and melt the database under
> load. The senior answer is **DataLoader batching + caching**, plus query-cost limits.

---

## 11. GraphQL Tradeoffs & Security

**Strengths:** exact-shape fetching, one round trip, strong typing, schema evolution by **deprecating
fields** (often no versioning needed), great for varied frontends.

**Costs / risks:**
- **Caching is harder** — it's typically `POST` to one URL, so HTTP/CDN caching doesn't work out of the
  box (use persisted queries / client caches like Apollo).
- **Query complexity attacks** — a deeply nested query can DoS you → enforce **depth limiting, cost
  analysis, timeouts, pagination**.
- **Observability** — one endpoint hides per-field metrics; need field-level tracing.
- **Over-flexibility** — clients can ask expensive combinations you didn't anticipate.

> **Senior answer:** "GraphQL shines when many clients need many different shapes of a connected graph.
> Its costs are caching, query-cost control, and N+1 — solved with persisted queries/CDN, depth+cost
> limits, and DataLoader. For simple, cache-heavy, public APIs, REST is often the better default."

---

## 12. gRPC (the third option)

**gRPC** = contract-first RPC over **HTTP/2** with **Protobuf** binary payloads. Strongly typed,
compact, fast, supports **streaming** (client/server/bidirectional).

- **Use for:** internal **service-to-service** calls, low latency, polyglot microservices, streaming.
- **Less ideal for:** public browser APIs (needs gRPC-Web/proxy; not human-readable).

(See the gRPC & Protobuf handbook for depth.)

---

## 13. Choosing: REST vs GraphQL vs gRPC

| | REST | GraphQL | gRPC |
|---|---|---|---|
| Best for | Public, cache-heavy, CRUD | Varied clients, connected graph | Internal microservices |
| Payload | JSON | JSON | Binary (Protobuf) |
| Fetching | Fixed per endpoint | Client-specified | Fixed per method |
| Caching | **Easy (HTTP/CDN)** | Hard | N/A (internal) |
| Typing | Optional (OpenAPI) | **Strong (SDL)** | **Strong (proto)** |
| Streaming | SSE/WebSocket | Subscriptions | **First-class** |

> **Senior framing:** "REST for public/cacheable CRUD, GraphQL when diverse frontends need flexible
> graph queries, gRPC for fast internal service-to-service. They're not mutually exclusive — many
> systems use gRPC internally and expose REST or GraphQL at the edge."

---

## 14. Interview Q&A Bank

**Q: What makes an API RESTful?**
> Resources as nouns, correct HTTP verbs and status codes, statelessness, and (ideally) hypermedia.
> Practically, most good APIs sit at Richardson Level 2 (verbs + status codes).

**Q: Which HTTP methods are idempotent?**
> GET, PUT, DELETE (and HEAD/OPTIONS). POST and usually PATCH are not. Idempotent means repeating the
> request has the same effect as doing it once.

**Q: How do you version an API without breaking clients?**
> Prefer additive, backward-compatible changes (new optional fields/endpoints). Bump a major version
> (URI or header) only for breaking changes, run versions in parallel, and deprecate on a timeline.

**Q: Offset vs cursor pagination?**
> Offset is simple and supports page jumps but is slow on deep pages and drifts when data changes. Cursor
> (keyset) pagination is stable and scales — preferred for large/real-time lists and infinite scroll.

**Q: How do you make a POST idempotent?**
> Client sends an Idempotency-Key; the server stores the result per key and returns the same response on
> retry instead of re-executing — preventing double charges under at-least-once retries.

**Q: How should APIs return errors?**
> Correct status codes plus a consistent body (RFC 7807 problem+json) with a trace/correlation ID. Never
> 200-with-error-body.

**Q: What problems does GraphQL solve over REST?**
> Over-fetching, under-fetching/round-trip waterfalls, and endpoint sprawl — clients request exactly the
> fields they need from a typed graph in one request.

**Q: What is the N+1 problem in GraphQL and how do you fix it?**
> Nested resolvers fire one query per parent (N+1). Fix with DataLoader: batch keys per request into one
> `IN (...)` query and cache results; also add query depth/cost limits.

**Q: Why is caching harder in GraphQL?**
> Queries are POSTs to a single endpoint, so HTTP/CDN caching doesn't apply by default. Use persisted
> queries, GET for cacheable queries, and client-side normalized caches.

**Q: How do you secure a GraphQL API?**
> Depth limiting, query cost analysis, timeouts, pagination, disabling introspection in prod, auth at the
> resolver/field level, and rate limiting — because clients can craft expensive nested queries.

**Q: REST vs GraphQL vs gRPC — quick call?**
> REST for public/cacheable CRUD; GraphQL for diverse clients needing flexible graph queries; gRPC for
> fast, typed internal service-to-service (HTTP/2 + Protobuf, streaming). Mix as appropriate.

---

## 15. Cheat Sheet

- **Contract-first** (OpenAPI/SDL/proto), **design for backward compatibility**, treat the API as a
  product.
- **REST:** resources as nouns, correct **verbs + status codes**, stateless. Aim for Richardson **Level
  2**; HATEOAS is Level 3.
- **Idempotency:** GET/PUT/DELETE yes, POST no → add **Idempotency-Key** for payments/creates.
- **Versioning:** additive changes first; bump (URI/header) only for breaking changes; parallel + deprecate.
- **Pagination:** **cursor/keyset** for large/real-time; offset for simple page-jumps.
- **Errors:** RFC 7807 problem+json + trace ID; correct codes. **Rate limit** → 429 + Retry-After (token
  bucket / sliding window).
- **GraphQL:** typed schema + resolvers; solves over/under-fetching; **N+1 → DataLoader** (batch+cache);
  evolve by deprecating fields; caching is hard (persisted queries); guard with **depth/cost limits**.
- **gRPC:** HTTP/2 + Protobuf, fast/typed/streaming → **internal** service-to-service.
- **Choose:** REST (public/cacheable), GraphQL (flexible clients/graph), gRPC (internal microservices) —
  often combined.

---

*End of handbook. The signal: design the **contract first**, plan **backward compatibility** before you
ship, and choose REST/GraphQL/gRPC by the **client and caching needs** — then name the costs (N+1,
caching, query-cost) and how you mitigate them.*
