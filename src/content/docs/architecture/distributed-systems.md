---
title: "Distributed Systems — Interview Handbook"
description: "Distributed systems theory: CAP/PACELC, consistency models, logical clocks, replication, quorums, consensus, idempotency, and CRDTs — with a Q&A bank."
sidebar:
  label: "Distributed Systems Theory"
---

> The theory that separates senior from staff in design rounds: why distributed systems are hard,
> CAP and PACELC, the full consistency spectrum, time and ordering (Lamport & vector clocks),
> replication and quorums, consensus (Raft/Paxos at a usable depth), delivery semantics and
> idempotency, partitioning, CRDTs, and the failure modes (split-brain, clock skew, fencing) that
> interviewers love — plus a Q&A bank you can answer out loud.

---

## 1. Why Distributed Systems Are Hard

A **distributed system** is a set of independent machines that appear to users as one coherent
system. The hard part is not the happy path — it's that, at scale, **partial failure is the normal
state**: some node is always slow, restarting, GC-pausing, or unreachable, and you can't tell
*which* from the outside.

**The two facts everything follows from:**

1. **The network is unreliable.** Messages can be lost, delayed, duplicated, or reordered. A timeout
   tells you nothing — you can't distinguish a *crashed* node from a *slow* node from a *dropped
   reply*. This is the single most important idea in the field.
2. **There is no global clock.** Each machine has its own clock, and they drift. "What happened
   first?" has no cheap, exact answer.

**The 8 Fallacies of Distributed Computing** (worth naming): the network is reliable; latency is
zero; bandwidth is infinite; the network is secure; topology doesn't change; there is one
administrator; transport cost is zero; the network is homogeneous. **All false.** Every one is a
bug waiting to happen.

> **Senior answer:** "I design for **partial failure first**. The core constraint is that a timeout
> is ambiguous — I can't tell a dead node from a slow one — so every remote call needs timeouts,
> retries with idempotency, and a plan for 'I don't know if that succeeded.'"

---

## 2. CAP Theorem — What It Actually Says

During a **network partition** (P), a distributed system must choose between **Consistency** (C —
every read sees the latest write, i.e. linearizability) and **Availability** (A — every request
gets a non-error response).

**CAP is a choice made only when a partition is happening.** It is *not* "pick 2 of 3" as a
permanent property — that framing is wrong and interviewers notice.

- **CP** (consistency over availability): on a partition, refuse requests that can't be made safe.
  Example: a leader-based store (etcd, ZooKeeper, HBase) — the minority side stops serving.
- **AP** (availability over consistency): on a partition, keep serving and reconcile later
  (eventual consistency). Example: Dynamo-style stores (Cassandra, DynamoDB in some modes).

> **Trap:** Saying a system is "CA". You don't get to opt out of partitions — they will happen, so
> the real choice is **CP vs AP**. "CA" only describes a single-node system.

> **Trap:** Treating CAP as binary/global. Real systems choose **per-operation** (a bank may be CP
> for balance transfers, AP for "recently viewed").

---

## 3. PACELC — The More Honest Version

CAP only talks about partitions. **PACELC** extends it:

> **If** there's a **P**artition, choose **A** or **C**; **E**lse (normal operation), choose between
> **L**atency and **C**onsistency.

This captures the everyday tradeoff CAP ignores: even with **no** partition, strong consistency
costs latency (you must coordinate replicas before answering).

- **PC/EC**: always consistent, pay latency (e.g. spanner-like, traditional RDBMS replication done
  synchronously). 
- **PA/EL**: favor availability and low latency, accept weaker consistency (Cassandra, Dynamo).

> **Senior answer:** "I reach for PACELC because the interesting tradeoff isn't just partitions —
> it's that **synchronous coordination costs latency on every request**. Most of the time there's no
> partition, so 'L vs C in the normal case' is what actually shapes the design."

---

## 4. The Consistency Spectrum

"Consistency" is not one thing — it's a spectrum from strong (expensive, intuitive) to weak (cheap,
surprising). Know these by name and tradeoff:

| Model | Guarantee | Cost |
|---|---|---|
| **Linearizable (strong)** | Reads see the latest committed write; system behaves like one copy | Highest — needs coordination/consensus |
| **Sequential** | All clients see operations in the same order (not necessarily real-time) | High |
| **Causal** | Causally-related operations are seen in order; concurrent ops may differ | Medium — the sweet spot for many apps |
| **Read-your-writes** | You always see your own latest write | Low (session guarantee) |
| **Monotonic reads** | You never see time go backwards | Low (session guarantee) |
| **Eventual** | If writes stop, replicas eventually converge | Lowest — most surprising |

**Session guarantees** (read-your-writes, monotonic reads/writes) are the practical middle ground —
cheap to provide, and they kill the most user-visible anomalies ("I posted a comment and it
vanished on refresh").

> **Senior answer:** "Most products don't need linearizability everywhere. I default to **causal +
> session guarantees** and reserve strong consistency for the few invariants that truly need it —
> money, uniqueness, locks."

---

## 5. Time & Ordering: Clocks

Because there's no global clock, we order events with **logical** clocks.

**Physical clocks** (wall time) drift and can jump (NTP corrections, leap seconds). **Never use
wall-clock timestamps to order events or build locks** — clock skew between machines causes silent
data loss ("last write wins" picks the wrong write).

**Lamport clocks** — a single counter per node, incremented on each event; on send, attach it; on
receive, set `clock = max(local, received) + 1`. Gives a total order *consistent with causality*:
if A → B (A causally precedes B), then `L(A) < L(B)`. **But the converse fails** — `L(A) < L(B)`
does not prove causality, so Lamport clocks can't *detect* concurrency.

**Vector clocks** — a vector of counters, one per node. They *can* detect concurrency: by comparing
vectors you learn whether A happened-before B, B before A, or they're **concurrent** (a true
conflict needing resolution). Cost: size grows with the number of nodes.

**Hybrid Logical Clocks (HLC)** — combine physical time (so timestamps are human-meaningful and
roughly track real time) with a logical component (so causality is preserved despite skew). Used by
CockroachDB and others.

> **Nice to know:** Google **Spanner** uses **TrueTime** — GPS/atomic clocks expose time as an
> *interval* `[earliest, latest]`, and it **waits out the uncertainty** before committing, achieving
> external consistency. It buys consistency with hardware + a few ms of commit-wait.

---

## 6. Replication

Keeping copies of data on multiple nodes — for durability, availability, and read scaling. Three
shapes:

- **Single-leader (primary/replica):** all writes go to the leader, which streams a replication log
  to followers. Simple; reads can scale on followers. **Replication lag** breaks read-your-writes on
  followers. Failover requires electing a new leader (and risks split-brain).
- **Multi-leader:** multiple nodes accept writes (e.g. multi-region, or offline-capable clients).
  Great for write availability and latency, but **write conflicts** are now possible and must be
  resolved (LWW, app merge, or CRDTs).
- **Leaderless (Dynamo-style):** clients write to several replicas directly; consistency comes from
  **quorums** + read repair + anti-entropy. Highly available, eventually consistent.

**Sync vs async replication:**
- **Synchronous** — the write waits for replicas to ack → durable, no data loss on failover, but
  slower and the leader stalls if a replica is down.
- **Asynchronous** — fast, but a failover can **lose the last writes** that didn't replicate.
- **Semi-sync** (common default): wait for *one* replica synchronously, the rest async — a balance.

---

## 7. Quorums

In leaderless/quorum systems with **N** replicas, require **W** acks on write and **R** replicas on
read. If:

```
R + W > N
```

then any read quorum overlaps any write quorum by at least one node → a read is guaranteed to see
the latest write (given versioning to pick the newest).

- `W = N, R = 1`: fast reads, slow/fragile writes.
- `R = N, W = 1`: fast writes, slow reads.
- Common: `N = 3, W = 2, R = 2` → tolerate one node down and still be consistent.

**Supporting machinery:** **read repair** (fix stale replicas during a read), **hinted handoff** (a
healthy node temporarily holds writes for a down node), **anti-entropy / Merkle trees** (background
sync of divergent replicas).

> **Trap:** Quorums give you *strong-ish* consistency, **not** linearizability by default — without
> care (e.g. no read repair on the coordination path), you can still observe anomalies. Cassandra's
> `QUORUM` is tunable consistency, not a serializable transaction.

---

## 8. Consensus

**The problem:** get a group of nodes to **agree on a single value** (or an ordered log of values)
despite failures and message loss. This underpins leader election, distributed locks, config
stores, and replicated state machines.

**Why it's needed:** "just use a leader" begs the question — *who picks the leader, and how do they
agree after the old one dies?* That agreement **is** consensus.

**Safety properties:** all nodes decide the **same** value; only a value that was actually proposed;
the decision is final. **Liveness:** they eventually decide (when the network behaves).

- **Paxos** — the classic, correct, famously hard to understand and implement.
- **Raft** — designed for understandability; same guarantees. Three ideas: **leader election**
  (randomized timeouts elect one leader per term), **log replication** (leader appends entries,
  replicates to followers, commits once a **majority** acks), and **safety** (a new leader must have
  all committed entries). **Majority quorum** = tolerate `floor(N/2)` failures (so run odd numbers:
  3 tolerates 1, 5 tolerates 2).

**Where you've used it:** etcd, Consul (Raft); ZooKeeper (ZAB, Raft-like); Spanner (Paxos);
Kafka's KRaft controller.

> **FLP impossibility:** in a fully asynchronous network, no consensus protocol can guarantee
> termination if even one node may fail. Real systems sidestep this with **timeouts / partial
> synchrony** — i.e. they trade guaranteed liveness for "makes progress when the network is
> well-behaved." Naming FLP signals depth.

---

## 9. Failure Detection

You can't *know* a node is dead; you **suspect** it. **Heartbeats** + timeouts are the basic tool,
but a fixed timeout is wrong: too short → false positives (healthy node declared dead → needless
failover, split-brain risk); too long → slow detection.

**Phi-accrual failure detectors** (Cassandra, Akka) output a *suspicion level* based on the recent
distribution of heartbeat arrival times, instead of a hard yes/no — letting callers choose their own
threshold.

> **Senior answer:** "Failure detection is **probabilistic**. I tune timeouts to the network's real
> latency distribution, and I make failover **safe under false positives** with fencing tokens — so a
> wrongly-suspected node can't corrupt state when it comes back."

---

## 10. Delivery Semantics & Idempotency

What a messaging/RPC system promises about duplicates and loss:

- **At-most-once:** may lose messages, never duplicates (fire-and-forget). Rarely acceptable.
- **At-least-once:** never loses, **may duplicate** (retries after an ambiguous timeout). The common
  real-world default.
- **Exactly-once:** the holy grail — and **"exactly-once *delivery*" is essentially impossible** over
  an unreliable network. What systems actually provide is **exactly-once *processing*** =
  at-least-once delivery **+ idempotent consumers / dedup**.

**Idempotency** = applying an operation twice has the same effect as once. The practical fix for
at-least-once. Techniques: **idempotency keys** (client sends a unique ID; server dedups), natural
idempotency (`SET x = 5` vs `x += 5`), or an **inbox/dedup table**.

> **Trap:** Claiming a system is "exactly-once" without qualification. The senior version:
> "at-least-once delivery plus idempotent processing — Kafka's exactly-once is transactions +
> idempotent producers *within Kafka*, not magic across external side effects."

---

## 11. Distributed Transactions

You want atomicity across services/shards, but there's no shared lock manager.

- **2PC (Two-Phase Commit):** a coordinator asks all participants to *prepare*, then *commit* if all
  vote yes. **Problems:** it's a **blocking** protocol — if the coordinator dies after prepare,
  participants hold locks indefinitely; poor availability; doesn't scale. Used inside some databases,
  rarely across microservices.
- **Saga:** model a transaction as a sequence of **local** transactions, each with a **compensating
  action** to undo it. Coordinated by **choreography** (events) or an **orchestrator**. Trades
  atomicity/isolation for availability — you get **eventual consistency** and must handle
  intermediate states. (See the Microservices handbook for depth.)

> **Senior answer:** "Across service/shard boundaries I avoid 2PC because it's blocking and
> availability-hostile. I use **Sagas with compensations** and design the business flow to tolerate
> intermediate, eventually-consistent states."

---

## 12. Partitioning & Consistent Hashing

To scale beyond one node, **partition (shard)** data by key.

- **Range partitioning:** keys in ranges → efficient range scans, but **hot spots** if keys are
  skewed (e.g. timestamps).
- **Hash partitioning:** hash the key → even spread, but loses range-scan locality.

**Consistent hashing** solves the *re-sharding* problem: naive `hash(key) % N` remaps almost
everything when N changes. Consistent hashing maps nodes and keys onto a ring so adding/removing a
node only moves `~1/N` of keys. **Virtual nodes** smooth out imbalance and heterogeneous hardware.
Used by Dynamo, Cassandra, and many caches.

> **Trap:** A celebrity/hot key still overwhelms one partition even with consistent hashing — handle
> with key splitting, replication of the hot key, or request coalescing.

---

## 13. CRDTs — Conflict-Free Replicated Data Types

Data structures designed so that **concurrent updates on different replicas merge automatically**
without coordination — the merge is commutative, associative, and idempotent, so replicas
**converge** to the same state regardless of order. This is **Strong Eventual Consistency**.

- Examples: **G-Counter / PN-Counter** (counters), **OR-Set** (add/remove sets), **LWW-Register**,
  sequence CRDTs for collaborative text (the tech behind Google-Docs-style editing, Redis CRDTs,
  Riak, automerge/Yjs).
- Tradeoff: not every problem maps to a CRDT, and metadata can grow; but where they fit, you get
  multi-leader writes with **no conflicts to resolve manually**.

> **Senior answer:** "When I need offline/multi-region writes with automatic merge — counters,
> presence, collaborative editing — I reach for CRDTs instead of last-write-wins, which silently
> drops data."

---

## 14. Classic Failure Modes (Name These)

- **Split-brain:** a partition makes two nodes both think they're leader → divergent writes. Prevent
  with **majority quorum** (a minority can't elect a leader) and **fencing tokens**.
- **Fencing tokens:** a monotonically increasing number handed out with a lock; downstream storage
  **rejects** any write carrying an older token → a paused-then-resumed old leader can't clobber
  newer state. The canonical fix for "the lock holder GC-paused."
- **Thundering herd / cache stampede:** a popular key expires and thousands of requests hit the DB at
  once → use request coalescing, jittered TTLs, or `stale-while-revalidate`.
- **Retry storms / metastable failures:** retries amplify load during a hiccup and keep the system
  down even after the trigger passes → backoff **with jitter**, circuit breakers, load shedding.
- **Clock skew bugs:** ordering or expiring by wall clock across machines → use logical clocks /
  server-assigned versions.
- **Gray failure:** a node is "up" (passes health checks) but degraded (slow disk) → detect with
  end-to-end SLO-based health, not just liveness pings.

---

## 15. Interview Q&A Bank

**Q: State the CAP theorem precisely.**
> When a network partition occurs, a system must choose between consistency (linearizable reads) and
> availability (every request gets a non-error response). It's a per-partition, often per-operation
> choice — not "pick 2 of 3" permanently. "CA" isn't a real option because partitions are inevitable.

**Q: Why is PACELC better than CAP?**
> CAP only addresses partitions. PACELC adds the everyday case: even with no partition (Else), you
> trade Latency vs Consistency, because synchronous coordination costs latency on every request.

**Q: Difference between linearizability and eventual consistency?**
> Linearizability: the system behaves like a single copy; a read always sees the latest committed
> write (needs coordination). Eventual: replicas converge if writes stop, but reads can see stale or
> out-of-order data meanwhile.

**Q: Why can't you use wall-clock timestamps to order events across machines?**
> Clocks drift and jump; skew means "latest timestamp" can pick the wrong write, silently losing
> data. Use logical clocks (Lamport/vector) or server-assigned versions.

**Q: Lamport vs vector clocks?**
> Lamport gives a total order consistent with causality but can't detect concurrency. Vector clocks
> can distinguish happened-before from concurrent (true conflicts), at the cost of size O(nodes).

**Q: What does R + W > N give you?**
> Read and write quorums overlap by at least one replica, so a read sees the latest write (with
> versioning). N=3, W=2, R=2 tolerates one node down while staying consistent. It's strong-ish, not
> automatically linearizable.

**Q: What problem does consensus solve, and name a protocol?**
> Getting nodes to agree on one value / an ordered log despite failures — the basis of leader
> election, locks, replicated state machines. Raft (understandable) or Paxos; both need a majority
> quorum, so use odd cluster sizes.

**Q: What is FLP impossibility?**
> In a fully asynchronous network, no consensus algorithm can guarantee termination if one node may
> fail. Real systems use timeouts/partial synchrony to make progress when the network behaves.

**Q: Is exactly-once delivery possible?**
> Not over an unreliable network. You get exactly-once *processing* = at-least-once delivery +
> idempotent consumers (idempotency keys / dedup). Kafka's "exactly-once" is transactions +
> idempotent producers within Kafka.

**Q: Why avoid 2PC across microservices?**
> It's blocking: a coordinator crash after prepare leaves participants holding locks, hurting
> availability and scale. Use Sagas with compensating transactions and accept eventual consistency.

**Q: What is consistent hashing and why use it?**
> Map nodes and keys onto a ring so adding/removing a node moves only ~1/N of keys (vs `% N`
> remapping almost everything). Virtual nodes balance load. Used by Dynamo/Cassandra/caches.

**Q: How do you prevent split-brain?**
> Require a majority quorum to elect a leader (a minority can't), and use fencing tokens so a
> resurrected old leader's stale writes are rejected by downstream storage.

**Q: What's a fencing token?**
> A monotonically increasing number issued with a lock; storage rejects writes with an older token —
> protecting against a lock holder that paused (GC/network) and resumed after losing the lock.

**Q: When would you use a CRDT?**
> When you need conflict-free concurrent writes across replicas/offline — counters, sets, presence,
> collaborative text — and want automatic convergence instead of lossy last-write-wins.

**Q: How do you make an unreliable remote call safe?**
> Timeout (a timeout is ambiguous), retry with backoff+jitter, make the operation idempotent (so
> retries don't double-apply), circuit-break to avoid retry storms, and have a fallback/degraded mode.

---

## 16. Cheat Sheet

- **A timeout is ambiguous** — can't tell dead from slow. Design for partial failure first.
- **CAP:** on a partition, choose C or A (per-operation). **"CA" isn't real.** Use **PACELC**:
  Else, Latency vs Consistency.
- **Consistency spectrum:** linearizable → sequential → **causal** → read-your-writes/monotonic →
  eventual. Default to **causal + session guarantees**; reserve strong for money/uniqueness/locks.
- **No global clock.** Lamport = order, can't detect concurrency; **vector clocks** detect
  concurrency; HLC/TrueTime track real time safely. Never order by wall clock.
- **Replication:** single-leader (simple, lag), multi-leader (conflicts), leaderless (quorums).
  Sync = durable+slow, async = fast+can-lose-writes, **semi-sync** = balance.
- **Quorum:** `R + W > N` → overlap → consistent reads. N=3,W=2,R=2 common. Read repair, hinted
  handoff, Merkle anti-entropy.
- **Consensus** = agree on a value/log. **Raft** (election + log replication + majority). Odd sizes:
  3→tolerate 1, 5→tolerate 2. **FLP**: no guaranteed termination if async + failures.
- **Delivery:** at-most / **at-least** (default) / exactly-once *processing* via **idempotency**.
- **Distributed txns:** avoid **2PC** (blocking) across services → **Saga** + compensations.
- **Partition** by hash/range; **consistent hashing** + vnodes for cheap re-sharding; beware hot keys.
- **CRDTs** = automatic conflict-free merge (counters/sets/text) → strong eventual consistency.
- **Failure modes:** split-brain (quorum + **fencing tokens**), thundering herd (jitter/coalesce),
  retry storms (backoff+jitter, circuit breaker), clock skew, gray failure.

---

*End of handbook. The staff signal: reason from first principles — **the network is unreliable and
there is no global clock** — then reach for the right tool (quorums, consensus, idempotency, CRDTs,
fencing) and state the **tradeoff** out loud. Precision about CAP, exactly-once, and consistency
models is what separates staff from senior.*
