---
title: "Nginx & Load Balancing — Advanced Interview Handbook"
description: "A deep, easy-to-understand guide to Nginx, reverse proxying, and load balancing for senior interviews: how Nginx's event model makes it fast, reverse…"
sidebar:
  label: "Nginx & Load Balancing"
---

> A deep, easy-to-understand guide to Nginx, reverse proxying, and load balancing for senior
> interviews: how Nginx's event model makes it fast, reverse proxy vs forward proxy, every load-
> balancing algorithm, health checks, TLS termination, caching, rate limiting, L4 vs L7, the tricky
> failure modes (sticky sessions, thundering herd, keepalive) — plus a deep Q&A bank.
>

---

## 1. What Nginx Is & Why It's Fast

**Nginx** is a high-performance **web server, reverse proxy, load balancer, and HTTP cache**. It's
famous for handling **tens of thousands of concurrent connections** with low memory.

**Why it's fast:** an **event-driven, asynchronous, non-blocking** architecture — unlike the old
**thread/process-per-connection** model (e.g., classic Apache prefork) that runs out of memory under
high concurrency.

> **Senior framing:** "Nginx solved the **C10k problem** with an event loop: a few worker processes
> each handle thousands of connections asynchronously instead of one thread per connection. That's why
> it stays fast and memory-light under massive concurrency."

**Common roles:** serve static files, reverse-proxy to app servers, balance load across backends,
terminate TLS, cache responses, rate-limit, and act as an API gateway.

---

## 2. The Event-Driven Architecture

```
              ┌─────────── Master process (reads config, manages workers) ───────────┐
              │                                                                       │
        Worker process 1            Worker process 2            Worker process N
        (event loop)                (event loop)                (event loop)
        ├─ conn A (idle)            ├─ conn D (reading)         ...
        ├─ conn B (writing)         ├─ conn E (waiting backend)
        └─ conn C (waiting)         └─ ...
   Each worker handles THOUSANDS of connections via non-blocking I/O (epoll/kqueue).
```

- **Master process** — reads config, binds ports, spawns/manages **worker processes** (doesn't handle
  requests). Enables zero-downtime reloads.
- **Worker processes** — usually **one per CPU core**; each runs an **event loop** handling many
  connections with non-blocking I/O (`epoll` on Linux).
- **No thread-per-connection** → tiny memory per connection, no context-switch storms.

> **"Nginx vs Apache?"** Apache (prefork) uses a thread/process per connection — simple but
> memory-heavy and limited under high concurrency. Nginx uses an event loop — far better at many
> concurrent/idle/slow connections (keepalive, slow clients). Apache is more flexible per-directory
> (`.htaccess`, embedded modules).

> **Trap:** because a worker is a single event loop, **blocking operations block all its
> connections.** Nginx offloads heavy disk I/O to a thread pool; you keep workers non-blocking.

---

## 3. Reverse Proxy vs Forward Proxy

| | **Forward proxy** | **Reverse proxy** (Nginx's main role) |
|---|---|---|
| Sits in front of | **Clients** | **Servers** |
| Hides | The client from the server | The servers from the client |
| Example | Corporate web filter, VPN | Nginx in front of your app servers |

```
Forward:  Client → [Forward Proxy] → Internet → Server   (proxy acts for the client)
Reverse:  Client → Internet → [Reverse Proxy/Nginx] → App Servers   (proxy acts for the servers)
```

**Why a reverse proxy:** load balancing, TLS termination, caching, compression, security (hide backend
topology, WAF), single entry point, request routing, rate limiting.

> "A reverse proxy is the **single front door** to your backend — it centralizes TLS, load balancing,
> caching, and security so app servers stay simple and hidden."

---

## 4. Load Balancing Fundamentals

A **load balancer** distributes incoming requests across multiple backend servers so no single one is
overwhelmed — giving **scalability, high availability, and redundancy**.

```
                    ┌──→ App Server 1
Client → [Nginx LB] ┼──→ App Server 2
                    └──→ App Server 3   (one dies → traffic reroutes to the others)
```

**Benefits:** horizontal scaling, fault tolerance (route around dead servers), zero-downtime deploys
(drain a server), better utilization.

> **Prerequisite — stateless servers:** load balancing works cleanly only if app servers are
> **stateless** (no session stored locally), so any server can handle any request. Otherwise you need
> sticky sessions (§8) or shared session state (Redis).

```nginx
upstream backend {
    server app1:8080;
    server app2:8080;
    server app3:8080 backup;   # only used if others are down
}
server { location / { proxy_pass http://backend; } }
```

---

## 5. Load Balancing Algorithms

| Algorithm | How it picks a server | Best for |
|---|---|---|
| **Round Robin** (default) | Next server in rotation | Uniform servers/requests |
| **Weighted Round Robin** | Rotation weighted by capacity (`weight=3`) | Mixed server sizes |
| **Least Connections** | Server with fewest active connections | Variable request durations |
| **Weighted Least Connections** | Least conns, capacity-adjusted | Mixed sizes + variable load |
| **IP Hash** | Hash of client IP → same server | Sticky by IP (session affinity) |
| **Hash (key)** | Hash of a key (URL, header) | Cache locality, consistent routing |
| **Least Time** (Nginx Plus) | Lowest latency + fewest conns | Latency-sensitive |
| **Random (two choices)** | Pick 2 at random, choose better | Large fleets (great in practice) |

```nginx
upstream backend {
    least_conn;                 # algorithm
    server app1:8080 weight=3;
    server app2:8080;
}
```

> "Round robin is fine for uniform workloads; **least connections** is better when request durations
> vary (slow requests pile up on one server otherwise). **Power-of-two-choices random** scales
> beautifully across large fleets. **Consistent hashing** when I need cache locality or sticky routing
> with minimal disruption when servers change."

> **Consistent hashing** — hashing keys onto a ring so adding/removing a server only remaps a
> small fraction of keys (vs `mod N` remapping everything). Critical for distributed caches and sharding.

---

## 6. Layer 4 vs Layer 7 Load Balancing

| | **L4 (Transport)** | **L7 (Application)** |
|---|---|---|
| Operates on | TCP/UDP (IP + port) | HTTP (URL, headers, cookies) |
| Sees content? | **No** (just packets) | **Yes** (full request) |
| Routing | By connection | By path/host/header/cookie |
| Speed | Faster (less work) | Slightly slower (parses HTTP) |
| Features | Raw throughput | TLS termination, caching, path routing, rewrites, WAF |
| Example | AWS NLB, `stream` module | Nginx HTTP proxy, AWS ALB |

> **"L4 vs L7 — when each?"** L4 when you need raw speed and protocol-agnostic balancing (or to keep
> TLS end-to-end). L7 when you need **content-based routing** (`/api` → service A, `/img` → service B),
> TLS termination, caching, or header manipulation. Nginx does both (`http {}` = L7, `stream {}` = L4).

> "L4 is a fast packet router; L7 understands HTTP, so it can route by path/host, terminate TLS,
> cache, and rewrite — at a small CPU cost."

---

## 7. Health Checks & Failover

A load balancer must stop sending traffic to dead/unhealthy servers.

- **Passive health checks** (open-source Nginx) — mark a server down after N failed real requests
  (`max_fails`, `fail_timeout`), retry later.
- **Active health checks** (Nginx Plus / many LBs) — periodically probe a `/health` endpoint
  proactively, before real users hit a broken server.

```nginx
upstream backend {
    server app1:8080 max_fails=3 fail_timeout=30s;
    server app2:8080 max_fails=3 fail_timeout=30s;
}
```

> **Health endpoint design:** a good `/health` checks the server *and* critical dependencies
> (DB/cache) — but if it checks a shared DB, **one DB blip can mark every server unhealthy at once**
> (cascading outage). Separate **liveness** (am I up?) from **readiness** (can I serve?).

> "Active checks catch failures before users do; passive checks need real failures first. I design
> health endpoints carefully so a shared-dependency hiccup doesn't take the whole fleet out of
> rotation."

---

## 8. Sticky Sessions (and why to avoid them)

**Sticky session (session affinity)** = always route a given user to the **same** backend (via IP hash
or a cookie). Needed when a server stores session state locally.

> **Why avoid them:** they break clean load balancing (uneven load), defeat easy scaling/failover
> (if that server dies, the user's session is lost), and complicate deploys. The better fix is
> **stateless servers** with **shared session state** (Redis) or **JWT** tokens the client carries.

> **"How do you handle sessions behind a load balancer?"** Preferred: make servers stateless — store
> sessions in Redis or use stateless JWTs, so any server serves any request. Sticky sessions are a
> fallback for legacy stateful apps.

---

## 9. TLS/SSL Termination

**TLS termination** = the reverse proxy decrypts HTTPS, then talks **plain HTTP** to backends (inside a
trusted network). Centralizes certificates and offloads crypto from app servers.

- **TLS termination** — decrypt at the proxy (simple, fast backends, but internal traffic is plaintext).
- **TLS passthrough** (L4) — forward encrypted traffic straight to backends (end-to-end encryption, no
  L7 features).
- **TLS re-encryption / end-to-end** — terminate at the proxy, then re-encrypt to backends (best of
  both for zero-trust).

> "I terminate TLS at Nginx to centralize certs (and use OCSP stapling, HTTP/2, modern ciphers),
> then re-encrypt to backends in zero-trust environments. For pure L4 or compliance, TLS passthrough
> keeps it end-to-end."

---

## 10. Caching & the Thundering Herd

Nginx can **cache responses** from backends, serving repeat requests itself (huge load reduction).

```nginx
proxy_cache_path /var/cache/nginx keys_zone=mycache:10m max_size=1g inactive=60m;
location / {
    proxy_cache mycache;
    proxy_cache_valid 200 10m;
    proxy_cache_use_stale error timeout updating;   # serve stale on backend trouble
    add_header X-Cache-Status $upstream_cache_status;
}
```

- **Cache key** (default: scheme+host+URI); honors `Cache-Control`/`Expires`.
- **`proxy_cache_use_stale`** — serve stale content when the backend is down/slow (graceful
  degradation).

> **Thundering herd / cache stampede** — when a popular cached item expires, **many requests hit
> the backend simultaneously** to regenerate it. Nginx fixes this with **`proxy_cache_lock`** (only one
> request fetches from the backend; others wait) and **`proxy_cache_use_stale updating`** (serve stale
> while one updates). Also stagger TTLs.

> "I prevent cache stampedes with `proxy_cache_lock` + `use_stale updating` so a single request
> repopulates the cache while everyone else gets slightly-stale content instead of stampeding the
> origin."

---

## 11. Rate Limiting & Connection Limiting

Protect backends from abuse/overload.

- **Request rate limiting** — `limit_req` uses a **leaky bucket**: a steady rate (`rate=10r/s`) with an
  optional **burst** buffer.
- **Connection limiting** — `limit_conn` caps concurrent connections per key (IP).

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
location /api/ {
    limit_req zone=api burst=20 nodelay;   # allow short bursts, then throttle
}
```

> **Leaky bucket vs token bucket:** leaky bucket enforces a smooth constant output rate (Nginx's
> model); token bucket allows bursts up to a bucket size then refills. `burst` + `nodelay` approximates
> bursty token-bucket behavior.

> **Rate-limit key trap:** limiting by client IP punishes users behind a shared NAT/proxy and is
> fooled by spoofing/rotating IPs. Behind a proxy, use the real client IP from `X-Forwarded-For`
> (configured via `real_ip`), or limit by API key/user.

---

## 12. Compression, Buffering & Keepalive

- **Gzip/Brotli compression** — shrink responses (`gzip on`); beware **BREACH** with compressed
  secret-bearing responses.
- **Proxy buffering** — Nginx buffers the backend response so slow clients don't tie up backend
  workers (`proxy_buffering on`). Disable for streaming/SSE.
- **Upstream keepalive** — reuse connections to backends (`keepalive 32`) to avoid TCP/TLS handshake
  per request. Must also set `proxy_http_version 1.1` and clear the `Connection` header, or keepalive
  silently won't work.
- **Slowloris protection** — timeouts (`client_body_timeout`, `client_header_timeout`) defend against
  slow-drip connection-exhaustion attacks (Nginx's event model already helps).

---

## 13. Nginx Config Essentials

```nginx
http {
  upstream app { least_conn; server a:8080; server b:8080; keepalive 32; }

  server {
    listen 443 ssl http2;
    server_name example.com;
    ssl_certificate     /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;

    location /api/ {
      proxy_pass http://app;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /static/ { root /var/www; expires 30d; }
  }
}
```

- **`location` matching order**: exact `=` > prefix `^~` > regex `~`/`~*` (first match wins) >
  longest prefix. A frequent source of "wrong block matched" bugs.
- **Zero-downtime reload:** `nginx -s reload` — master starts new workers with new config, drains old
  ones. No dropped connections.
- **Always forward `X-Forwarded-For`/`X-Forwarded-Proto`** so backends see the real client IP/scheme.

---

## 14. High Availability (no single point of failure)

The load balancer itself must not be a single point of failure.

- **Active-passive:** two Nginx nodes share a **Virtual IP (VIP)** via **keepalived (VRRP)**; if the
  active dies, the passive takes the VIP over.
- **Active-active:** **DNS round robin** or an upstream L4 LB distributes across multiple Nginx nodes.
- **Cloud:** a managed LB (ALB/NLB) is itself redundant across AZs.

> **"How do you make the load balancer highly available?"** Run at least two with a floating VIP
> (keepalived/VRRP) for active-passive failover, or multiple behind DNS/anycast for active-active. Never
> a single LB.

---

## 15. Advanced Gotchas (senior-level)

1. **Upstream keepalive needs `proxy_http_version 1.1` + cleared `Connection` header** — otherwise it
   silently doesn't reuse connections.
2. **`location` precedence** (=, ^~, regex, prefix) trips people up.
3. **Sticky sessions** undermine scaling/failover — prefer stateless + shared session store.
4. **Health checks on a shared DB** can mark the whole fleet unhealthy at once.
5. **Cache stampede** — use `proxy_cache_lock` + `use_stale updating`.
6. **Rate limiting by IP** breaks behind NAT/CDN — use real client IP / API keys.
7. **`X-Forwarded-For` spoofing** — only trust it from known proxies (`set_real_ip_from`).
8. **L4 can't do path routing or TLS termination**; L7 can but costs CPU.
9. **Blocking a worker blocks thousands of connections** — keep workers non-blocking.
10. **Buffering vs streaming** — disable proxy buffering for SSE/WebSocket/large streams.
11. **WebSocket proxying** needs `Upgrade`/`Connection` headers explicitly set.
12. **gzip + secrets = BREACH** risk; don't compress sensitive responses with reflected input.

> "Senior signals: event-loop model (blocking is fatal), L4-vs-L7 trade-offs, **stateless servers
> over sticky sessions**, stampede protection, careful health-check & X-Forwarded-For handling, and the
> LB itself being HA."

---

## 16. Interview Q&A Bank

**Q: Why is Nginx faster than thread-per-connection servers?**
> Event-driven, non-blocking workers (one per core) each handle thousands of connections via epoll,
> instead of a thread/process per connection — far less memory and no context-switch storms (solves
> C10k).

**Q: Reverse vs forward proxy?**
> Forward proxy fronts clients (hides them from servers); reverse proxy fronts servers (hides them from
> clients) and does LB, TLS termination, caching, and security. Nginx is mainly a reverse proxy.

**Q: Name load-balancing algorithms and when to use them.**
> Round robin (uniform), weighted (mixed capacity), least connections (variable durations), IP/key hash
> (affinity/cache locality), power-of-two-choices random (large fleets), consistent hashing (minimal
> remap on changes).

**Q: L4 vs L7 load balancing?**
> L4 routes by TCP/IP+port (fast, content-blind, keeps TLS end-to-end); L7 understands HTTP (path/host/
> header routing, TLS termination, caching) at a CPU cost.

**Q: What is consistent hashing and why?**
> Hash keys onto a ring so adding/removing a server remaps only a small fraction of keys (vs mod-N
> remapping everything). Essential for distributed caches/sharding and sticky routing.

**Q: How do health checks work?**
> Passive (mark down after real failures: max_fails/fail_timeout) and active (proactive /health probes).
> Design endpoints so a shared-dependency blip doesn't fail the whole fleet; separate liveness from
> readiness.

**Q: How do you handle sessions behind an LB?**
> Make servers stateless with shared sessions (Redis) or JWTs. Sticky sessions (IP hash/cookie) are a
> legacy fallback that hurts scaling and failover.

**Q: What is TLS termination?**
> The proxy decrypts HTTPS and talks HTTP (or re-encrypts) to backends — centralizing certs and
> offloading crypto. Passthrough (L4) keeps it end-to-end but loses L7 features.

**Q: What's a thundering herd / cache stampede and how do you prevent it in Nginx?**
> Many requests regenerate an expired hot cache entry at once, hammering the origin. Use
> proxy_cache_lock (one fetch, others wait) + proxy_cache_use_stale updating + TTL jitter.

**Q: How does Nginx rate limit?**
> limit_req (leaky bucket, rate + burst) and limit_conn (concurrent connections per key). Beware
> limiting by IP behind NAT/CDN — use real client IP or API keys.

**Q: How do you make the load balancer itself HA?**
> Active-passive with a floating VIP via keepalived/VRRP, or active-active behind DNS/anycast or a
> redundant cloud LB. Never a single LB.

**Q: Common upstream keepalive gotcha?**
> keepalive to backends requires proxy_http_version 1.1 and clearing the Connection header; otherwise
> Nginx opens a new connection per request and you lose the benefit.

**Q: How do you proxy WebSockets?**
> Set proxy_http_version 1.1 and forward Upgrade/Connection headers; disable buffering for the stream.

---

## 17. Cheat Sheet

- **Nginx = event-driven** reverse proxy / LB / web server / cache; workers (one/core) handle thousands
  of connections (solved C10k). **Blocking a worker is fatal.**
- **Reverse proxy** = single front door: LB, TLS, caching, security; hides backends.
- **Algorithms:** round robin, weighted, **least connections**, IP/key hash, power-of-two random,
  **consistent hashing** (minimal remap).
- **L4** (fast, TCP, content-blind) vs **L7** (HTTP-aware: path routing, TLS term, caching).
- **Health checks:** passive (max_fails) + active (/health); don't let a shared DB fail the fleet.
- **Sessions:** prefer **stateless + Redis/JWT** over sticky sessions.
- **TLS termination** (or passthrough/re-encrypt) centralizes certs.
- **Caching:** `proxy_cache` + `proxy_cache_lock` + `use_stale updating` to beat stampedes.
- **Rate limit:** `limit_req` (leaky bucket, rate+burst), `limit_conn`; key by real client IP/API key.
- **Keepalive upstream** needs HTTP/1.1 + cleared Connection header.
- **`location` order:** `=` > `^~` > regex > prefix. Forward `X-Forwarded-For/Proto`.
- **HA LB:** keepalived/VRRP VIP (active-passive) or DNS/cloud LB (active-active).
- **Zero-downtime reload:** `nginx -s reload`.

---

*End of handbook. The senior signal: Nginx is an **event loop** (blocking kills it), and good load
balancing means **stateless backends, the right algorithm, careful health checks, stampede protection,
and an HA load balancer**.*
