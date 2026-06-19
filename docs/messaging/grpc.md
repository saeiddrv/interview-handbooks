# gRPC & Protocol Buffers — Interview Handbook

> A complete, easy-to-understand guide to gRPC (the high-performance RPC framework) and Protocol
> Buffers (its binary serialization): how they work, the four call types, HTTP/2 under the hood, schema
> evolution, streaming, error handling, deadlines, interceptors — when to use gRPC vs REST/GraphQL — and
> a deep Q&A bank.
>

---

## 1. What Is RPC & Where gRPC Fits

**RPC (Remote Procedure Call)** lets you call a function on a **remote** server as if it were local —
`user = userService.GetUser(id)` — hiding the network. You think in **methods and objects**, not URLs
and verbs.

**gRPC** is Google's modern, open-source RPC framework. It uses:
- **Protocol Buffers** for the message format (compact binary) and the service contract.
- **HTTP/2** as the transport (multiplexing, streaming, header compression).
- **Code generation** in many languages from one `.proto` file.

> **Senior framing:** "gRPC is a contract-first, binary RPC framework over HTTP/2. You define
> services and messages in a `.proto`, generate type-safe client/server stubs in any language, and get
> streaming, multiplexing, and small fast payloads — ideal for internal service-to-service
> communication."

**Why teams pick gRPC:** high performance, strong typing/contracts, polyglot codegen, built-in
streaming, and great for **microservices** talking to each other.

---

## 2. Protocol Buffers (Protobuf) — the Data Format

**Protocol Buffers** are a language-neutral, platform-neutral way to **serialize structured data** —
like JSON or XML, but **binary, smaller, and faster**, with a **strict schema**.

| | JSON | **Protobuf** |
|---|---|---|
| Format | Text (human-readable) | **Binary** (compact) |
| Size | Larger | **3–10× smaller** |
| Speed | Slower parse | **Faster** serialize/parse |
| Schema | None (or external) | **Required** (`.proto`) — strong typing |
| Readability | Easy | Not human-readable |

> **"Why is Protobuf smaller/faster than JSON?"** It's binary and schema-driven: field **names
> aren't sent** — only small **field numbers** + values with compact varint encoding. JSON repeats
> field names as text in every message and must be parsed as strings.

> "Protobuf trades human-readability for size and speed, and the schema gives you compile-time type
> safety and safe evolution — the opposite trade-off from JSON."

---

## 3. Writing a .proto File & Code Generation

The `.proto` file is the **single source of truth** — the contract both sides generate code from.

```protobuf
syntax = "proto3";
package user.v1;

// A message = a structured record
message User {
  int64  id    = 1;     // field number 1
  string name  = 2;
  string email = 3;
  repeated string roles = 4;   // repeated = a list/array
  Address address = 5;          // nested message
}

message Address { string city = 1; string country = 2; }

message GetUserRequest  { int64 id = 1; }
message GetUserResponse { User user = 1; }

// A service = a set of RPC methods
service UserService {
  rpc GetUser   (GetUserRequest)  returns (GetUserResponse);
  rpc ListUsers (ListUsersRequest) returns (stream User);   // server streaming
}
```

**Code generation:** `protoc` (the compiler) + a language plugin generates **message classes** and
**client/server stubs**:
```bash
protoc --go_out=. --go-grpc_out=. user.proto       # Go
protoc --java_out=. --grpc-java_out=. user.proto   # Java
```
You implement the server methods and call the client stub like a local object.

**proto3 scalar types:** `int32/int64`, `uint32/64`, `sint*` (zig-zag for negatives), `fixed*`,
`float/double`, `bool`, `string`, `bytes`, plus `enum`, `repeated` (lists), `map<k,v>`, `oneof`
(union), and `google.protobuf.Timestamp`/`Any`/`Empty` well-known types.

> **proto3 default-value trap:** scalars have **default values** (0, "", false) and proto3 doesn't
> distinguish "unset" from "default" for plain scalars. To represent **optional/nullable**, use the
> `optional` keyword (adds presence) or wrapper types (`google.protobuf.Int32Value`).

---

## 4. Field Numbers & Schema Evolution

**Field numbers are sacred.** In the binary format, a field is identified by its **number, not its
name**. This is what enables **backward/forward compatibility**.

**Rules for evolving a schema safely:**
- **Add new fields** with **new numbers** — old clients ignore unknown fields (forward compatible);
  new clients see defaults for missing fields (backward compatible).
- **Rename a field** — fine! The name isn't transmitted; only the number matters.
- **NEVER reuse or change a field's number** — old data would be misinterpreted.
- **NEVER change a field's type** incompatibly.
- **Removing a field:** stop using it and **`reserve`** its number/name so it's never reused:
  ```protobuf
  reserved 3, 5;
  reserved "old_email";
  ```

> **"How does Protobuf handle versioning / backward compatibility?"** Via stable field numbers: add
> fields with new numbers, never reuse old ones, reserve removed numbers, and unknown fields are
> ignored. Old and new clients interoperate without breaking — no API versioning needed for additive
> changes.

> "The golden rule: **field numbers are forever.** Add, don't mutate; reserve what you remove. That's
> how you roll out schema changes across services without coordinated deploys."

---

## 5. gRPC Architecture & HTTP/2

gRPC runs over **HTTP/2**, which is the key to its performance.

```
Client stub ──(protobuf over HTTP/2)──▶ gRPC Server
   |                                        |
generated from .proto                  implements service methods
```

**What HTTP/2 gives gRPC (vs HTTP/1.1):**
- **Multiplexing** — many concurrent requests over **one TCP connection** (no head-of-line blocking
  at the HTTP layer, no connection-per-request).
- **Binary framing** — efficient, not text.
- **Header compression (HPACK)** — less overhead.
- **Bidirectional streaming** — server and client can both stream over the same connection.
- **Server push** (rarely used in gRPC).

> **"Why does gRPC need HTTP/2?"** Multiplexing (many calls on one connection), streaming (all four
> call types), and binary framing/header compression — none of which HTTP/1.1 supports well. This is
> why classic browsers can't speak gRPC directly (see §14).

---

## 6. The Four Types of gRPC Calls

A guaranteed interview question — know all four:

| Type | Client → Server | Server → Client | Example |
|---|---|---|---|
| **Unary** | one request | one response | `GetUser(id)` — normal call |
| **Server streaming** | one request | **stream** of responses | Download a list/feed, live updates |
| **Client streaming** | **stream** of requests | one response | Upload chunks, batch ingest |
| **Bidirectional streaming** | **stream** | **stream** | Chat, real-time, multiplayer |

```protobuf
service Chat {
  rpc Send       (Msg)        returns (Ack);                 // unary
  rpc Subscribe  (Topic)      returns (stream Msg);          // server streaming
  rpc Upload     (stream Chunk) returns (UploadResult);      // client streaming
  rpc Converse   (stream Msg) returns (stream Msg);          // bidirectional
}
```

> "gRPC's **bidirectional streaming** over a single HTTP/2 connection is its standout feature —
> perfect for chat, telemetry, or any long-lived two-way channel, with backpressure built in via
> HTTP/2 flow control."

---

## 7. gRPC vs REST vs GraphQL

| | **gRPC** | **REST** | **GraphQL** |
|---|---|---|---|
| Transport | HTTP/2 | HTTP/1.1+ | HTTP |
| Payload | Protobuf (binary) | JSON (text) | JSON |
| Contract | `.proto` (strict) | OpenAPI (optional) | Schema (SDL) |
| Style | RPC (call methods) | Resources (CRUD) | Query graph |
| Streaming | **Native (4 types)** | Limited (SSE/WS) | Subscriptions |
| Browser-native | **No** (needs proxy) | Yes | Yes |
| Best for | **Internal microservices**, low latency, polyglot | Public APIs, simple CRUD, caching | Flexible client-driven data fetching |

> **"When gRPC vs REST?"** gRPC for **internal service-to-service** communication where you control
> both ends and want performance, strong contracts, and streaming. REST for **public APIs**, broad
> compatibility, human-readability, browser/CDN caching. Many systems use REST/GraphQL at the edge and
> gRPC internally.

> **REST caching advantage:** HTTP caching (CDNs, `GET` caching) works great with REST. gRPC is POST-
> like over HTTP/2 and isn't cacheable by standard HTTP infrastructure.

---

## 8. Error Handling & Status Codes

gRPC doesn't use HTTP status codes — it has its own **status codes**. Every call returns an
`OK` or an error status + message (+ optional details).

Common codes:
| Code | Meaning |
|---|---|
| `OK` | Success |
| `INVALID_ARGUMENT` | Bad client input |
| `NOT_FOUND` | Resource missing |
| `ALREADY_EXISTS` | Duplicate |
| `PERMISSION_DENIED` | Authn OK but not authorized |
| `UNAUTHENTICATED` | Missing/invalid credentials |
| `DEADLINE_EXCEEDED` | Timed out |
| `RESOURCE_EXHAUSTED` | Rate limited / quota |
| `UNAVAILABLE` | Server down / transient — **retryable** |
| `INTERNAL` | Server bug |
| `CANCELLED` | Caller cancelled |

> "gRPC has a rich, language-neutral status model. I map `UNAVAILABLE`/`DEADLINE_EXCEEDED` to
> **retries with backoff**, and use `google.rpc.Status` **error details** to attach structured info
> instead of stuffing strings."

---

## 9. Deadlines, Timeouts & Cancellation

**Deadlines** are a first-class, must-know gRPC feature. The **client** sets a deadline ("I'll wait at
most 2s"); it **propagates** across service hops. When it passes, the call fails with
`DEADLINE_EXCEEDED` and work can be cancelled.

```go
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
resp, err := client.GetUser(ctx, req)   // fails with DEADLINE_EXCEEDED if too slow
```

- **Deadline vs timeout:** a **deadline** is an absolute point in time that propagates through the call
  chain; a timeout is a duration. gRPC propagates the *remaining* deadline downstream so the whole
  chain respects it.
- **Cancellation** flows automatically — if the client cancels or disconnects, servers see it and stop
  working (saves resources).

> **"Why always set a deadline?"** Without one, a hung downstream can make calls wait forever,
> exhausting threads/connections and cascading failures. Deadlines bound latency and free resources.
> Propagation means you don't keep working on a request the client already gave up on.

> **Trap:** no deadline = effectively infinite wait. Always set one, and propagate `ctx` everywhere.

---

## 10. Metadata, Interceptors & Auth

- **Metadata** — key/value headers sent with a call (like HTTP headers): auth tokens, request IDs,
  tracing context. Sent as leading (before) or trailing (after) metadata.
- **Interceptors** — gRPC's middleware: wrap unary/streaming calls on client or server for
  **auth, logging, metrics, retries, tracing** — without touching business logic. (Like Express
  middleware / servlet filters.)
- **Auth:** TLS for transport security; per-call credentials (tokens) via metadata; or **mTLS** for
  mutual auth between services (common in service meshes).

```python
def auth_interceptor(request, context):
    token = dict(context.invocation_metadata()).get("authorization")
    if not valid(token): context.abort(grpc.StatusCode.UNAUTHENTICATED, "bad token")
```

> "Cross-cutting concerns — auth, tracing, metrics, retries — live in **interceptors**, and identity
> rides in **metadata**. With mTLS + interceptors you get secure, observable service-to-service calls
> without polluting handlers."

---

## 11. Channels, Load Balancing & Service Discovery

- **Channel** — a long-lived client-side connection (manages HTTP/2 connections to a server/endpoint).
  Reuse channels (creating them is expensive); they're thread-safe.
- **Load balancing:** because gRPC keeps **one long-lived connection** (multiplexed), a normal L4
  load balancer pins a client to one backend → uneven load. Solutions:
  - **Client-side LB** (gRPC picks among resolved addresses, e.g., round-robin).
  - **L7 / gRPC-aware proxy** (Envoy, Linkerd) that balances **per-request**, not per-connection.
  - **Headless service + DNS** in Kubernetes for endpoint discovery.

> **"Why is load balancing gRPC tricky?"** Long-lived multiplexed connections mean L4 LBs don't
> spread requests evenly. Use client-side LB or an L7 proxy (Envoy/service mesh) that understands HTTP/2
> and balances per request.

---

## 12. Protobuf Serialization Internals

How the bytes are laid out (deeper, but impressive to know):
- Each field is encoded as a **tag** (`field_number << 3 | wire_type`) + the value.
- **Varint encoding** — small integers take fewer bytes (1 byte for values < 128). That's why low
  field numbers (1–15) are 1-byte tags — **assign 1–15 to your most frequent fields**.
- **Wire types:** varint (ints/bools/enums), 64-bit, length-delimited (strings/bytes/messages),
  32-bit.
- **`sint32/64`** use **zig-zag** encoding so negative numbers stay small (plain `int32` encodes
  negatives as 10 bytes).
- **Unknown fields** are preserved/ignored, enabling forward compatibility.

> "Assign field numbers **1–15 to hot fields** — they're 1-byte tags. Use `sint*` for signed values
> that can be negative, and varints keep small numbers tiny."

---

## 13. Performance, Streaming & Backpressure

- **Throughput:** binary + HTTP/2 multiplexing + small payloads → much higher than JSON/REST for
  chatty internal traffic.
- **Streaming** avoids loading huge datasets into memory — process as it flows.
- **Backpressure** — HTTP/2 **flow control** naturally slows a fast sender when the receiver can't
  keep up (per-stream windows). Streaming gRPC gets this for free.
- **Keepalive/pings** keep idle HTTP/2 connections healthy (tune for load balancers/idle timeouts).
- **Message size limits** — default ~4MB receive limit; raise deliberately for large payloads (or
  stream).

> **Trap:** very large unary messages are an anti-pattern — use **streaming** to chunk big data
> instead of a single giant message.

---

## 14. gRPC in the Browser & Other Gotchas

- **Browsers can't speak gRPC directly** — they don't expose the HTTP/2 frames gRPC needs. Use
  **gRPC-Web** + a proxy (Envoy) that translates between the browser and the gRPC server.
- **Not human-readable** — debugging needs tools (`grpcurl`, BloomRPC/Postman gRPC, reflection).
- **Server reflection** — lets tools discover services without the `.proto` (handy for debugging).
- **No native HTTP caching** — unlike REST `GET`s.
- **Tighter coupling** — both sides share the `.proto`; great internally, heavier for public/3rd-party
  APIs.

> **"Can the browser call gRPC?"** Not directly. Use **gRPC-Web** through a proxy (Envoy). That's a
> big reason REST/GraphQL still rule the public edge while gRPC dominates internal service-to-service.

---

## 15. Best Practices & Common Pitfalls

- **Always set deadlines** and propagate `ctx`. (No deadline = hung calls.)
- **Never reuse/renumber fields**; `reserve` removed ones.
- Use **`optional`/wrappers** when "unset vs default" matters.
- Assign **field numbers 1–15** to the most-used fields.
- **Reuse channels**; don't create one per call.
- Put auth/logging/retries in **interceptors**.
- Handle `UNAVAILABLE`/`DEADLINE_EXCEEDED` with **retry + backoff** (and make calls idempotent).
- Use **streaming** for large/continuous data, not giant unary messages.
- Plan **L7 load balancing** (Envoy/mesh) — L4 won't balance multiplexed connections.
- Don't expose gRPC raw to browsers (gRPC-Web + proxy).
- Version with **packages** (`user.v1`) and additive changes, not breaking ones.

> "Contract-first `.proto`, additive evolution with reserved numbers, deadlines everywhere,
> interceptors for cross-cutting concerns, and L7 load balancing — that's a production-grade gRPC
> setup."

---

## 16. Interview Q&A Bank

**Q: What is gRPC?**
> A high-performance, contract-first RPC framework using Protocol Buffers over HTTP/2, with codegen in
> many languages and native streaming — ideal for internal microservice communication.

**Q: What are Protocol Buffers and why use them over JSON?**
> A binary, schema-driven serialization format — smaller and faster than JSON, with strong typing and
> safe evolution. Field names aren't transmitted (just numbers), so payloads are compact.

**Q: The four gRPC call types?**
> Unary (1↔1), server streaming (1 request → stream), client streaming (stream → 1 response),
> bidirectional streaming (stream ↔ stream).

**Q: How does Protobuf handle backward compatibility?**
> Stable field numbers: add fields with new numbers, never reuse/renumber, reserve removed numbers,
> unknown fields are ignored. Additive changes interoperate across old/new clients.

**Q: Why does gRPC use HTTP/2?**
> Multiplexing (many calls on one connection), bidirectional streaming, binary framing, and header
> compression — required for its performance and streaming model.

**Q: gRPC vs REST?**
> gRPC = binary, HTTP/2, strict contract, streaming, great for internal/polyglot/low-latency. REST =
> JSON, human-readable, cacheable, browser-native, best for public APIs.

**Q: What are deadlines and why important?**
> A client-set time bound that propagates across hops; on expiry the call fails with DEADLINE_EXCEEDED
> and is cancelled. Prevents hung calls from exhausting resources and cascading failures.

**Q: How do you secure gRPC?**
> TLS/mTLS for transport, tokens in metadata for per-call auth, and interceptors to enforce
> authentication/authorization centrally.

**Q: What are interceptors?**
> Middleware wrapping calls (client or server) for auth, logging, metrics, retries, tracing — without
> touching business logic.

**Q: Why is gRPC load balancing tricky?**
> Long-lived multiplexed HTTP/2 connections defeat L4 LBs; use client-side LB or an L7 proxy
> (Envoy/mesh) that balances per request.

**Q: Can browsers use gRPC?**
> Not directly — use gRPC-Web with a proxy (Envoy) to translate. This is why REST/GraphQL still
> dominate public/browser-facing APIs.

**Q: How do you represent optional/nullable in proto3?**
> Use the `optional` keyword (adds field presence) or wrapper types (Int32Value, etc.), because plain
> proto3 scalars can't distinguish unset from default (0/""/false).

**Q: How do error/status work in gRPC?**
> Its own status codes (OK, NOT_FOUND, UNAVAILABLE, DEADLINE_EXCEEDED…), not HTTP codes, plus optional
> structured error details. Retry UNAVAILABLE/DEADLINE_EXCEEDED with backoff.

**Q: Tips for efficient Protobuf?**
> Field numbers 1–15 for hot fields (1-byte tags), use sint*/zig-zag for negatives, prefer streaming
> over huge messages, and keep messages focused.

---

## 17. Cheat Sheet

- **gRPC = contract-first RPC over HTTP/2 with Protobuf + codegen.**
- **Protobuf = binary, schema-driven, 3–10× smaller/faster than JSON;** field **numbers** identify
  fields, not names.
- **Four calls:** unary, server-stream, client-stream, bidirectional.
- **Schema evolution:** add new numbers, never reuse/renumber, `reserve` removed ones, unknown fields
  ignored.
- **HTTP/2 gives:** multiplexing, streaming, binary framing, header compression.
- **Deadlines:** always set + propagate `ctx`; expiry → `DEADLINE_EXCEEDED` + cancellation.
- **Errors:** gRPC status codes; retry `UNAVAILABLE`/`DEADLINE_EXCEEDED` with backoff + idempotency.
- **Cross-cutting:** metadata (headers/auth) + interceptors (middleware); TLS/mTLS for security.
- **Load balancing:** L4 won't spread multiplexed connections → client-side LB or L7 proxy
  (Envoy/mesh).
- **proto3:** scalars have defaults; use `optional`/wrappers for nullability.
- **Perf:** field numbers 1–15 hot, `sint*` for negatives, stream big data, reuse channels, ~4MB
  default limit.
- **Browser:** no direct gRPC → gRPC-Web + proxy.
- **Use gRPC internally (microservices); REST/GraphQL at the public edge.**

---

*End of handbook. Remember: **Protobuf = the compact typed contract; gRPC = fast streaming RPC over
HTTP/2.** Field numbers are forever, and always set a deadline. 🔌*
