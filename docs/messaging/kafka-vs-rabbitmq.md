# RabbitMQ & Kafka — Interview Handbook

> A complete, easy-to-understand guide to the two giants of messaging: **RabbitMQ** (the smart broker /
> message queue) and **Apache Kafka** (the distributed event-streaming log). How each really works, when
> to use which, delivery guarantees, ordering, scaling, the tricky failure modes — and a deep Q&A bank.
>

---

## 1. Why Messaging Exists (the problem)

Without messaging, services call each other **synchronously** — Service A waits for Service B. If B is
slow or down, A breaks too, and traffic spikes overwhelm everyone.

**A message broker sits in the middle** and lets services communicate **asynchronously** by passing
messages. The producer drops a message and moves on; the consumer processes it whenever it's ready.

**What you gain:**
- **Decoupling** — producer and consumer don't need to know about or be up at the same time.
- **Buffering / load leveling** — absorb spikes; consumers drain at their own pace.
- **Resilience** — if a consumer dies, messages wait safely and are retried.
- **Scalability** — add more consumers to process faster.

> **Senior framing:** "A broker turns a brittle synchronous call chain into a resilient async
> pipeline — it decouples services in time, absorbs spikes, and lets each side scale and fail
> independently."

---

## 2. The Two Mental Models: Queue vs Log

The single most important thing to understand — RabbitMQ and Kafka are **fundamentally different**:

```
RabbitMQ — a QUEUE (smart broker, dumb consumer)
  Producer ─▶ [Exchange] ─▶ [ Queue: ▢▢▢▢ ] ─▶ Consumer
                                  message is DELETED once acknowledged
                                  broker pushes & tracks state

Kafka — a LOG (dumb broker, smart consumer)
  Producer ─▶ [ Topic partition:  0 1 2 3 4 5 6 7 8 ... ] (append-only, immutable)
                                   ▲           ▲
                              Consumer A    Consumer B
                              (offset 3)    (offset 7)   ← each tracks its own position
                              messages STAY for the retention period; many readers replay
```

| | **RabbitMQ (queue)** | **Kafka (log)** |
|---|---|---|
| Model | Message broker / queue | Distributed commit log / event stream |
| After consume | Message **removed** (acked) | Message **retained** (offset advances) |
| Re-read history | No (it's gone) | **Yes** — replay by resetting offset |
| Smarts | **Smart broker** (routing, retries) | **Smart consumer** (tracks its offset) |
| Many consumers of same msg | Via fanout/bindings | Native — each group reads independently |
| Throughput | High (10s–100k/s) | **Very high** (millions/s) |

> **The line interviewers want:** "RabbitMQ is a **smart broker with dumb consumers** — it pushes
> messages and deletes them on ack. Kafka is a **dumb broker with smart consumers** — it's an
> append-only log that retains messages, and each consumer tracks its own offset and can replay."

---

## 3. Core Messaging Concepts & Vocabulary

- **Producer / Publisher** — sends messages.
- **Consumer / Subscriber** — receives messages.
- **Broker** — the server that stores/routes messages.
- **Message** — payload + metadata (headers, key, timestamp).
- **Queue (RabbitMQ)** — buffer holding messages until consumed.
- **Topic** — a named category/stream of messages (central in Kafka; also a routing concept in Rabbit).
- **Acknowledgment (ack)** — consumer confirms it processed a message.
- **Offset (Kafka)** — a message's position in a partition.
- **Consumer group** — a set of consumers sharing the work of a topic.
- **Dead Letter Queue (DLQ)** — where un-processable messages go after failures.
- **Throughput** vs **Latency** — volume per second vs time per message.

---

## 4. RabbitMQ — Architecture & Exchanges

RabbitMQ implements **AMQP**. The key insight: producers **don't publish to queues directly** — they
publish to an **exchange**, which routes the message to queues based on rules (**bindings** +
**routing keys**).

```
Producer ─▶ [ EXCHANGE ] ──(binding rules)──▶ [ Queue 1 ] ─▶ Consumer
                         └────────────────────▶ [ Queue 2 ] ─▶ Consumer
```

### The four exchange types (must-know)
| Exchange | Routing logic | Use |
|---|---|---|
| **Direct** | Routing key **exactly equals** binding key | Point-to-point, route by exact label |
| **Fanout** | **Broadcast** to all bound queues (ignores key) | Pub/sub, notify everyone |
| **Topic** | Pattern match on routing key with `*` (one word) and `#` (zero+ words) | Flexible routing (`order.*.created`) |
| **Headers** | Match on message **headers** instead of routing key | Complex attribute-based routing |

```
# Topic exchange example
routing key:  "order.eu.created"
binding "order.#"        → matches (all order events)
binding "order.*.created"→ matches (any region, created)
binding "order.us.*"     → does NOT match
```

> "In RabbitMQ the **exchange** decides routing, not the producer. Direct = exact key, Fanout =
> broadcast, Topic = wildcard patterns, Headers = attribute matching. This routing intelligence is
> RabbitMQ's superpower over a plain queue."

- **Default exchange:** a nameless direct exchange where the routing key = queue name (so it *looks*
  like you publish straight to a queue).
- **Binding:** the link between an exchange and a queue (with a routing key/pattern).

---

## 5. RabbitMQ — Reliability (acks, durability, DLQ)

To not lose messages, you need reliability at **every** hop:

1. **Publisher confirms** — broker tells the producer "I got it" (so the producer can retry on
   failure). Without confirms, a publish can silently vanish.
2. **Durable queues + persistent messages** — both must be set so messages survive a broker restart
   (a durable queue with non-persistent messages still loses data).
3. **Consumer acknowledgments** — consumer sends `ack` only **after** successfully processing. If it
   dies first, RabbitMQ **redelivers** to another consumer.
   - **Manual ack** (recommended) vs **auto-ack** (acks on delivery → message lost if the consumer
     crashes mid-processing).
   - **`nack` / `reject`** with `requeue=true/false` to retry or dead-letter.
4. **Prefetch (QoS)** — `basic.qos(prefetch=N)` limits unacked messages per consumer → fair dispatch,
   prevents one consumer hogging the queue.
5. **Dead Letter Exchange (DLX)** — messages that are rejected, expired (TTL), or exceed length go to
   a DLX → a **dead-letter queue** for inspection/retry.

> **"How do you guarantee a message isn't lost in RabbitMQ?"** Publisher confirms + durable queue +
> persistent messages + manual consumer acks + a DLQ for failures. Miss any link and you can lose
> messages.

> **Poison message trap:** a message that always fails will be **requeued forever** if you `nack`
> with `requeue=true`, blocking the queue. Use a **retry count + DLQ** (or delayed-retry) instead.

---

## 6. RabbitMQ — Advanced Features

- **TTL** — message or queue time-to-live; expired messages can dead-letter.
- **Priority queues** — higher-priority messages jump ahead.
- **Delayed messages** — via the delayed-message plugin (schedule future delivery).
- **Quorum queues** — the modern **replicated, durable** queue type (Raft-based) replacing classic
  mirrored queues for HA. Use these for reliability.
- **Lazy queues** — keep messages on disk to handle very long backlogs without eating RAM.
- **Clustering & HA** — multiple nodes; quorum queues replicate across them.
- **Shovel / Federation** — move messages between brokers/data centers.
- **Streams** (RabbitMQ 3.9+) — an append-only, replayable log type (Kafka-like) inside RabbitMQ.

> "For HA in modern RabbitMQ, use **quorum queues** (Raft-replicated) — classic mirrored queues are
> deprecated."

---

## 7. Kafka — Architecture (topics, partitions, offsets)

Kafka is a **distributed, partitioned, replicated commit log.** Master these three terms:

- **Topic** — a named stream of events (like a table/feed). Split into partitions.
- **Partition** — an **ordered, immutable, append-only** sequence of messages. **The unit of
  parallelism and ordering.** A topic with 6 partitions can be processed by up to 6 consumers in
  parallel.
- **Offset** — the position (a number) of a message within a partition. Consumers track offsets.

```
Topic "orders" (3 partitions)
 P0:  [0][1][2][3][4][5] →  append here
 P1:  [0][1][2][3]       →
 P2:  [0][1][2][3][4]    →
 Each partition: ordered & immutable. Order is guaranteed WITHIN a partition, not across.
```

### The cluster
- **Broker** — a Kafka server; a cluster has many. Partitions are spread across brokers.
- **Partition leader/followers** — each partition has one **leader** (handles reads/writes) and
  **follower replicas** (copies for fault tolerance).
- **Coordination:** historically **ZooKeeper**; modern Kafka uses **KRaft** (built-in Raft, no
  ZooKeeper).

> **"How does Kafka scale?"** By **partitioning** topics across brokers and consumers. More
> partitions = more parallelism. A consumer group processes partitions in parallel (one partition per
> consumer at a time).

### How a producer picks a partition
- **With a key:** `hash(key) % partitions` → all messages with the same key go to the **same
  partition** (→ ordered together). E.g., key = `userId` keeps a user's events ordered.
- **Without a key:** round-robin / sticky across partitions (max spread, no per-key order).

> **Trap:** ordering is only guaranteed **within a partition**. If you need per-entity ordering,
> **key by that entity** so its events land in one partition.

---

## 8. Kafka — Producers (keys, acks, idempotence)

**`acks` — the durability knob (memorize):**
| `acks` | Meaning | Trade-off |
|---|---|---|
| `0` | Fire-and-forget (no ack) | Fastest, can lose data |
| `1` | Leader acknowledges | Balanced; lost if leader dies before replication |
| `all` (`-1`) | Leader + all in-sync replicas ack | Safest, slower |

- **`enable.idempotence=true`** — the producer dedupes retries so the same message isn't written
  twice (gives **exactly-once** *to a partition*). Default true in recent versions; pairs with
  `acks=all`.
- **Batching & compression** (`linger.ms`, `batch.size`, `compression.type`) — huge throughput lever:
  wait a few ms to batch messages together.
- **`min.insync.replicas`** — broker-side: with `acks=all`, how many replicas must confirm (set to 2
  with replication factor 3 for safety).

> "For durability I use `acks=all` + `min.insync.replicas=2` + `enable.idempotence=true`. For raw
> throughput I tune `linger.ms`/`batch.size` and compression — Kafka loves big batches."

---

## 9. Kafka — Consumers & Consumer Groups

**Consumer group** = the core scaling concept. Consumers in the same group **share** the partitions of
a topic; each partition is consumed by **exactly one** consumer in the group.

```
Topic with 4 partitions, Consumer Group "billing" with 2 consumers:
  C1 ← P0, P1
  C2 ← P2, P3        (work is split → parallelism)

Different group "analytics" reads the SAME messages independently (own offsets).
```

Rules:
- **One partition → at most one consumer per group** (so messages aren't double-processed in a group).
- **More consumers than partitions → idle consumers** (partitions cap parallelism).
- **Different groups** each get a full, independent copy of the stream (pub/sub).

### Rebalancing
When consumers join/leave, Kafka **rebalances** partitions among them. During a rebalance, processing
pauses ("stop-the-world"); frequent rebalances hurt. Newer **cooperative/incremental rebalancing** and
**static membership** reduce the pain.

### Offset management
- Consumers **commit offsets** to mark progress. Committed offset = where you'd resume after a restart.
- **Auto-commit** (`enable.auto.commit`, every N ms) — convenient but can cause message **loss**
  (commit before processing) or **duplicates** (process, crash before commit).
- **Manual commit after processing** → at-least-once (the common safe choice).
- **Where to start:** `auto.offset.reset = earliest` (replay from start) or `latest` (only new).

> **"At-least-once vs at-most-once in Kafka comes down to *when you commit the offset*."** Commit
> **after** processing → at-least-once (possible duplicates). Commit **before** → at-most-once
> (possible loss).

---

## 10. Kafka — Storage, Retention & Log Compaction

Kafka **persists everything to disk** and keeps messages even after they're read — that's what makes
replay possible.

- **Retention by time** (`retention.ms`, e.g., 7 days) or **by size** (`retention.bytes`). After that,
  old segments are deleted.
- **Log compaction** — an alternative to deletion: keep only the **latest value per key**
  (`cleanup.policy=compact`). Great for "current state" topics (e.g., latest profile per user) and for
  rebuilding state. The log becomes a changelog/snapshot.

> "Time/size retention is a rolling window; **compaction** keeps the newest record per key forever —
> turning a topic into a durable key-value changelog you can replay to rebuild state."

> **Trap:** Kafka is fast on disk because of **sequential writes + OS page cache + zero-copy**, not
> because it keeps everything in RAM. Replay reads come largely from page cache.

---

## 11. Kafka — Replication & Durability (ISR, leaders)

- **Replication factor** — number of copies of each partition across brokers (e.g., 3). Survives
  broker failures.
- **Leader & followers** — writes/reads go to the leader; followers replicate.
- **ISR (In-Sync Replicas)** — the set of replicas fully caught up with the leader. With `acks=all`,
  a write is acknowledged once all ISR have it.
- **Failover:** if a leader dies, a new leader is elected from the ISR.
- **`min.insync.replicas`** — minimum ISR required to accept a write; if too few replicas are in sync,
  the partition rejects writes (favoring **consistency over availability**).

> **"How does Kafka stay durable?"** Replication factor ≥ 3, `acks=all`, `min.insync.replicas=2`,
> and leader election from the ISR. You trade a little latency/availability for not losing data.

> **`unclean.leader.election`** — if enabled, an out-of-sync replica can become leader → **data
> loss** but higher availability. Keep it **off** for durability.

---

## 12. Delivery Guarantees: At-Most / At-Least / Exactly-Once

The universal messaging question. Three semantics:

| Guarantee | Meaning | How |
|---|---|---|
| **At-most-once** | May lose, never duplicate | Ack/commit **before** processing; fire-and-forget |
| **At-least-once** | Never lose, may duplicate | Ack/commit **after** processing + retries → **make consumers idempotent** |
| **Exactly-once** | No loss, no duplicate | Hard; special support |

- **RabbitMQ:** practically **at-least-once** (manual acks + redelivery). "Exactly-once" is achieved by
  **idempotent consumers** (dedup), not by the broker.
- **Kafka:** supports **exactly-once semantics (EOS)** *within Kafka* via **idempotent producers +
  transactions** (`transactional.id`, `read_committed`) — e.g., consume→process→produce atomically in
  Kafka Streams. But end-to-end exactly-once **to an external system** still needs idempotency.

> "Exactly-once is mostly a myth across system boundaries. The pragmatic answer is **at-least-once +
> idempotent consumers**. Kafka offers true exactly-once *within Kafka* (transactions), but writing to
> an external DB still needs idempotency or the transactional outbox/inbox pattern."

---

## 13. Ordering Guarantees (the tricky one)

- **RabbitMQ:** a single queue with a single consumer preserves order. But **multiple consumers** (or
  requeues/retries) **break ordering**. Prefetch>1 and redeliveries can reorder too.
- **Kafka:** order is guaranteed **only within a partition**, never across partitions. To keep an
  entity's events ordered, **key by that entity** so they share a partition.

> **"How do you guarantee ordered processing per user in Kafka?"** Use the `userId` as the message
> **key** → all that user's events go to one partition → processed in order by one consumer. You can't
> get global ordering across partitions without sacrificing parallelism.

> **Kafka reorder trap:** a producer with retries and `max.in.flight.requests > 1` can reorder on
> retry — set `enable.idempotence=true` (which safely allows in-flight >1 while preserving order) or
> cap in-flight to 1.

---

## 14. Idempotency & Deduplication

Because at-least-once means **duplicates happen**, consumers must be **idempotent** — processing the
same message twice has the same effect as once.

**How:**
- **Idempotency key / dedup table:** store processed message IDs; skip if already seen.
- **Upserts** instead of inserts (`ON CONFLICT DO NOTHING/UPDATE`).
- **Natural idempotency:** "set status = shipped" is naturally idempotent; "increment balance" is not.
- **Kafka:** idempotent producer prevents *producer-side* dupes; consumer-side still needs your dedup.

> "I design every consumer to be idempotent — dedup by message ID or use upserts — because retries
> and rebalances guarantee I'll see duplicates eventually."

---

## 15. Backpressure, Lag & Flow Control

**The problem:** producers outpace consumers. The broker fills up.

- **RabbitMQ:** **prefetch (QoS)** limits unacked messages per consumer; if queues grow unbounded the
  broker applies **flow control** (throttles publishers) and can hit memory/disk alarms. Use **lazy
  queues** for huge backlogs.
- **Kafka:** consumers **pull** at their own pace (natural backpressure), but you watch **consumer
  lag** = (latest offset − committed offset). Growing lag = consumers falling behind → add consumers
  (up to partition count) or partitions.

> **"How do you handle a consumer that can't keep up?"** Kafka: scale consumers up to the partition
> count, add partitions, optimize processing, watch lag. RabbitMQ: add consumers, tune prefetch, use
> lazy queues, shed/route overflow to another queue.

---

## 16. RabbitMQ vs Kafka — Head to Head

| Dimension | **RabbitMQ** | **Kafka** |
|---|---|---|
| Paradigm | Message broker / **queue** | Event streaming / **log** |
| Message lifetime | Deleted after ack | Retained (replayable) |
| Routing | **Rich** (exchanges: direct/topic/fanout/headers) | Simple (topic + partition by key) |
| Ordering | Per-queue (breaks with multi-consumer) | Per-partition |
| Throughput | High | **Very high** (millions/s) |
| Latency | Very low | Low (slightly higher) |
| Consumers re-reading | No | **Yes** (offsets) |
| Replay / history | No | **Yes** |
| Push vs pull | **Push** to consumers | **Pull** by consumers |
| Best for | Task/work queues, RPC, complex routing, low-latency commands | Event streaming, analytics, log aggregation, event sourcing, high volume |

> **The senior decision line:** "Use **RabbitMQ** when you need **smart routing and per-message task
> processing** (commands, RPC, work queues) and messages are done once handled. Use **Kafka** when you
> need **high-throughput event streaming, replay, multiple independent consumers, and durable history**
> (event sourcing, analytics, pipelines). It's *commands/tasks* vs *events/streams*."

> **"Can Kafka replace RabbitMQ?"** Often, but not always — RabbitMQ's flexible routing, per-message
> TTL/priority, and simple work-queue semantics are nicer for task distribution and RPC. Kafka shines
> when you need scale, retention, and replay. Many architectures use **both**.

---

## 17. Common Patterns

- **Work queue (competing consumers)** — distribute tasks across workers (RabbitMQ classic; Kafka via
  a consumer group).
- **Publish/Subscribe** — broadcast to many (RabbitMQ fanout/topic; Kafka multiple consumer groups).
- **Request/Reply (RPC)** — RabbitMQ with a `reply_to` queue + correlation ID.
- **Event-Driven / Event Sourcing** — store state changes as an immutable event log (Kafka's
  sweet spot); rebuild state by replay.
- **Transactional Outbox** — write the business row **and** an event row in **one DB transaction**,
  then a relay publishes the event to the broker → avoids the dual-write problem (DB committed but
  message lost, or vice-versa).
- **Saga** — coordinate a distributed transaction across services via events + compensating actions.
- **CDC (Change Data Capture)** — stream DB changes into Kafka (Debezium) to feed search/analytics.

> **Dual-write problem:** never write to the DB **and** publish to the broker as two separate steps
> — one can succeed and the other fail. Use the **outbox pattern** (or CDC) to make it atomic.

---

## 18. Real-World Challenges & How to Solve Them

**1. Poison messages.** → A message that always fails blocks the queue. Add a **retry count + DLQ**;
inspect/replay from the DLQ. (Don't infinite-requeue.)

**2. Duplicate processing.** → At-least-once guarantees dupes. **Idempotent consumers** (dedup table /
upserts).

**3. Out-of-order processing.** → Kafka: key by entity; limit in-flight or enable idempotence.
RabbitMQ: single consumer per ordered stream or partition by a consistent hash.

**4. Consumer lag / can't keep up.** → Add consumers (≤ partitions), add partitions, batch, optimize;
monitor lag.

**5. Rebalance storms (Kafka).** → Tune `session.timeout.ms`/`max.poll.interval.ms`, use cooperative
rebalancing + static membership; keep processing per poll fast.

**6. Lost messages.** → RabbitMQ: confirms + durable + persistent + manual acks. Kafka: `acks=all` +
`min.insync.replicas=2` + replication ≥ 3 + commit after processing.

**7. Large backlog / memory pressure.** → RabbitMQ lazy/quorum queues; Kafka scales naturally on disk
(just watch retention/disk).

**8. Schema evolution.** → Producers and consumers disagree on message shape. Use a **Schema Registry
(Avro/Protobuf)** with compatibility rules.

**9. Hot partition (Kafka).** → A skewed key sends most traffic to one partition. Pick a
higher-cardinality key or add a salt.

**10. Exactly-once to a database.** → Use the **outbox/inbox** pattern or Kafka transactions + idempotent
writes; pure broker exactly-once isn't enough across boundaries.

---

## 19. Operations & Monitoring

- **RabbitMQ:** management UI/API, watch **queue depth**, **unacked count**, **consumer count**,
  memory/disk alarms, message rates. Alert on growing queues.
- **Kafka:** monitor **consumer lag** (the #1 metric), under-replicated partitions, ISR shrink, broker
  disk, request latency. Tools: Kafka exporter + Prometheus/Grafana, Burrow, Cruise Control,
  Conduktor/AKHQ.
- **Capacity:** partition count (hard to reduce later — plan ahead), replication factor, retention,
  disk headroom.

> **You can increase Kafka partitions but not easily decrease them**, and increasing them **breaks
> key→partition ordering** for existing keys. Plan partition counts up front.

---

## 20. The Ecosystem (Kafka Connect, Streams, Schema Registry)

- **Kafka Connect** — no-code connectors to move data in/out of Kafka (DBs, S3, Elasticsearch).
  **Source** (in) and **Sink** (out) connectors; Debezium for CDC.
- **Kafka Streams / ksqlDB** — stream-processing libraries to transform/join/aggregate topics in real
  time (with exactly-once and stateful operations).
- **Schema Registry** — stores Avro/Protobuf/JSON schemas + enforces **compatibility** so producers and
  consumers evolve safely.
- **MirrorMaker** — replicate topics across clusters/regions (DR, geo).
- **RabbitMQ ecosystem:** plugins (delayed messages, MQTT/STOMP), Shovel/Federation, management plugin.

---

## 21. Interview Q&A Bank

**Q: RabbitMQ vs Kafka — when to use which?**
> RabbitMQ = smart-routing message queue for tasks/commands/RPC; messages are deleted after handling.
> Kafka = high-throughput, retained event log for streaming, replay, multiple consumers, and event
> sourcing. Tasks vs event streams.

**Q: Why is Kafka so fast / how does it scale?**
> Partitioned topics across brokers + sequential disk writes + OS page cache + zero-copy + batching.
> Scale by adding partitions and consumers (one partition per consumer in a group).

**Q: What is a partition and why does it matter?**
> An ordered, immutable, append-only log that's the unit of parallelism and ordering. Order is
> guaranteed within a partition only; key by entity to keep its events ordered.

**Q: Explain consumer groups.**
> Consumers in a group share a topic's partitions (one partition per consumer at a time) for
> parallelism. Different groups each read the full stream independently with their own offsets.

**Q: What's an offset and how is it managed?**
> A message's position in a partition. Consumers commit offsets to track progress. Commit after
> processing = at-least-once; auto-commit risks loss or duplicates.

**Q: At-most vs at-least vs exactly-once?**
> At-most (commit before processing, may lose), at-least (commit after, may duplicate → need
> idempotency), exactly-once (hard; Kafka offers it within Kafka via idempotent producer + transactions,
> but external systems still need idempotency).

**Q: How do you guarantee no message loss?**
> RabbitMQ: publisher confirms + durable queues + persistent messages + manual acks + DLQ. Kafka:
> acks=all + min.insync.replicas=2 + replication ≥3 + commit after processing.

**Q: How does RabbitMQ routing work?**
> Producers publish to an exchange (direct/topic/fanout/headers); bindings + routing keys route to
> queues. The exchange, not the producer, decides routing.

**Q: What's a DLQ and when is it used?**
> A dead-letter queue receives messages that are rejected, expired, or exceed retry limits, so they
> don't block the main queue and can be inspected/replayed.

**Q: How do you keep ordering?**
> Kafka: key by entity → same partition. RabbitMQ: single consumer per ordered stream; multiple
> consumers/requeues break order.

**Q: How do you make consumers idempotent?**
> Dedup by message ID/idempotency key, use upserts, or design naturally idempotent operations — because
> at-least-once guarantees duplicates.

**Q: What is consumer lag and why monitor it?**
> Lag = latest offset − committed offset; it shows how far behind consumers are. Growing lag means you
> need more consumers/partitions or faster processing.

**Q: What is log compaction?**
> A retention mode keeping only the latest record per key, turning a topic into a durable key-value
> changelog you can replay to rebuild state.

**Q: What is the outbox pattern and why?**
> Write the business change and an event to the DB in one transaction; a relay publishes the event to
> the broker. Solves the dual-write problem (DB and broker can't be updated atomically otherwise).

**Q: ISR and acks=all?**
> ISR = replicas fully caught up to the leader. acks=all acknowledges only when all in-sync replicas
> have the message; with min.insync.replicas=2 you avoid data loss on a single broker failure.

**Q: ZooKeeper vs KRaft?**
> Older Kafka used ZooKeeper for metadata/coordination; modern Kafka uses KRaft (built-in Raft),
> removing the ZooKeeper dependency and simplifying ops.

**Q: Quorum queues vs mirrored queues (RabbitMQ)?**
> Quorum queues are the modern Raft-replicated, durable HA queue type; classic mirrored queues are
> deprecated. Use quorum queues for reliability.

---

## 22. Cheat Sheet

- **RabbitMQ = smart broker + dumb consumer (queue, delete on ack).** **Kafka = dumb broker + smart
  consumer (log, retain + replay).**
- **RabbitMQ routing:** exchanges → direct (exact), fanout (broadcast), topic (wildcards), headers.
- **Reliability (Rabbit):** publisher confirms + durable + persistent + manual ack + DLQ; quorum queues
  for HA; prefetch for fair dispatch.
- **Kafka core:** topic → partitions (order + parallelism) → offsets. Key by entity for ordering.
- **Kafka durability:** `acks=all` + `min.insync.replicas=2` + replication ≥3 + commit after processing.
- **Producer:** `enable.idempotence=true`, batch with `linger.ms`/`batch.size` + compression.
- **Consumer groups:** one partition per consumer; more consumers than partitions = idle; other groups
  replay independently.
- **Guarantees:** at-least-once + **idempotent consumers** is the practical default; exactly-once only
  within Kafka (transactions).
- **Ordering:** only within a partition/single queue.
- **Retention:** time/size, or **compaction** (latest per key).
- **Lag** is Kafka's key health metric; **queue depth/unacked** for RabbitMQ.
- **Patterns:** work queue, pub/sub, event sourcing, **transactional outbox** (avoid dual-write), saga,
  CDC.
- **Ecosystem:** Kafka Connect, Streams/ksqlDB, Schema Registry, KRaft (no ZooKeeper).
- **Plan partitions up front** — hard to reduce, and changing count breaks key ordering.

---

*End of handbook. Remember the one-liner — **RabbitMQ routes & deletes (queue); Kafka retains & replays
(log)** — and reason about delivery guarantees, ordering, and idempotency from there. 🐰🦫*
