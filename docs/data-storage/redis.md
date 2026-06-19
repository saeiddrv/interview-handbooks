# Redis — Interview Handbook

> A complete, easy-to-understand guide to Redis: what it is, every data structure, persistence,
> eviction, clustering & replication, caching patterns, pub/sub & streams, distributed locks, the
> tricky failure modes — and a deep Q&A bank.
>

---

## 1. What Is Redis & Why It's Fast

**Redis** (REmote DIctionary Server) is an **in-memory data store** used as a cache, database, and
message broker. It keeps data in **RAM** (not disk), which is why reads/writes take **microseconds**.

**Why it's so fast:**
- **In-memory** — RAM is ~100,000× faster than a cross-network disk round trip.
- **Simple data structures** with O(1)/O(log n) operations.
- **Single-threaded** event loop — no lock contention or context-switching overhead.
- **Efficient protocol** (RESP) and optional pipelining.

> **Senior framing:** "Redis is a single-threaded, in-memory data-structure server. It's not just a
> key-value cache — it gives you strings, hashes, lists, sets, sorted sets, streams, and atomic ops, so
> you push logic to the data instead of round-tripping."

It's **more than a cache** — it's a data-structure server with optional durability.

---

## 2. Single-Threaded Model (the surprising part)

Redis processes commands on a **single thread**, one at a time, via an event loop. This sounds like a
limitation but is a strength:

- **Every command is atomic** — no race conditions between commands, no locks needed.
- **No concurrency bugs** in the data layer.
- It's still blazing fast because operations are in-memory and O(1).

> **Trap — a slow command blocks everything.** Since it's single-threaded, an expensive command
> (`KEYS *`, big `SMEMBERS`, large `SORT`) **blocks all other clients**. Never run `KEYS` in
> production — use **`SCAN`** (cursor-based, non-blocking).

> **"If Redis is single-threaded, how does it use multiple cores?"** Run multiple Redis instances/
> shards (Cluster), or use replicas for reads. Redis 6+ added **multi-threaded I/O** (network read/
> write) but command **execution is still single-threaded**.

---

## 3. Core Data Structures

The heart of Redis. Know each, its operations, and a use case:

| Type | What it is | Key commands | Use case |
|---|---|---|---|
| **String** | Bytes/number (max 512MB) | `SET GET INCR APPEND SETEX` | Cache values, counters, flags |
| **Hash** | Field→value map (like an object) | `HSET HGET HGETALL HINCRBY` | Store an object (user profile) |
| **List** | Ordered linked list | `LPUSH RPUSH LPOP BRPOP LRANGE` | Queues, stacks, recent items |
| **Set** | Unordered unique members | `SADD SISMEMBER SINTER SUNION` | Tags, unique visitors, relations |
| **Sorted Set (ZSet)** | Set ordered by a score | `ZADD ZRANGE ZRANK ZREVRANGE` | Leaderboards, priority queues, rate limits |

```bash
# String counter (atomic!)
INCR page:views                 # → 1, 2, 3 ...
SET session:abc "data" EX 3600  # value with 1h TTL

# Hash = an object
HSET user:1 name "Sam" age 30
HGETALL user:1

# List as a queue
LPUSH jobs "task1"
BRPOP jobs 0                     # blocking pop (worker waits)

# Sorted set = leaderboard
ZADD leaderboard 100 "alice" 250 "bob"
ZREVRANGE leaderboard 0 9 WITHSCORES   # top 10
```

> "The **Sorted Set** is Redis's secret weapon — leaderboards, rate limiters (sliding window),
> priority queues, and time-ordered indexes all fall out of `ZADD`/`ZRANGEBYSCORE`."

> **"How would you build a leaderboard?"** A sorted set: `ZADD` with the score, `ZREVRANGE` for top-N,
> `ZRANK` for a player's rank — all O(log n). No sorting needed.

---

## 4. Advanced Data Structures

| Type | What it does | Use case |
|---|---|---|
| **HyperLogLog** | Approximate unique count in ~12KB | Count unique visitors at scale (`PFADD`/`PFCOUNT`) |
| **Bitmap** | Bits on a string | Daily active users, feature flags (`SETBIT`/`BITCOUNT`) |
| **Geospatial** | Lat/long with radius search | "Nearby" features (`GEOADD`/`GEOSEARCH`) |
| **Streams** | Append-only log (Kafka-like) | Event streams, durable queues with consumer groups |
| **Bitfield** | Multiple counters in one string | Compact counters |

> "**HyperLogLog** counts millions of uniques in 12KB with ~0.81% error — perfect when exact counts
> aren't worth the memory. **Bitmaps** track daily-active-users super compactly (one bit per user)."

---

## 5. Keys, TTL & Expiration

- **TTL (time-to-live):** `EXPIRE key 60`, `SET key val EX 60`, `TTL key` (remaining), `PERSIST key`
  (remove expiry).
- **How expiration works:** Redis uses **lazy** (checks on access) **+ active** (samples random keys
  periodically) expiration. A key may linger in memory until accessed or sampled.
- **Key naming convention:** use `:` namespaces — `user:1000:sessions`.

> **Trap:** expired keys aren't deleted exactly on time — they're removed lazily on access or by the
> background sampler, so memory may not drop instantly.

---

## 6. Persistence: RDB vs AOF

Redis is in-memory but can **persist to disk** so data survives restarts. Two mechanisms:

| | **RDB (snapshot)** | **AOF (Append-Only File)** |
|---|---|---|
| What | Point-in-time **binary snapshot** | Log of **every write command** |
| Recovery | Fast (load one file) | Slower (replay commands) |
| Durability | Can lose minutes of data | Loses ≤1s (with `everysec`) |
| File size | Compact | Larger (rewritten/compacted periodically) |
| Cost | `fork()` + dump (periodic) | Per-write append |

- **RDB** — saves a snapshot every N seconds/changes (`SAVE`/`BGSAVE`). Good for backups & fast
  restart; risks losing recent writes.
- **AOF** — appends each write; `appendfsync` = `always` (safest, slow), **`everysec`** (default,
  ≤1s loss), or `no` (OS decides). Rewritten periodically to stay compact.
- **Hybrid (recommended)** — enable **both**; Redis can use an RDB preamble in the AOF for fast load
  + good durability.

> **"RDB vs AOF — which do you use?"** Both. RDB for fast restarts/backups, AOF (`everysec`) for
> durability. If you need max durability use AOF `always`; if Redis is purely a cache, you can disable
> persistence entirely.

> **`BGSAVE` fork trap:** snapshotting forks the process (copy-on-write). On a huge dataset under
> heavy writes this can spike memory and latency.

---

## 7. Eviction Policies (when memory is full)

When Redis hits `maxmemory`, an **eviction policy** decides what to drop:

| Policy | Behavior |
|---|---|
| `noeviction` | Reject writes (errors) — default |
| `allkeys-lru` | Evict least-recently-used across all keys |
| `allkeys-lfu` | Evict least-**frequently**-used (better hit rates) |
| `volatile-lru` | LRU, but only keys **with a TTL** |
| `volatile-lfu` | LFU among keys with TTL |
| `allkeys-random` / `volatile-random` | Random eviction |
| `volatile-ttl` | Evict keys with the nearest expiry |

> "For a pure cache I use **`allkeys-lru`** (or `allkeys-lfu` for better hit ratio). For a mixed
> store I use **`volatile-*`** so only explicitly-expirable keys get evicted and important data stays."

> **Trap:** with `noeviction` (the default), a full Redis **rejects all writes** — your app starts
> erroring. Set `maxmemory` + an eviction policy deliberately.

---

## 8. Caching Patterns & the Hard Problems

Redis's #1 use is caching. Know the patterns and the failure modes.

### Patterns
| Pattern | How | Notes |
|---|---|---|
| **Cache-aside (lazy)** | App checks cache; on miss, read DB & populate | Most common; simple |
| **Read-through** | Cache layer loads from DB on miss | Cleaner app code |
| **Write-through** | Write cache + DB together | Consistency over write speed |
| **Write-behind** | Write cache now, DB async later | Fast writes, risk of loss |

```python
def get_user(id):
    u = redis.get(f"user:{id}")
    if u: return u                       # hit
    u = db.query(id)                     # miss
    redis.set(f"user:{id}", u, ex=300)   # populate with TTL
    return u
```

### The three hard problems (favorite interview topic)
1. **Cache penetration** — queries for keys that **don't exist** bypass the cache and hammer the DB
   (often malicious). **Fix:** cache the "null" result briefly, or a **Bloom filter** to reject
   non-existent keys.
2. **Cache avalanche** — many keys **expire at the same time** (or Redis restarts) → a flood hits the
   DB. **Fix:** add **random jitter** to TTLs, stagger expiry, use a circuit breaker.
3. **Cache stampede / breakdown (hot key)** — one **popular key** expires and thousands of requests
   rebuild it simultaneously. **Fix:** a **lock/single-flight** so only one request rebuilds it; or
   logical/early expiry (refresh before it expires).

> **"How do you keep cache and DB consistent?"** Cache-aside + **invalidate on write** (write DB
> then delete the cache key) with TTL as a safety net. Accept a small staleness window or use
> write-through for stronger consistency. State the trade-off and watch for stampedes.

---

## 9. Replication, Sentinel & Cluster

Three levels of scaling/HA — don't mix them up:

### Replication (read scaling + redundancy)
**Primary–replica:** one primary takes writes, replicas copy data and serve reads. Async by default →
**replicas can be slightly stale** (replication lag). Replicas don't auto-failover by themselves.

### Sentinel (automatic failover)
**Redis Sentinel** monitors the primary; if it dies, Sentinels **agree (quorum)** and **promote a
replica** to primary, updating clients. Gives **high availability** without sharding.

### Cluster (horizontal scaling / sharding)
**Redis Cluster** shards data across multiple primaries using **16384 hash slots** (`slot =
CRC16(key) mod 16384`). Each primary owns a slot range (+ its replicas). Scales **writes and memory**
beyond one machine.

```
Cluster: slots 0–5460 → node A, 5461–10922 → node B, 10923–16383 → node C
key "user:42" → CRC16 → slot 866 → node A
```

> **Sentinel vs Cluster:** **Sentinel** = HA/failover on a *single* dataset (no sharding).
> **Cluster** = sharding across nodes for scale (with built-in failover). Use Sentinel when one node
> holds everything; Cluster when data outgrows one node.

> **Cluster trap — multi-key ops:** commands touching multiple keys must be in the **same slot**.
> Use **hash tags** `{...}` to force keys together: `user:{42}:name` and `user:{42}:age` share a slot.
> Otherwise `MGET`/transactions across slots fail.

---

## 10. Transactions & Lua Scripting

### MULTI/EXEC transactions
`MULTI` … commands … `EXEC` queues commands and runs them **atomically** (no other client interleaves).
But **no rollback** — if a command fails, others still execute (Redis only rolls back on syntax
errors). It's atomic, not "all-or-nothing on logic errors."

**Optimistic locking with `WATCH`:** watch a key; if it changes before `EXEC`, the transaction aborts —
retry. (Check-and-set pattern.)

### Lua scripting
`EVAL` runs a Lua script **atomically** on the server — multiple operations as one indivisible unit, no
round trips, no interleaving. The go-to for atomic read-modify-write logic (e.g., rate limiters, locks).

> "For complex atomic operations I use a **Lua script** — it runs server-side as a single atomic
> unit, avoiding race conditions and round trips. MULTI/EXEC is simpler but has no real rollback."

---

## 11. Pub/Sub & Streams

### Pub/Sub
`SUBSCRIBE channel` / `PUBLISH channel msg` — **fire-and-forget** messaging. **No persistence**: if
no subscriber is listening, the message is **lost**; subscribers that reconnect miss everything. Good
for live notifications, not reliable queues.

### Streams (the durable option)
`XADD`/`XREAD` — an **append-only log** with IDs, persistence, and **consumer groups**
(`XREADGROUP`, `XACK`) like Kafka. Messages are retained and can be replayed; supports at-least-once
delivery with acknowledgments.

> **"Pub/Sub vs Streams?"** Pub/Sub is ephemeral (no history, lost if no listener). **Streams** are
> durable, replayable, and support consumer groups + acks — use Streams for reliable queues, Pub/Sub
> for live broadcasts.

---

## 12. Distributed Locks (Redlock)

A common use: a lock so only one process does something at a time across servers.

**Simple lock:** `SET lock:resource <token> NX PX 30000`
- `NX` = only set if not exists (acquire), `PX` = auto-expire (avoid deadlock if the holder dies),
  `<token>` = a unique value so only the owner can release.
- **Release safely with Lua** (check token == mine, then delete) — never a plain `DEL` (you might
  delete someone else's lock).

**Redlock algorithm** — for stronger guarantees across **multiple independent Redis nodes**, acquire
the lock on a majority (N/2+1) within a time bound.

> **Redlock controversy:** Martin Kleppmann argued Redlock isn't safe under GC pauses/clock drift
> for correctness-critical locks; use a **fencing token** if correctness matters. Know this debate —
> it signals depth. For most use cases a single-instance `SET NX PX` + token is fine.

---

## 13. Rate Limiting with Redis

A classic design question. Common approaches:
- **Fixed window:** `INCR` a key like `rate:user:123:minute` with a TTL; reject if > limit. Simple but
  bursty at window edges.
- **Sliding window log:** a **sorted set** of timestamps; remove old entries (`ZREMRANGEBYSCORE`), count
  the rest. Accurate, more memory.
- **Token bucket:** track tokens + last-refill time (often in a **Lua script** for atomicity).

```bash
# Fixed window
INCR rate:user:123
EXPIRE rate:user:123 60      # if INCR result > 100 → reject
```

> "I implement rate limits in a **Lua script** for atomicity — sliding-window via a sorted set when
> I need accuracy, fixed-window `INCR` when simplicity/speed matters."

---

## 14. Performance & Pitfalls

- **Never `KEYS *` in production** — O(n), blocks the single thread. Use **`SCAN`**.
- **Big keys** (huge lists/hashes/sets) — slow ops, blocking, uneven memory. Split them.
- **Hot keys** — one key gets all traffic, can't be sharded away. Add local caching/replicas.
- **Pipelining** — batch many commands in one round trip (huge latency win).
- **Connection pooling** — reuse connections; don't open one per request.
- **Avoid large values** — keep values small; Redis is for hot, small data.
- **Monitor**: `INFO`, `SLOWLOG`, `MONITOR` (debug only), memory fragmentation, hit ratio, evictions.
- **Atomic counters** (`INCR`) beat read-modify-write round trips.

> **"Redis is slow / latency spiked — why?"** Likely a blocking command (`KEYS`, big `SORT`), a big
> key, `BGSAVE` fork pressure, swapping (memory over RAM), or network/pipeline issues. Check `SLOWLOG`
> and `INFO`.

---

## 15. Redis Use Cases

- **Caching** (the #1 use).
- **Session store** (fast, with TTL).
- **Leaderboards / ranking** (sorted sets).
- **Rate limiting** (counters/sorted sets).
- **Real-time analytics / counters** (`INCR`, HyperLogLog, bitmaps).
- **Queues / job processing** (lists, streams).
- **Pub/Sub messaging** (live notifications).
- **Distributed locks** (`SET NX`).
- **Geospatial** ("nearby" search).
- **Full session/feature flags**, recent-items feeds, autocomplete.

> "Redis shines for **hot, small, frequently-accessed data with simple access patterns** — cache,
> sessions, counters, leaderboards, rate limits, and queues."

---

## 16. Interview Q&A Bank

**Q: What is Redis and why is it fast?**
> An in-memory, single-threaded data-structure server. Fast because data is in RAM, operations are
> O(1)/O(log n), and the single-threaded event loop avoids locks and contention.

**Q: If single-threaded, how does it handle concurrency / use cores?**
> Commands are atomic (no locks needed). For cores, run multiple instances/shards (Cluster) and use
> replicas for reads; Redis 6+ has multi-threaded I/O but single-threaded command execution.

**Q: Name the core data structures and a use case each.**
> String (counters/cache), Hash (objects), List (queues), Set (unique tags), Sorted Set
> (leaderboards/rate limits).

**Q: How do you build a leaderboard?**
> Sorted set: ZADD scores, ZREVRANGE for top-N, ZRANK for a player's position — all O(log n).

**Q: RDB vs AOF?**
> RDB = periodic binary snapshot (fast restart, can lose minutes). AOF = logs every write (≤1s loss
> with everysec, larger, slower restore). Use both; AOF always for max durability.

**Q: What eviction policies exist and which do you pick?**
> noeviction (default, rejects writes), allkeys-lru/lfu, volatile-lru/lfu/ttl, random. Use allkeys-lru/
> lfu for a pure cache; volatile-* to protect non-expirable data.

**Q: Explain cache penetration, avalanche, and stampede.**
> Penetration = requests for non-existent keys hit the DB (cache nulls / Bloom filter). Avalanche =
> mass simultaneous expiry (TTL jitter). Stampede = a hot key expires and many rebuild it (lock/
> single-flight or early refresh).

**Q: How do you keep cache and DB consistent?**
> Cache-aside + invalidate on write (write DB, delete key) with TTL as safety; accept small staleness
> or use write-through. Beware stampedes.

**Q: Replication vs Sentinel vs Cluster?**
> Replication = copies for read scaling/redundancy (no auto-failover). Sentinel = monitoring + automatic
> failover on a single dataset. Cluster = sharding across nodes (16384 hash slots) for scale + failover.

**Q: How does Redis Cluster shard data?**
> 16384 hash slots; slot = CRC16(key) mod 16384; each primary owns a slot range. Multi-key ops need the
> same slot — use hash tags {…}.

**Q: Are Redis transactions ACID / do they roll back?**
> MULTI/EXEC runs queued commands atomically (no interleaving) but does NOT roll back on logic errors.
> Use WATCH for optimistic locking; Lua for true atomic multi-step logic.

**Q: Pub/Sub vs Streams?**
> Pub/Sub is ephemeral fire-and-forget (lost if no subscriber). Streams are durable, replayable, with
> consumer groups and acks — use Streams for reliable queues.

**Q: How do you implement a distributed lock?**
> SET key token NX PX ttl to acquire (auto-expiry prevents deadlock); release via Lua checking the
> token. Redlock for multi-node; use fencing tokens for correctness-critical locks.

**Q: Why never use KEYS in production?**
> It's O(n) and blocks the single thread, freezing all clients. Use SCAN (cursor-based, non-blocking).

**Q: How do you rate-limit with Redis?**
> Fixed window (INCR + EXPIRE), sliding window (sorted set of timestamps), or token bucket (Lua for
> atomicity).

---

## 17. Cheat Sheet

- **Redis = in-memory, single-threaded, atomic-per-command data-structure server.**
- **Structures:** String, Hash, List, Set, **Sorted Set** (leaderboards/rate limits) + HLL, Bitmap,
  Geo, **Streams**.
- **Single-threaded ⇒ never `KEYS *`** (use `SCAN`); a slow command blocks everyone.
- **Persistence:** RDB (snapshot) + AOF (write log, `everysec`); use both.
- **Eviction:** set `maxmemory` + `allkeys-lru/lfu` (cache) or `volatile-*` (mixed); default
  `noeviction` rejects writes.
- **Caching:** cache-aside + invalidate-on-write + TTL jitter; beware penetration/avalanche/stampede.
- **Scaling:** Replication (reads) → Sentinel (HA failover) → Cluster (sharding, 16384 slots, hash
  tags).
- **Atomicity:** MULTI/EXEC (no rollback) + WATCH, or **Lua** for multi-step atomic logic.
- **Messaging:** Pub/Sub (ephemeral) vs **Streams** (durable + consumer groups).
- **Locks:** `SET NX PX` + token + Lua release; Redlock/fencing for correctness.
- **Perf:** pipelining, connection pools, atomic counters, avoid big/hot keys, watch `SLOWLOG`.

---

*End of handbook. Remember: Redis is a **single-threaded in-memory data-structure server** — reason
about atomicity, memory/eviction, and persistence from there.*
