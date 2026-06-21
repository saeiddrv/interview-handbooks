---
title: "Async & Reactive Programming — Interview Handbook"
description: "Async programming: the event loop, backpressure, Reactor, Spring WebFlux, virtual threads vs reactive, coroutines, and the C10k problem — with a Q&A bank."
sidebar:
  label: "Async & Reactive Programming"
---

> The asynchronous paradigm, made clear and deep: the words people conflate (**sync vs async, blocking
> vs non-blocking, concurrency vs parallelism**), *why* async exists (the **C10k problem** and the
> **event loop**), the evolution from **callbacks → Futures → Reactive Streams → coroutines / virtual
> threads**, **backpressure**, **Reactor (Mono/Flux)**, **Spring MVC vs WebFlux**, and the modern
> **"do virtual threads kill reactive?"** debate — with the traps and a Q&A bank. (Pairs with the
> Concurrency, Spring Boot, and Ktor handbooks.)

---

## 1. The Vocabulary (get these straight first)

Interviewers test whether you conflate four distinct ideas:

- **Synchronous** — the caller **waits** for the result before continuing.
- **Asynchronous** — the caller **starts** the work and continues; the result arrives later (callback,
  Future, suspension).
- **Blocking** — the **thread** is parked and unusable while waiting (e.g. classic `InputStream.read()`).
- **Non-blocking** — the call **returns immediately**; the thread is free to do other work; you're
  notified when data is ready.
- **Concurrency** — *dealing with* many things at once (structure: interleaving tasks on few threads).
- **Parallelism** — *doing* many things at once (execution: multiple CPU cores literally simultaneously).

Crucial distinctions:
- **Async ≠ parallel.** A single-threaded event loop (Node.js) is **concurrent and async but not
  parallel** — it interleaves thousands of I/O operations on one thread.
- **Blocking is about the thread; sync is about the caller.** You can have async-but-blocking (a future
  on a blocked thread) or sync-but-non-blocking (polling). The useful combo is **async + non-blocking**.

> **Senior answer:** "Concurrency is about **structure** (interleaving many tasks), parallelism about
> **execution** (many cores at once). Async I/O lets one thread juggle thousands of waiting operations
> because it never **blocks** on any of them — that's concurrency without parallelism."

---

## 2. Why Async Exists: the C10k Problem

The motivation is concrete. The classic **thread-per-request** model assigns one OS thread to each
connection. An OS thread costs ~**1 MB** of stack and a kernel scheduling slot. Most web threads spend
their time **blocked waiting on I/O** (database, network), doing nothing but holding memory.

- At **10,000 concurrent connections** (the "C10k problem"), thread-per-request needs ~10,000 threads →
  gigabytes of stacks and crushing context-switch overhead, mostly to **wait**.
- **Async / event-loop** servers handle the same load with a **handful of threads** because a thread is
  only used while *actively computing*; during the wait, it serves other requests.

So async is fundamentally about **I/O-bound** scalability — doing more concurrent waiting with fewer
threads. It does **nothing** for CPU-bound work (that needs parallelism / more cores).

> **Trap:** "We'll go async to speed things up." Async doesn't make a single request faster or help
> CPU-bound work — it improves **throughput and resource efficiency under many concurrent I/O-bound
> requests**. Using it for CPU-heavy tasks just adds complexity.

---

## 3. The Event Loop (how non-blocking servers work)

The engine behind Node.js, Netty, Nginx, and reactive frameworks. A small pool of threads runs an
**event loop**: a queue of ready events, each handled by a short non-blocking callback.

```
loop:
  for each ready event (data arrived, timer fired, response ready):
      run its handler (must NOT block)
  register new I/O interest with the OS (epoll/kqueue), then wait for more events
```

- The OS notifies readiness via **epoll/kqueue** (Linux/BSD); the loop never sits blocked on one socket.
- **The cardinal rule: never block the event loop.** A blocking call or heavy CPU work on a loop thread
  freezes **all** in-flight requests on that thread — far worse than thread-per-request, where one slow
  request only blocks its own thread.

> **Senior answer:** "An event loop multiplexes thousands of connections onto a few threads via OS
> readiness notifications (epoll). The whole model collapses if you block a loop thread — so blocking
> work must be offloaded to a separate pool."

---

## 4. The Evolution of Async Code (the through-line)

The history is the best way to understand the tradeoffs — each step fixes the previous one's pain:

1. **Callbacks** — pass a function to run when done. Works, but nesting leads to **"callback hell"**
   (the pyramid of doom) and error handling/propagation is manual and easy to get wrong.
2. **Futures / Promises** — an object representing a not-yet-available value. Composable
   (`.then()`/`thenApply`), flattening the pyramid. Java's `Future` (Java 5) was blocking-only;
   **`CompletableFuture`** (Java 8) made it composable and non-blocking.
3. **Reactive Streams** — Futures handle **one** future value; reactive handles **streams** of many
   values over time, **with backpressure** (§6). Reactor `Flux`/`Mono`, RxJava.
4. **Coroutines / async-await / virtual threads** — make async code **look synchronous** again
   (sequential, readable) while staying non-blocking. Kotlin coroutines, C#/JS `async/await`, and
   Java 21 **virtual threads** all aim here.

> **Senior answer:** "Each generation traded raw control for readability and safety: callbacks →
> Futures (composition) → reactive (streams + backpressure) → coroutines/virtual threads (sequential
> code that's still non-blocking). The newest tools give you async scalability with synchronous-looking
> code."

---

## 5. Futures in Java: CompletableFuture (recap)

`CompletableFuture` is Java's composable async value — map/flatMap/zip without blocking:

```java
CompletableFuture.supplyAsync(() -> fetchUser(id), pool)
    .thenApply(User::profile)            // map
    .thenCompose(p -> loadAsync(p))      // flatMap (chain another async call)
    .exceptionally(ex -> fallback());    // recover
```

Good for **a fixed number** of independent async calls (fan-out/fan-in with `allOf`). It does **not**
model streams or backpressure — that's where reactive comes in. (Depth in the Concurrency handbook.)

---

## 6. Reactive Streams & Backpressure (the key concept)

**Reactive Streams** is a standard (now `java.util.concurrent.Flow`) for **asynchronous streams with
backpressure**, built on four interfaces: `Publisher`, `Subscriber`, `Subscription`, `Processor`.

**Backpressure** is the headline idea: a fast **producer** can overwhelm a slow **consumer**. In a
naive push model the consumer's buffers grow until it runs out of memory. Reactive Streams makes it a
**pull-push hybrid**: the subscriber signals **demand** (`request(n)`) and the publisher emits **at most
that many** items — the consumer controls the rate.

```
Publisher  --(emits ≤ n)-->  Subscriber
Subscriber --request(n)-->   Publisher      // demand flows upstream; producer respects it
```

Strategies when overwhelmed: **buffer**, **drop**, **latest** (keep newest), or **error** — all
expressible in reactive operators.

> **Senior answer:** "Backpressure is the reason reactive exists over plain callbacks/futures: the
> consumer tells the producer how much it can handle (`request(n)`), so a fast source can't flood a slow
> sink. Without it you get unbounded buffers and OOM under load."

---

## 7. Reactor: Mono & Flux

**Project Reactor** (the library behind Spring WebFlux) implements Reactive Streams with two types:

- **`Mono<T>`** — 0 or 1 element (an async single value, like a non-blocking `Optional`/`Future`).
- **`Flux<T>`** — 0..N elements (an async stream).

```kotlin
Flux.fromIterable(ids)
    .flatMap { id -> userService.find(id) }   // async per element, concurrent
    .filter { it.active }
    .map { it.name }
    .onErrorResume { Flux.empty() }
    .subscribe { println(it) }                // NOTHING runs until subscribe()
```

- **Cold vs hot:** a **cold** publisher does nothing until subscribed and replays from the start per
  subscriber (e.g. an HTTP call); a **hot** publisher emits regardless of subscribers and late
  subscribers miss earlier items (e.g. live events).
- **Trap:** **"nothing happens until you subscribe."** Building a `Flux`/`Mono` pipeline without
  subscribing (or returning it so the framework subscribes) means **no execution** — a classic reactive
  bug.
- **Trap:** a single **blocking call** inside a reactive operator blocks an event-loop thread and negates
  the whole model. Offload with `subscribeOn`/`publishOn` to a bounded scheduler, or don't go reactive.

---

## 8. Kotlin Coroutines & Flow as the Async Model

Kotlin's approach makes async code **read sequentially** while staying non-blocking — the suspension
points free the thread instead of blocking it.

```kotlin
suspend fun dashboard(id: Long): Dashboard = coroutineScope {
    val user   = async { userService.fetch(id) }     // concurrent, non-blocking
    val orders = async { orderService.recent(id) }
    Dashboard(user.await(), orders.await())
}
```

- **`suspend`** = async without callbacks/`Mono`; the compiler turns it into a state machine.
- **`Flow`** = Kotlin's reactive stream (cold, backpressure-aware via suspension) — the coroutine answer
  to `Flux`. `StateFlow`/`SharedFlow` are the hot variants.
- This is why **Ktor** and modern Kotlin servers are async "for free" — handlers are `suspend`. (Full
  coroutine mechanics live in the Concurrency handbook.)

> **Nice to know:** coroutines and Reactor solve the same problem differently — Reactor with an explicit
> operator pipeline + backpressure protocol; coroutines with sequential suspending code. Reactor interops
> with coroutines (`.awaitSingle()`, `.asFlow()`).

---

## 9. Spring MVC vs WebFlux

The practical decision in the Spring world (cross-reference the Spring Boot handbook):

| | **Spring MVC** | **Spring WebFlux** |
|---|---|---|
| Model | Servlet, **blocking**, thread-per-request | **Reactive**, non-blocking event loop |
| Returns | objects | `Mono<T>` / `Flux<T>` |
| Stack | JDBC, blocking libs OK | needs non-blocking all the way (R2DBC, WebClient) |
| Backpressure | No | **Yes** |
| Complexity | Simple, easy to debug | Steeper; harder stack traces/debugging |

> **Trap:** going WebFlux but calling **blocking JDBC** inside it — you block the event loop and get the
> worst of both worlds. Reactive only pays off **end-to-end non-blocking**.

---

## 10. Virtual Threads vs Reactive (the modern debate)

The most current senior/staff topic. **Java 21 virtual threads (Project Loom)** let you write **simple
blocking, sequential code** that still scales to millions of concurrent I/O-bound tasks — because a
virtual thread **parks cheaply** on I/O and frees its carrier (the JVM does the multiplexing the event
loop used to do manually).

This challenges reactive's main justification:
- Reactive's big win was **scalability without thread-per-request cost**. Virtual threads deliver that
  **with ordinary readable code** — no `Mono`/`Flux`, no colored functions, normal stack traces and
  debugging.
- **Reactive still wins for:** **streaming with backpressure**, complex async **composition/operators**,
  and event-driven pipelines — things virtual threads don't directly provide.

> **Senior answer:** "For plain 'scale many blocking I/O calls' workloads, **virtual threads** now give
> reactive's scalability with far simpler code, so a lot of teams will skip reactive. Reactive keeps its
> edge where you genuinely need **streaming, backpressure, and rich async composition**. I'd default to
> virtual threads (or coroutines) for request/response services and reach for reactive when the data
> model is a backpressured stream."

---

## 11. When Async Helps — and When It Hurts

**Use async / non-blocking when:**
- **I/O-bound, high-concurrency** workloads (many DB/network/microservice calls).
- **Streaming** data with rate mismatches (backpressure matters).
- Resource-constrained environments where thread/memory efficiency is critical.

**Don't bother (or avoid) when:**
- **CPU-bound** work — async won't help; you need parallelism/more cores.
- Simple, low-concurrency CRUD — thread-per-request (now + virtual threads) is simpler and plenty.
- You can't make the **whole** stack non-blocking — one blocking call ruins the benefit.

> **Senior framing:** "Async is a **throughput-and-efficiency** tool for concurrent I/O, not a speed
> button. I adopt it when the workload is I/O-bound and concurrent and I can keep the stack non-blocking
> end-to-end; otherwise the complexity isn't worth it — especially now that virtual threads make simple
> code scale."

---

## 12. Common Traps & Gotchas

- **Blocking the event loop** — the cardinal sin of reactive/Node; offload blocking work to a bounded
  scheduler/pool.
- **Forgetting to subscribe** — a Reactor pipeline that's never subscribed does nothing.
- **Async ≠ faster** — it's about concurrency/throughput, not single-request latency.
- **Lost exceptions** — errors in callbacks/reactive chains vanish unless handled (`exceptionally`,
  `onErrorResume`); always have an error path.
- **Thread-local context loss** — request/security/trace context doesn't follow async hops automatically
  (needs context propagation / `Reactor Context` / coroutine context).
- **Unbounded buffers** — async without backpressure just moves the OOM, it doesn't prevent it.

---

## 13. Interview Q&A Bank

**Q: Difference between concurrency and parallelism?**
> Concurrency is structuring a program to handle many tasks by interleaving them (can be one thread);
> parallelism is executing many at once on multiple cores. Async I/O gives concurrency without
> parallelism.

**Q: Blocking vs non-blocking vs sync vs async?**
> Sync/async is about the caller (wait vs continue); blocking/non-blocking is about the thread (parked vs
> free). The useful combination is async + non-blocking, where one thread serves many waiting operations.

**Q: What problem does async solve (C10k)?**
> Thread-per-request wastes ~1 MB and a scheduler slot per mostly-idle connection; at ~10k connections
> that's unsustainable. Async handles the same load on a few threads by only using a thread while actively
> computing, not while waiting on I/O.

**Q: How does an event loop work and what's the cardinal rule?**
> A few threads process a queue of ready I/O events via OS readiness notifications (epoll/kqueue), each
> with a non-blocking handler. Rule: never block the loop — a blocking call freezes all requests on that
> thread.

**Q: Why did we move from callbacks to Futures to reactive?**
> Callbacks cause nesting/error-handling pain; Futures add composition for a single value;
> reactive adds streams of many values with backpressure; coroutines/virtual threads restore sequential
> readability while staying non-blocking.

**Q: What is backpressure and why does it matter?**
> A mechanism for a slow consumer to limit a fast producer (request(n) demand signaling), preventing
> unbounded buffering and OOM. It's the core reason reactive exists over plain futures/callbacks.

**Q: Mono vs Flux; cold vs hot?**
> Mono = 0..1 async value; Flux = 0..N async stream. Cold publishers do nothing until subscribed and
> replay per subscriber; hot publishers emit regardless and late subscribers miss earlier items.

**Q: When WebFlux over MVC?**
> High-concurrency, I/O-bound workloads with a fully non-blocking stack (R2DBC, WebClient). Any blocking
> call on the event loop negates it; most CRUD is simpler and fine on MVC.

**Q: Do virtual threads make reactive obsolete?**
> For 'scale many blocking I/O calls', largely yes — virtual threads give the scalability with simple
> sequential code. Reactive retains value for streaming, backpressure, and complex async composition.

**Q: Does async make my application faster?**
> No — it improves throughput and resource efficiency under concurrent I/O load, not single-request
> latency, and does nothing for CPU-bound work (which needs parallelism).

**Q: Coroutines vs reactive (Reactor)?**
> Same goal, different style: Reactor uses an explicit operator pipeline with a backpressure protocol;
> coroutines use sequential suspending code with structured concurrency. They interoperate.

---

## 14. Cheat Sheet

- **Vocabulary:** sync/async = caller waits or not; blocking/non-blocking = thread parked or free;
  **concurrency** (structure, interleave) ≠ **parallelism** (execution, many cores). Async ≠ parallel,
  async ≠ faster.
- **Why async:** the **C10k** problem — thread-per-request wastes memory/threads on idle, blocked I/O
  waits. Async scales **I/O-bound** concurrency on few threads; useless for **CPU-bound**.
- **Event loop:** few threads + OS readiness (epoll/kqueue); **never block the loop** (offload blocking
  work).
- **Evolution:** callbacks → Futures/`CompletableFuture` → **Reactive Streams** → coroutines/**virtual
  threads** (sequential look, non-blocking).
- **Backpressure:** consumer signals **demand** (`request(n)`) so a fast producer can't flood a slow
  consumer → no unbounded buffers/OOM. The reason reactive beats plain futures for streams.
- **Reactor:** **Mono** (0..1), **Flux** (0..N); **cold** (per-subscriber, lazy) vs **hot**; **nothing
  runs until `subscribe()`**; one blocking call ruins it.
- **Kotlin:** `suspend` + **Flow** = non-blocking async with sequential code; powers Ktor.
- **MVC vs WebFlux:** reactive only **end-to-end non-blocking** (R2DBC/WebClient); blocking JDBC on the
  loop = worst case.
- **Virtual threads (Java 21):** simple blocking code that scales like reactive → reactive now reserved
  for **streaming/backpressure/composition**.
- **Traps:** blocking the loop, forgetting to subscribe, lost exceptions, context propagation loss,
  unbounded buffers.

---

*End of handbook. The signal: async is about **I/O-bound concurrency and efficiency, not speed** — know
the precise vocabulary, the **C10k/event-loop** motivation, the **callbacks → futures → reactive →
coroutines/virtual threads** evolution, and **backpressure** as the reason reactive exists. Then take the
modern position: **virtual threads/coroutines** for request/response scale with simple code, **reactive**
when you truly need streaming and backpressure.*
