---
title: "Java & Kotlin Concurrency — Interview Handbook"
description: "Java and Kotlin concurrency: the Java Memory Model, synchronized vs atomics, thread pools, virtual threads, and Kotlin coroutines — with a Q&A bank."
sidebar:
  label: "Java & Kotlin Concurrency"
---

> Concurrency without the fog: what actually makes it hard, the Java Memory Model (happens-before,
> visibility vs atomicity, volatile), synchronized vs atomics and CAS, the lock family, **wait/notify
> and the synchronizers** (latch, barrier, semaphore), executors and
> thread-pool sizing, Future/CompletableFuture, virtual threads (Project Loom), and Kotlin coroutines,
> structured concurrency, and Flow — explained simply, with the tricks and traps interviewers probe,
> plus a Q&A bank.

---

## 1. Why Concurrency Is Hard (the mental model)

Concurrency bugs come from **shared mutable state** accessed by multiple threads without coordination.
Three distinct problems hide inside "it's not thread-safe":

- **Atomicity** — `count++` is really *read, add, write* (three steps). Two threads interleave and one
  update is lost. This is a **race condition**.
- **Visibility** — a value one thread writes may sit in a CPU cache/register and **never become visible**
  to another thread (the JIT and CPU are allowed to cache and reorder). A loop reading a non-`volatile`
  flag can spin forever.
- **Ordering** — compilers and CPUs **reorder** instructions for speed; without rules, another thread can
  observe operations in a surprising order.

> **Senior answer:** "Thread-safety is about three things — **atomicity, visibility, and ordering**.
> `synchronized`/locks give all three; `volatile` gives visibility + ordering but **not** atomicity;
> atomics give atomicity for a single variable via CAS. I pick the cheapest tool that covers what the
> code actually needs."

The cheapest fix of all: **don't share mutable state** — use immutability, confinement, or message
passing.

---

## 2. Threads and Their Cost

A `Thread` maps to an **OS thread** — roughly **1 MB** of stack and a kernel-scheduled context. They're
*expensive*: creating thousands, or blocking many on I/O, wastes memory and causes context-switch
overhead. This is exactly the pain that **virtual threads** (§15) and **coroutines** (§16) solve.

```java
Thread t = new Thread(() -> work());
t.start();   // runs concurrently
t.join();    // wait for it to finish (caller blocks)
```

**Thread states** (`Thread.State`, common interview question):
`NEW` → `RUNNABLE` (running or ready) → `BLOCKED` (waiting to enter a `synchronized` monitor) /
`WAITING` (in `wait()`/`join()`/`park()` with no timeout) / `TIMED_WAITING` (`sleep(t)`,
`wait(t)`) → `TERMINATED`. Note **BLOCKED** (can't get a lock) is distinct from **WAITING**
(voluntarily parked until signalled).

**Daemon vs user threads:** the JVM exits when all **user** (non-daemon) threads finish — **daemon**
threads (e.g. GC, background workers via `t.setDaemon(true)`) don't keep it alive and are abruptly
stopped at shutdown (so don't hold critical state in them).

Rule: **don't manage raw threads** in app code — use an `ExecutorService` (§10) or higher-level
abstractions.

---

## 3. The Java Memory Model (JMM) & happens-before

The JMM defines **when a write by one thread is guaranteed visible to a read by another**. The key
concept is **happens-before**: if action A *happens-before* B, then A's effects are visible to B.

Sources of happens-before you must know:
- **Program order** within a single thread.
- **Monitor lock:** unlocking a monitor *happens-before* a later lock of the **same** monitor.
- **volatile:** a write to a `volatile` field *happens-before* every later read of it.
- **Thread start/join:** `start()` happens-before the thread's actions; a thread's actions happen-before
  another thread's successful `join()`.
- **final fields:** safely published after construction.

Without a happens-before edge, **no visibility guarantee** — the bug may appear only under load, on
certain CPUs, after JIT compilation.

> **What they're testing:** that "it worked on my machine" is meaningless for concurrency — correctness
> requires a happens-before relationship, not luck.

---

## 4. synchronized (intrinsic locks)

`synchronized` acquires an object's **monitor** — mutual exclusion **plus** a happens-before edge
(visibility). It's reentrant (the same thread can re-enter).

```java
synchronized (lock) { /* critical section */ }   // block form (preferred: explicit lock object)
public synchronized void m() { ... }              // locks 'this' (or the Class for static)
```

- **Trap:** locking on `this` or a public object lets outside code lock on the same monitor → use a
  **private final lock object**.
- **Trap:** don't lock on a `String` literal or boxed `Integer` (interned/cached → shared monitor).
- Coarse but correct. Modern JITs make uncontended `synchronized` cheap (biased/thin locks).

---

## 5. volatile vs synchronized vs atomic

| Tool | Atomicity | Visibility | Ordering | Use for |
|---|---|---|---|---|
| `volatile` | **No** (except single read/write) | Yes | Yes | Flags, state published once, double-checked locking |
| `synchronized`/`Lock` | Yes | Yes | Yes | Compound operations / invariants over multiple fields |
| `Atomic*` (CAS) | Yes (single var) | Yes | Yes | Counters, references, lock-free updates |

```java
private volatile boolean running = true;   // visibility for a stop flag — correct
private volatile int count;                 // count++ STILL not atomic — WRONG for counters
```

> **Trap:** `volatile int count; count++` is a classic bug — `volatile` fixes visibility but `++` is
> still read-modify-write. Use `AtomicInteger`.

---

## 6. Atomics & CAS (the lock-free building block)

`AtomicInteger`, `AtomicLong`, `AtomicReference`, `LongAdder`, … update without locks using
**Compare-And-Swap (CAS)**: a CPU instruction that atomically "set X to new **if** X still equals
expected, else retry." It's the foundation of `ConcurrentHashMap`, locks, and non-blocking algorithms.

```java
AtomicInteger c = new AtomicInteger();
c.incrementAndGet();                 // lock-free, atomic
c.updateAndGet(x -> x * 2);          // CAS retry loop under the hood
```

- **LongAdder** beats `AtomicLong` under **high contention** — it spreads updates across cells and sums
  on read (great for metrics/counters).
- **ABA problem:** a value goes A→B→A and CAS wrongly succeeds; `AtomicStampedReference` adds a version
  stamp to detect it.

> **Senior answer:** "For a hot counter I use `LongAdder`, not `synchronized` — it's lock-free and
> shards contention. CAS underlies the whole `java.util.concurrent` toolkit."

---

## 7. The Lock Family (java.util.concurrent.locks)

When `synchronized` isn't flexible enough:

- **ReentrantLock** — like `synchronized` but with `tryLock()` (timeout), interruptible acquisition,
  fairness option, and multiple `Condition`s. **Always unlock in `finally`.**
- **ReadWriteLock / ReentrantReadWriteLock** — many concurrent readers **or** one writer. Good for
  read-heavy data; beware writer starvation.
- **StampedLock** (Java 8) — adds **optimistic reads** (no lock if no writer interfered) → very fast
  read-mostly. Not reentrant; trickier API.

```java
lock.lock();
try { /* critical section */ }
finally { lock.unlock(); }   // never skip this
```

---

## 8. Inter-Thread Coordination: wait / notify (and sleep vs wait)

Locks give **mutual exclusion**; `wait`/`notify` give **signalling** — one thread waits for a condition
another thread will make true (the low-level basis of producer/consumer). They operate on an object's
**monitor**, so you must hold the lock (`synchronized`) to call them.

```java
synchronized (queue) {
    while (queue.isEmpty())     // ALWAYS wait in a loop, never an if
        queue.wait();           // releases the monitor + parks; re-acquires on wake
    return queue.remove();
}
// producer side:
synchronized (queue) { queue.add(item); queue.notifyAll(); }   // wake waiters
```

- **Wait in a `while`, not an `if`** — guards against **spurious wakeups** and the condition changing
  before the woken thread re-acquires the lock. The single most common `wait/notify` bug.
- **`notify` vs `notifyAll`** — `notify` wakes **one** arbitrary waiter (risk: wakes the wrong one and a
  signal is lost); `notifyAll` wakes all and lets each re-check. **Prefer `notifyAll`** unless you've
  proven a single condition with one waiter.
- **`sleep()` vs `wait()`** (classic question): `Thread.sleep(t)` is static, pauses the current thread
  and **keeps every lock it holds**; `wait()` is called on an object, **releases that monitor**, and
  resumes only when notified (or timed out / interrupted). Use `sleep` for delays, `wait` for
  coordination.
- **`Condition`** (on a `ReentrantLock`) is the modern equivalent: `await()`/`signal()`/`signalAll()`,
  with **multiple wait-sets per lock** (e.g. separate "not full" and "not empty" conditions).

> **Senior answer:** "In real code I rarely hand-write `wait/notify` — I use a `BlockingQueue` or a
> higher-level synchronizer, which encapsulate the guarded-loop correctly. But I can explain the
> primitive: wait in a loop, release the monitor, prefer `notifyAll`, and remember `sleep` holds locks
> while `wait` releases them."

---

## 9. Synchronizers (java.util.concurrent)

Ready-made coordination tools — prefer these over hand-rolled `wait/notify`:

- **CountDownLatch** — a **one-shot** gate: threads `await()` until a counter hits zero
  (`countDown()`). Use for "wait until N tasks/services are ready" or fan-out/fan-in. **Not reusable.**
- **CyclicBarrier** — N threads wait for **each other** at a barrier, then all proceed; **reusable**
  (resets each cycle). Use for phased parallel computation. (Latch waits for *events*; barrier waits for
  *each other*.)
- **Semaphore** — holds N **permits** (`acquire`/`release`) — a throttle/bounded pool (e.g. limit
  concurrent DB connections or in-flight requests). A binary semaphore (1 permit) is a non-reentrant
  lock-like primitive.
- **Phaser** — a flexible, **reusable** multi-phase barrier with dynamic party registration (a more
  capable CyclicBarrier).
- **Exchanger** — two threads meet and **swap** objects at a rendezvous point.

```java
CountDownLatch ready = new CountDownLatch(3);
// workers: ready.countDown();   main: ready.await();   // proceeds once all 3 done

Semaphore permits = new Semaphore(10);
permits.acquire(); try { callService(); } finally { permits.release(); }
```

> **Trap:** `CountDownLatch` vs `CyclicBarrier` — latch is **one-shot** and threads wait for an event
> count to reach zero; barrier is **reusable** and threads wait for **one another**. Mixing them up is a
> classic miss.

---

## 10. Executors & Thread Pools

**Never** create threads per task. Submit tasks to an `ExecutorService` that reuses a bounded pool.

```java
ExecutorService pool = Executors.newFixedThreadPool(8);
Future<Integer> f = pool.submit(() -> compute());
pool.shutdown();
```

Pool sizing rule of thumb:
- **CPU-bound** tasks → pool ≈ number of cores (`Runtime.getRuntime().availableProcessors()`).
- **I/O-bound** tasks → larger (threads spend time blocked); or move to async / virtual threads.

> **Trap:** `Executors.newCachedThreadPool()` and `newFixedThreadPool` use an **unbounded queue** (or
> unbounded threads) → under overload they OOM or exhaust threads. In production, configure a
> `ThreadPoolExecutor` with a **bounded queue + a rejection policy** (back-pressure), not the
> convenience factories.

`ScheduledExecutorService` for delayed/periodic tasks (replaces `Timer`).

---

**Fork/Join & parallel streams:** `ForkJoinPool` powers **divide-and-conquer** parallelism via
**work-stealing** (idle threads steal tasks from busy threads' queues) — great for recursive,
CPU-bound splitting (`RecursiveTask`). Java 8 **parallel streams** (`list.parallelStream()`) run on the
shared **common pool**. **Trap:** parallel streams use that shared pool, so a blocking or long task in
one starves all others — only use them for CPU-bound, side-effect-free work on large datasets.

---

## 11. Future & CompletableFuture

`Future` (Java 5) represents a pending result but only offers blocking `get()`. **CompletableFuture**
(Java 8) is composable, non-blocking async:

```java
CompletableFuture.supplyAsync(() -> fetchUser(id), pool)
    .thenApply(User::profile)              // transform
    .thenCompose(p -> loadAsync(p))        // chain another async call (flatMap)
    .thenCombine(otherFuture, (a, b) -> merge(a, b))  // join two
    .exceptionally(ex -> fallback())       // recover
    .thenAccept(this::render);
```

- `thenApply` = map, `thenCompose` = flatMap, `thenCombine` = zip, `allOf`/`anyOf` = fan-in.
- **Trap:** always pass your **own executor**; the default `ForkJoinPool.commonPool()` is shared and
  small — blocking calls on it starve the whole JVM.

---

## 12. Concurrent Collections (quick recall)

`ConcurrentHashMap` (per-bucket CAS + synchronized, no nulls, atomic `computeIfAbsent`/`merge`),
`CopyOnWriteArrayList` (read-mostly), `ConcurrentSkipListMap` (sorted), and the **BlockingQueue** family
(`ArrayBlockingQueue`, `LinkedBlockingQueue`, `SynchronousQueue`) for producer/consumer. Prefer these
over `synchronized` wrappers. (See the Data Structures handbook for internals.)

---

## 13. The Classic Bugs

- **Deadlock** — two threads each hold a lock the other needs. **Prevent** with a global **lock
  ordering** (always acquire A before B), `tryLock` with timeout, or fewer locks.
- **Livelock** — threads keep reacting to each other and make no progress (two people stepping aside in
  a hallway). Add randomized backoff.
- **Starvation** — a thread never gets the resource (unfair locks, priority). Use fair locks if needed.
- **Race condition** — outcome depends on timing of unsynchronized access. Fix with atomicity.
- **Thread leak** — pools never shut down, or tasks block forever. Always `shutdown()`; use timeouts.

> **Trap (deadlock):** the interviewer asks "how do you prevent deadlock?" — the strongest answer is
> **consistent lock acquisition order** plus `tryLock` timeouts, not "use more locks."

---

## 14. Thread-Safety Strategies (in order of preference)

1. **Don't share** — confine state to one thread (e.g. `ThreadLocal`, or per-request objects).
2. **Immutability** — immutable objects are inherently thread-safe (no writes to race). Records / `final`
   fields. **The best default.**
3. **Message passing** — queues/coroutine channels instead of shared memory.
4. **Synchronization** — locks/atomics, only when shared mutable state is unavoidable.

`ThreadLocal` gives each thread its own copy (e.g. `SimpleDateFormat`, request context) — **but** beware
leaks in thread pools (threads are reused; always `remove()`).

---

## 15. Virtual Threads (Project Loom, Java 21)

The headline modern feature. **Virtual threads** are lightweight threads scheduled by the JVM onto a
small pool of OS "carrier" threads. Blocking a virtual thread (on I/O) **parks it cheaply** and frees
the carrier — so you can have **millions** of them.

```java
// Java 21
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> handleRequest());   // 1 virtual thread per request — fine at huge scale
}
```

- **Why it matters:** the old "thread-per-request" model becomes viable again at scale; you write
  **simple blocking code** that performs like async — no callback hell.
- **Pitfall:** pinning — a virtual thread inside a `synchronized` block doing blocking I/O can pin the
  carrier; prefer `ReentrantLock` in those paths. Don't pool virtual threads (they're cheap to create).

> **Senior answer:** "Loom lets us keep readable blocking code while scaling I/O-bound workloads to
> millions of concurrent tasks — it largely removes the reason to write reactive/callback code for
> throughput."

---

## 16. Kotlin Coroutines

Kotlin's answer to async: **coroutines** are *suspendable computations* — extremely cheap (not OS
threads), with **structured concurrency** baked in.

- **`suspend fun`** — a function that can **pause** without blocking a thread (at suspension points like
  `delay`, network calls). Under the hood it's a state machine (continuation-passing), not a blocked
  thread.
- **Structured concurrency** — coroutines are launched in a **scope**; the scope won't complete until its
  children do, and cancelling the scope cancels children. No leaks.

```kotlin
suspend fun load() = coroutineScope {
    val a = async { fetchA() }      // start concurrently
    val b = async { fetchB() }
    combine(a.await(), b.await())   // both run in parallel, structured
}

scope.launch { ... }                // fire-and-forget coroutine (returns a Job)
```

- **Dispatchers** decide the thread pool: `Dispatchers.Default` (CPU work), `Dispatchers.IO` (blocking
  I/O), `Dispatchers.Main` (UI). Switch with `withContext(Dispatchers.IO) { ... }`.
- **Job / cancellation** — cooperative: code must be cancellation-aware (suspend points check; use
  `isActive`, `ensureActive()`). 
- **`launch` vs `async`** — `launch` returns a `Job` (no result); `async` returns a `Deferred<T>` you
  `await()` for a result. Use `async` only for actual parallel decomposition.

> **Trap:** calling a blocking call (JDBC, `Thread.sleep`) inside a coroutine **without**
> `Dispatchers.IO` blocks a precious `Default` thread. Wrap blocking work in `withContext(IO)`.

**Flow** — Kotlin's cold async stream (reactive streams with coroutines): `flow { emit(...) }`,
operators (`map`, `filter`, `buffer`, `flatMapMerge`), collected with `.collect`. Backpressure-aware.
`Channel` is the hot, queue-like primitive for coroutine-to-coroutine communication.

---

## 17. Coroutines vs Threads vs Virtual Threads

| | OS Threads | Virtual Threads (Loom) | Kotlin Coroutines |
|---|---|---|---|
| Cost | ~1 MB, heavy | Very cheap | Very cheap |
| Scale | thousands | millions | millions |
| Model | blocking | blocking (looks sync) | suspend (cooperative) |
| Cancellation | hard | thread interrupt | structured, first-class |
| Where | any JVM | Java 21+ | Kotlin (any platform) |

> **Senior answer:** "Virtual threads and coroutines solve the same problem — cheap concurrency for
> I/O-bound work — differently. Loom keeps the blocking programming model at the JVM level; coroutines
> add structured concurrency and cancellation at the language level. On Kotlin/JVM 21 you can even run
> coroutine dispatchers on virtual threads."

---

## 18. Tricks, Traps & Gotchas

- **Double-checked locking** needs `volatile` on the field, or the half-constructed object can leak.
- **False sharing** — two hot variables on the same cache line cause cache-line ping-pong; pad or use
  `@Contended` / `LongAdder`.
- **`Thread.sleep` in a lock** holds the lock the whole time — don't.
- **Catching `InterruptedException` and swallowing it** breaks cancellation — restore the flag
  (`Thread.currentThread().interrupt()`) or propagate.
- **`ConcurrentModificationException`** is a single-thread fail-fast signal, **not** proof of a
  thread-safety problem.
- **Static `SimpleDateFormat`** is not thread-safe → use `DateTimeFormatter` (immutable) instead.

---

## 19. Interview Q&A Bank

**Q: What are the three concerns of thread safety?**
> Atomicity, visibility, ordering. Locks give all three; volatile gives visibility/ordering but not
> atomicity; atomics give single-variable atomicity via CAS.

**Q: What does volatile guarantee — and not?**
> Guarantees visibility and prevents reordering for that field; does NOT make compound ops like `i++`
> atomic. Good for flags and double-checked locking, wrong for counters.

**Q: Explain happens-before.**
> A rule set defining when one thread's writes are visible to another. Edges come from program order,
> monitor lock/unlock, volatile read/write, thread start/join, final fields. No edge → no visibility
> guarantee.

**Q: sleep() vs wait()?**
> `sleep(t)` is static, pauses the current thread, and keeps all held locks. `wait()` is called on an
> object, releases that monitor, and resumes only on notify/timeout/interrupt. `sleep` for delays, `wait`
> for coordination.

**Q: Why call wait() in a loop, and notify vs notifyAll?**
> Loop (while) re-checks the condition to handle spurious wakeups and state changing before re-acquiring
> the lock. Prefer notifyAll so the right waiter re-checks; notify can wake the wrong thread and lose the
> signal.

**Q: CountDownLatch vs CyclicBarrier?**
> Latch is one-shot: threads await until a counter reaches zero (wait for events). Barrier is reusable:
> N threads wait for each other, then all proceed (wait for one another). Use Semaphore to throttle
> concurrent access via permits.

**Q: BLOCKED vs WAITING thread state?**
> BLOCKED = waiting to acquire a synchronized monitor. WAITING/TIMED_WAITING = voluntarily parked in
> wait/join/sleep/park until signalled or timed out.

**Q: synchronized vs ReentrantLock?**
> Both reentrant mutual exclusion. ReentrantLock adds tryLock/timeout, interruptibility, fairness, and
> multiple conditions — at the cost of manual unlock in finally. Use synchronized when simple.

**Q: What is CAS and where is it used?**
> Compare-And-Swap: atomically set a value if it still equals the expected one, else retry. Foundation of
> atomics, ConcurrentHashMap, and lock-free algorithms. Watch the ABA problem (use stamped references).

**Q: How do you size a thread pool?**
> CPU-bound ≈ #cores; I/O-bound larger (or go async/virtual threads). Always bound the queue and set a
> rejection policy for back-pressure — avoid the unbounded convenience factories.

**Q: Future vs CompletableFuture?**
> Future only blocks on get(). CompletableFuture composes async pipelines (thenApply/Compose/Combine,
> allOf, exceptionally) non-blockingly. Always supply your own executor.

**Q: How do you prevent deadlock?**
> Acquire locks in a consistent global order, use tryLock with timeouts, minimize lock scope and count,
> prefer immutability/confinement to avoid locking at all.

**Q: What are virtual threads and why do they matter?**
> JVM-scheduled lightweight threads (Java 21) that park cheaply on blocking I/O, freeing the carrier.
> Millions can run, making simple blocking thread-per-request code scale like async. Beware pinning in
> synchronized blocks.

**Q: How do coroutines differ from threads?**
> Coroutines are suspendable computations (not OS threads), extremely cheap, with structured concurrency
> and first-class cancellation. suspend functions pause without blocking a thread; dispatchers map them to
> thread pools.

**Q: launch vs async in Kotlin?**
> launch returns a Job (fire-and-forget); async returns a Deferred<T> you await() for a result. Use async
> for genuine parallel decomposition.

**Q: What's structured concurrency?**
> Coroutines run inside a scope that won't finish until its children do, and cancelling the scope cancels
> children — preventing leaks and orphaned work. coroutineScope/supervisorScope enforce it.

---

## 20. Cheat Sheet

- **3 concerns:** atomicity, visibility, ordering. Cheapest fix: **don't share mutable state**
  (immutability/confinement/messages).
- **volatile** = visibility + ordering, **not** atomicity. **synchronized/Lock** = all three.
  **Atomic*/CAS** = lock-free single-var atomicity; **LongAdder** under high contention.
- **happens-before** edges: program order, lock/unlock, volatile, start/join, final. No edge → no
  guarantee.
- **Locks:** ReentrantLock (tryLock/timeout/fairness, unlock in finally), ReadWriteLock,
  StampedLock (optimistic reads).
- **Coordination:** `wait`/`notify` on a monitor — **wait in a `while` loop**, prefer **`notifyAll`**;
  **`sleep` keeps locks, `wait` releases** them; `Condition` = modern equivalent on a Lock.
- **Synchronizers:** **CountDownLatch** (one-shot, wait for events) · **CyclicBarrier** (reusable, wait
  for each other) · **Semaphore** (N permits = throttle) · Phaser · Exchanger — prefer these over raw
  wait/notify.
- **Pools:** reuse via ExecutorService; size CPU≈cores, I/O larger; **bound the queue + rejection
  policy**; avoid the unbounded factory methods; supply your own executor to CompletableFuture.
  **Fork/Join** = work-stealing divide-and-conquer; parallel streams share the common pool (don't block
  them).
- **Thread states:** NEW → RUNNABLE → BLOCKED (lock) / WAITING / TIMED_WAITING → TERMINATED; **daemon**
  threads don't keep the JVM alive.
- **CompletableFuture:** thenApply/Compose/Combine, allOf/anyOf, exceptionally.
- **Bugs:** deadlock (lock ordering + tryLock), livelock (backoff), starvation (fairness), races
  (atomicity), thread leaks (shutdown/timeouts).
- **Virtual threads (Java 21):** millions of cheap blocking threads; `newVirtualThreadPerTaskExecutor`;
  don't pool; beware synchronized pinning.
- **Kotlin coroutines:** `suspend` pauses without blocking; **structured concurrency** (scopes cancel
  children); dispatchers (Default/IO/Main); `launch`(Job) vs `async`(Deferred); wrap blocking in
  `withContext(IO)`; **Flow** for async streams.
- **Gotchas:** double-checked locking needs volatile; restore interrupt flag; `DateTimeFormatter` over
  `SimpleDateFormat`; false sharing.

---

*End of handbook. The signal: name **atomicity/visibility/ordering**, prefer **immutability and
confinement** over locks, reach for the **cheapest correct tool**, and know the modern shift —
**virtual threads and coroutines** make cheap, readable concurrency the default for I/O-bound work.*
