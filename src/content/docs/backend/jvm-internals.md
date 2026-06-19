---
title: "Java & Kotlin Internals — Interview Handbook"
description: "A complete, easy-to-understand guide to how Java & Kotlin really work: the JVM, memory management, garbage collection, compilers (javac, JIT, AOT,…"
sidebar:
  label: "JVM Internals"
---

> A complete, easy-to-understand guide to how Java & Kotlin really work: the JVM, memory management,
> garbage collection, compilers (javac, JIT, AOT, GraalVM, kotlinc), JDK distributions, customizing
> the JDK, and the type systems — plus version-by-version feature tables and a deep Q&A bank.
>

---

## 1. The Big Picture — How Java & Kotlin Run

Both Java and Kotlin compile to the **same target: JVM bytecode** (`.class` files), which runs on the
**JVM (Java Virtual Machine).** That's why they interoperate seamlessly.

```
Java source (.java) ──javac──┐
                             ├──▶  Bytecode (.class) ──▶ JVM ──JIT──▶ native machine code ──▶ CPU
Kotlin source (.kt) ─kotlinc─┘                          (interprets + compiles hot code)
```

**Key idea — "Write once, run anywhere":** bytecode is platform-independent. The JVM for each OS
turns it into native instructions. The JVM also does the heavy lifting at runtime: **memory
management, garbage collection, JIT compilation, and security.**

> **Senior framing:** "Java/Kotlin are *managed* languages — you don't `malloc`/`free`. The JVM
> owns memory and reclaims it via GC, and it gets fast by JIT-compiling hot code paths to native at
> runtime based on real profiling data."

The JVM has three main subsystems:
1. **Class Loader** — finds, loads, links, and initializes `.class` files.
2. **Runtime Data Areas** — the memory (heap, stacks, metaspace…) — see §2.
3. **Execution Engine** — interpreter + JIT compiler + garbage collector.

---

## 2. JVM Memory Management (the memory areas)

The JVM divides memory into regions. Knowing which is **shared** vs **per-thread** is a classic
interview point.

| Area | Shared or per-thread? | What it holds |
|---|---|---|
| **Heap** | Shared (all threads) | All **objects** and arrays; managed by GC |
| **Stack** | Per-thread | Stack **frames**: local variables, method calls, partial results |
| **Metaspace** (was PermGen ≤ Java 7) | Shared | **Class metadata** (field/method info, etc.) — in native memory |
| **PC Register** | Per-thread | Address of the current instruction |
| **Native Method Stack** | Per-thread | State for native (JNI/C) calls |

### Heap structure (generational)
```
HEAP
┌───────────────────────── Young Generation ─────────────────────────┐  ┌── Old Gen ──┐
│  Eden  │  Survivor S0  │  Survivor S1                               │  │  long-lived │
└────────┴───────────────┴────────────────────────────────────────── ┘  └─────────────┘
new objects → Eden ─(survive a GC)→ Survivor ─(survive many GCs)→ promoted to Old Gen
```
- **Young Gen (Eden + 2 Survivor spaces):** new objects start here. Most die young ("weak generational
  hypothesis") → cheap **Minor GC** clears them fast.
- **Old Gen (Tenured):** objects that survived many minor GCs get **promoted** here. Cleaned by the
  more expensive **Major/Full GC**.

### Stack vs Heap (the #1 memory question)
| | Stack | Heap |
|---|---|---|
| Stores | Local variables, references, call frames | Objects/arrays |
| Scope | Per-thread (thread-safe by nature) | Shared across threads |
| Speed | Very fast (LIFO push/pop) | Slower; needs GC |
| Lifetime | Until the method returns | Until no references → GC'd |
| Error when full | `StackOverflowError` (e.g., infinite recursion) | `OutOfMemoryError: Java heap space` |

> **Example:** `int x = 5;` → `x` lives on the **stack**. `String s = new String("hi");` → the
> reference `s` is on the **stack**, the actual String **object** is on the **heap**.

### Object lifecycle & references
An object is **eligible for GC** when it's no longer **reachable** from any "GC root" (active stack
frames, static fields, etc.). **Reference types** control this:
- **Strong** (normal): never collected while reachable.
- **Soft:** collected only when memory is low (good for caches).
- **Weak:** collected at the next GC (e.g., `WeakHashMap`).
- **Phantom:** for cleanup actions after collection.

### Memory leaks in a GC language
Yes, they still happen — when you **keep references you don't need**:
- Forgotten entries in a **static collection** / cache that grows forever.
- Unremoved **listeners/callbacks**.
- `ThreadLocal`s not cleared in thread pools.
- Inner classes holding the outer instance.

> **"How do you find a memory leak?"** Watch heap growth + GC frequency; take a **heap dump**
> (`jmap`, or `-XX:+HeapDumpOnOutOfMemoryError`); analyze with **Eclipse MAT / VisualVM** to find the
> dominator tree / what holds the references; fix the retained reference.

---

## 3. Garbage Collection (every collector, explained simply)

GC automatically frees heap memory occupied by unreachable objects. The core algorithm is
**mark-and-sweep** (mark reachable objects, sweep the rest), usually with **compaction** (move
survivors together to avoid fragmentation) and **generational** collection (collect young gen often,
old gen rarely).

**The fundamental trade-off:** **throughput** (total work done) vs **latency** (pause times) vs
**footprint** (memory used). No GC wins all three — you pick.

### The collectors

| Collector | Style | Pause | Best for | Flag |
|---|---|---|---|---|
| **Serial** | Single-threaded, stop-the-world | High | Small heaps, single-core, containers | `-XX:+UseSerialGC` |
| **Parallel (Throughput)** | Multi-threaded STW | Medium-High | Batch jobs where throughput > latency | `-XX:+UseParallelGC` |
| **G1 (Garbage First)** | Region-based, mostly concurrent | Low-Medium (target pause) | **Default since Java 9**; general server apps | `-XX:+UseG1GC` |
| **ZGC** | Concurrent, region-based | **<1 ms**, scalable to TBs | Huge heaps, low-latency services | `-XX:+UseZGC` |
| **Shenandoah** | Concurrent compaction | Very low | Low-latency, Red Hat builds | `-XX:+UseShenandoahGC` |
| **Epsilon** | "No-op" — never collects | n/a | Performance testing / very short jobs | `-XX:+UseEpsilonGC` |

- **Stop-the-world (STW):** the GC pauses all application threads. **Concurrent** collectors do most
  work *while the app runs* to minimize these pauses.
- **G1** splits the heap into many equal **regions** and collects the ones with the most garbage
  "first," aiming for a configurable max pause (`-XX:MaxGCPauseMillis`).
- **ZGC / Shenandoah** are the modern **ultra-low-latency** collectors — concurrent marking *and*
  compaction, so pauses stay sub-millisecond even on multi-terabyte heaps.

> "Default to **G1**. If you need consistently tiny pauses on a big heap, use **ZGC**. Use
> **Parallel** for batch/throughput jobs that don't care about pauses. Always measure before tuning."

### Key GC knobs
```
-Xms2g -Xmx2g            # initial & max heap (set equal in prod to avoid resizing)
-XX:MaxGCPauseMillis=200 # G1 pause target
-Xss512k                 # per-thread stack size
-XX:+HeapDumpOnOutOfMemoryError
-Xlog:gc*                # GC logging (Java 9+)  (was -XX:+PrintGCDetails)
```

> **`System.gc()` is a *suggestion*, not a command** — the JVM may ignore it. Don't rely on it.

---

## 4. The Compilers: javac, Bytecode, JIT, AOT & GraalVM

There are **two compilation stages** in Java — this surprises people:

### Stage 1 — Ahead-of-time source compilation (`javac`)
`javac` turns `.java` → **bytecode** (`.class`). This is **not** native code — it's portable
instructions for the JVM. (Kotlin's `kotlinc` does the same to `.kt`.)

```bash
javac Hello.java     # → Hello.class (bytecode)
javap -c Hello       # disassemble: see the actual bytecode instructions
java Hello           # run on the JVM
```

### Stage 2 — Just-In-Time (JIT) compilation at runtime
The JVM **starts by interpreting** bytecode (fast startup), and **profiles** which methods run a lot
("hot"). Hot methods get **JIT-compiled to native machine code** for speed. This is **tiered
compilation**:
- **C1 (client compiler):** compiles quickly, lighter optimizations → fast warm-up.
- **C2 (server compiler):** slower to compile but heavy optimizations → peak performance.
- Code flows: **interpreter → C1 → C2** as a method gets hotter.

**JIT optimizations** (why long-running JVMs get *faster* over time): method **inlining**, dead-code
elimination, **escape analysis** (stack-allocate objects that never escape a method), loop unrolling,
and **deoptimization** (revert if an assumption breaks).

> "The JVM is fast *despite* bytecode because the JIT compiles hot paths to optimized native code
> using real runtime profiling — something an ahead-of-time compiler can't do as well. The cost is
> **warm-up time.**"

### AOT & GraalVM Native Image
For **fast startup / low memory** (serverless, CLIs, microservices), you can compile **ahead-of-time
to a native executable** with **GraalVM Native Image**.
- **Pros:** millisecond startup, low memory, no JVM needed at runtime.
- **Cons:** longer build, **closed-world assumption** (reflection/dynamic loading need config),
  generally **lower peak throughput** than a warmed-up JIT.

| | JIT (normal JVM) | AOT / Native Image |
|---|---|---|
| Startup | Slow (warm-up) | **Instant** |
| Peak performance | **Higher** (runtime profiling) | Lower |
| Memory | Higher | Lower |
| Best for | Long-running servers | Serverless, CLIs, short-lived |

> **C1/C2 vs Graal:** GraalVM also ships a **Graal JIT** (a modern compiler written in Java) that can
> replace C2, *and* the Native Image AOT tool. Two different things under one brand.

---

## 5. Kotlin's Compilation Pipeline

Kotlin is a **multi-target** language. The same language compiles to several backends:

| Target | Tool | Output | Use |
|---|---|---|---|
| **Kotlin/JVM** | `kotlinc` | JVM bytecode (`.class`) | Backend, Android, anything on the JVM |
| **Kotlin/Native** | `kotlinc-native` (LLVM) | Native binary, no VM | iOS, embedded, desktop |
| **Kotlin/JS** | Kotlin/JS compiler | JavaScript | Web frontends |
| **Kotlin Multiplatform (KMP)** | shared modules | per-platform | Share business logic across iOS/Android/web |

- The modern compiler frontend is **K2** (faster, better type inference; stable in Kotlin 2.0).
- On the JVM, Kotlin produces **standard bytecode**, so it runs on the same JVM, uses the same GC and
  JIT, and **interoperates with Java both ways** (call Java from Kotlin and vice versa).

> **"How does Kotlin interop with Java?"** Same bytecode + JVM. Kotlin maps Java types, exposes
> annotations (`@JvmStatic`, `@JvmOverloads`, `@JvmName`) to shape the Java-facing API, and treats
> Java types as "platform types" (nullability unknown) at the boundary.

---

## 6. JDK Distributions & "Different Types"

### JDK vs JRE vs JVM (the classic confusion)
```
JDK  =  JRE  +  developer tools (javac, jar, jdb, jlink, jshell...)
JRE  =  JVM  +  core libraries (needed to RUN apps)
JVM  =  the engine that executes bytecode
```
- **JVM:** runs bytecode (the abstract machine).
- **JRE (Java Runtime Environment):** JVM + standard libraries — enough to *run* Java apps. (Standalone
  JREs were dropped after Java 8; now you ship a runtime via `jlink`.)
- **JDK (Java Development Kit):** JRE + tools to *develop* (compile, debug, package).

### "Different types" = vendor distributions
OpenJDK is the open-source reference; many vendors ship builds of it:

| Distribution | Notes |
|---|---|
| **OpenJDK** | The open-source reference implementation |
| **Oracle JDK** | Oracle's build; commercial terms for some uses |
| **Eclipse Temurin (Adoptium)** | Popular free, well-tested OpenJDK build |
| **Amazon Corretto** | Free, long-term support, AWS-tuned |
| **Azul Zulu / Zing** | Zulu free; Zing has the C4 pauseless GC |
| **GraalVM** | OpenJDK + Graal JIT + Native Image (AOT) |
| **Red Hat / Microsoft / SAP builds** | Vendor-supported OpenJDK builds |

> "They're all OpenJDK under the hood and pass the same TCK compatibility tests, so they're
> functionally equivalent. You choose based on **support, license, LTS cadence, and special features**
> (e.g., GraalVM native image, Azul's pauseless GC)."

**LTS (Long-Term Support) versions** — the ones companies standardize on: **8, 11, 17, 21** (and 25
next). Non-LTS releases (every 6 months) are for trying new features.

---

## 7. Customizing the JDK

### The Module System (JPMS / Project Jigsaw, Java 9+)
Java was modularized so you can use **only what you need.** A module declares what it needs/exposes:
```java
// module-info.java
module com.myapp {
    requires java.sql;            // depend on a module
    exports com.myapp.api;        // expose a package
    // opens com.myapp.internal;  // allow reflection
}
```
- **Benefits:** strong encapsulation (hide internals), explicit dependencies, smaller runtimes.
- Migrating big codebases to modules is non-trivial; many apps still run on the classpath.

### `jlink` — build a **custom, minimal runtime**
Instead of shipping a full JDK/JRE, bundle **only the modules your app uses** into a tiny custom
runtime image:
```bash
jlink --add-modules java.base,java.sql \
      --output myapp-runtime \
      --strip-debug --compress=2 --no-header-files --no-man-pages
```
> **Why it matters:** smaller container images, less attack surface, faster startup. A "hello world"
> runtime can shrink from ~300 MB to ~30–40 MB. This is *the* answer to "how do you customize/slim the
> JDK."

### Supporting tools
- **`jdeps`** — analyze dependencies to know which modules you actually need.
- **`jlink`** — assemble the custom runtime (above).
- **`jpackage`** (Java 14+) — produce a native installer/app bundle (`.dmg`, `.msi`, `.deb`).
- **GraalVM Native Image** — go further: one self-contained native binary (no JVM at all).
- **`jshell`** — the REPL for quick experiments.

### Runtime customization (no rebuild)
- **JVM flags:** `-Xmx`, GC selection, `-XX:` options.
- **`java.security` / TLS / locale** configuration.
- **Java Agents** (`-javaagent:`) — instrument bytecode at load time (used by profilers/APM like
  bytecode manipulation with ASM/ByteBuddy).
- **JFR (Java Flight Recorder)** + **JDK Mission Control** — built-in low-overhead profiling.

> **"How would you reduce a Java container's size & startup?"** Use `jdeps` → `jlink` for a minimal
> runtime (or GraalVM native image for serverless), set `-Xms=-Xmx`, choose an appropriate GC (Serial/
> G1 for small heaps), and use a slim base image. Mention container-awareness (the JVM respects cgroup
> limits since Java 10+).

---

## 8. The Java Type System

### Primitives vs References
- **8 primitives:** `byte, short, int, long, float, double, char, boolean` — stored by **value**,
  live on the stack (or inline in objects). Fast, no GC.
- **Reference types:** objects, arrays, interfaces — variables hold a **reference** to a heap object.
- **Wrapper classes** (`Integer`, `Long`…) box primitives into objects (needed for generics/
  collections). **Autoboxing** converts automatically. Boxing in hot loops creates garbage.

### Generics (and type erasure)
Generics give compile-time type safety: `List<String>`. But the JVM uses **type erasure** — generic
type info is **removed at runtime** (`List<String>` and `List<Integer>` are both just `List`).
- Consequence: you can't do `new T[]`, `instanceof List<String>`, or overload by generic type.
- **Why:** backward compatibility with pre-generics bytecode.

### Modern type features
- **`var`** (Java 10): local type inference — `var list = new ArrayList<String>();`.
- **Records** (Java 16): immutable data carriers — `record Point(int x, int y) {}` auto-generates
  constructor, accessors, `equals/hashCode/toString`.
- **Sealed classes** (Java 17): restrict who can extend/implement — `sealed interface Shape permits
  Circle, Square {}`. Great with pattern matching.
- **Pattern matching** for `instanceof` and `switch` (Java 16–21): cleaner type-based branching.

---

## 9. Kotlin Language Internals

Kotlin keeps the JVM but fixes Java's biggest pain points:

### Null safety (compile-time)
Types are non-nullable by default; nullable types need `?`:
```kotlin
var a: String = "hi"     // can't be null
var b: String? = null    // nullable
val len = b?.length ?: 0 // safe call + elvis operator
```
This eliminates most `NullPointerException`s **at compile time** — a top Kotlin selling point.

### How Kotlin features map to bytecode
- **Data classes** → auto-generate `equals/hashCode/toString/copy` (like Java records, but older &
  richer).
- **Extension functions** → compile to **static methods** taking the receiver as a parameter (no
  real class modification).
- **`when`** → like a powerful `switch`.
- **Smart casts** → after a null/type check, the compiler auto-casts.
- **Sealed classes**, **inline functions** (avoid lambda allocation overhead), **value/inline classes**
  (`@JvmInline value class`) — zero-cost wrappers.

### Coroutines (Kotlin's concurrency model)
Lightweight "suspendable" computations for async code that reads like sequential code:
```kotlin
suspend fun loadUser(): User = withContext(Dispatchers.IO) { api.fetch() }
```
- **Not threads:** millions of coroutines can run on a small thread pool. The compiler transforms
  `suspend` functions into a **state machine** (continuation-passing style) — suspension points don't
  block the underlying thread.
- **Structured concurrency:** scopes (`coroutineScope`, `viewModelScope`) tie coroutine lifetimes to
  their parent, so they're cancelled together — no leaks.

> **"Coroutines vs threads?"** Threads are OS-level and heavy (~1 MB stack each). Coroutines are a
> language/library construct — cheap, scheduled cooperatively onto threads, suspend instead of block.
> Ideal for high-concurrency I/O. (Java's answer is **Virtual Threads / Project Loom**, Java 21.)

### Java ↔ Kotlin interop
- Call either from the other freely (same bytecode). Java types crossing into Kotlin are **platform
  types** (`String!`) — nullability unknown, so be careful.
- `@JvmStatic`, `@JvmOverloads`, `@JvmName`, `@JvmField` shape how Kotlin appears to Java callers.

---

## 10. Java Version Feature Table (8 → 21+)

| Version | Year | Type | Key features (with example) |
|---|---|---|---|
| **8 (LTS)** | 2014 | LTS | **Lambdas** `list.forEach(x -> ...)`, **Streams** `list.stream().filter(...).collect(...)`, `Optional`, default methods, new Date/Time API |
| **9** | 2017 | — | **Module System (Jigsaw)**, `jshell` REPL, `jlink`, collection factories `List.of(1,2,3)` |
| **10** | 2018 | — | **`var`** local inference `var x = new ArrayList<String>()`, container-aware JVM |
| **11 (LTS)** | 2018 | LTS | Run a single file `java App.java`, `var` in lambdas, new `HttpClient`, `String` helpers (`isBlank`, `strip`, `lines`) |
| **12–13** | 2019 | — | Switch expressions (preview), **text blocks** (preview) |
| **14** | 2020 | — | **Records** (preview), **switch expressions** (final) `var d = switch(day){...}`, helpful NPE messages, `jpackage` |
| **15** | 2020 | — | **Text blocks** (final) `"""multi-line"""`, sealed classes (preview), ZGC/Shenandoah production |
| **16** | 2021 | — | **Records** (final), **pattern matching for `instanceof`** `if (o instanceof String s)` |
| **17 (LTS)** | 2021 | LTS | **Sealed classes** (final), enhanced pseudo-random generators, strong encapsulation default |
| **18–20** | 2022–23 | — | UTF-8 by default, simple web server, pattern matching/virtual threads (previews) |
| **21 (LTS)** | 2023 | LTS | **Virtual Threads (Loom)**, **pattern matching for `switch`** (final), **record patterns**, sequenced collections, string templates (preview) |
| **22–25** | 2024–25 | — | Continued: structured concurrency, stream gatherers, scoped values; **25 = next LTS** |

> **Two examples worth memorizing:**
> ```java
> // Java 16 record + 21 pattern matching switch
> sealed interface Shape permits Circle, Square {}
> record Circle(double r) implements Shape {}
> record Square(double s) implements Shape {}
> double area(Shape sh) {
>     return switch (sh) {
>         case Circle c -> Math.PI * c.r() * c.r();
>         case Square s -> s.s() * s.s();
>     };
> }
> // Java 21 virtual threads — cheap, millions of them
> try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
>     executor.submit(() -> handleRequest());
> }
> ```

---

## 11. Kotlin Version Feature Table

| Version | Year | Key features (with example) |
|---|---|---|
| **1.0** | 2016 | First stable: null safety `String?`, data classes, extension functions, smart casts |
| **1.3** | 2018 | **Coroutines stable** `suspend fun`, inline classes (experimental), contracts, multiplatform (exp.) |
| **1.4** | 2020 | SAM conversions for Kotlin interfaces, trailing comma, improved type inference |
| **1.5** | 2021 | **Value/inline classes** `@JvmInline value class`, sealed interfaces, stable JVM IR backend |
| **1.6** | 2021 | Stable exhaustive `when`, sealed `when`, suspend functions as supertypes |
| **1.7** | 2022 | **K2 compiler (alpha)**, builder inference improvements, `Regex.matchAt` |
| **1.8** | 2022 | Improved Java interop, `..<` ranges (open-ended), Kotlin/JVM defaults to JVM 8+ |
| **1.9** | 2023 | Stable `..<` operator, `entries` for enums, K2 nearing stable |
| **2.0** | 2024 | **K2 compiler stable** (much faster builds, better inference) — major milestone |
| **2.1 / 2.2** | 2024–25 | Guard conditions in `when`, multi-`$` string interpolation, continued K2/KMP improvements |

> **Examples worth memorizing:**
> ```kotlin
> // null safety + data class + extension function
> data class User(val name: String, val email: String?)
> fun User.greeting() = "Hi ${name}, email = ${email ?: "n/a"}"
>
> // coroutine — async that reads sequentially
> suspend fun load() = coroutineScope {
>     val a = async { fetchA() }
>     val b = async { fetchB() }
>     a.await() + b.await()
> }
>
> // inline value class — zero-cost type safety
> @JvmInline value class UserId(val id: Long)
> ```

---

## 12. Memory & Performance Tuning in Practice

**Diagnosis toolbox:**
- **`jps`** — list JVMs; **`jstat -gc`** — live GC stats; **`jmap`** — heap dump; **`jstack`** —
  thread dump (find deadlocks/blocked threads).
- **VisualVM / JDK Mission Control + JFR** — profiling, allocation hot spots.
- **Eclipse MAT** — analyze heap dumps for leaks (dominator tree, retained size).
- **`-Xlog:gc*`** — GC logs to understand pause causes & frequency.

**Common tuning moves:**
- Set `-Xms` = `-Xmx` in production (avoid heap resizing jitter).
- Pick the GC for your goal (G1 default; ZGC for low pause; Parallel for throughput).
- Reduce allocations in hot paths (object pooling sparingly; avoid boxing; reuse buffers).
- Right-size thread pools; for high-concurrency I/O, use **virtual threads (Java 21)** or **coroutines
  (Kotlin)**.
- Watch for leaks: growing old gen + frequent Full GCs = trouble.

> "Measure first. Most JVM performance problems are **allocation pressure** (too much garbage) or
> **a bad GC choice for the workload**, not raw CPU. Profile, then change one thing."

---

## 13. Interview Q&A Bank

**Q: Stack vs Heap?**
> Stack is per-thread, holds local variables/method frames, fast LIFO, freed on method return,
> overflows with deep recursion (`StackOverflowError`). Heap is shared, holds all objects, managed by
> GC, errors with `OutOfMemoryError`.

**Q: How does garbage collection work?**
> Mark reachable objects from GC roots, sweep the unreachable, often compact survivors. It's
> generational: young gen (Eden+survivors) collected often and cheaply (minor GC); old gen holds
> long-lived objects, collected rarely (major/full GC).

**Q: G1 vs ZGC vs Parallel?**
> Parallel = max throughput, longer STW pauses (batch). G1 = balanced, region-based, default, targets
> a max pause. ZGC = concurrent, sub-millisecond pauses on huge heaps for low-latency services.

**Q: Can you have a memory leak in Java? How do you find it?**
> Yes — by retaining references you no longer need (static caches, unremoved listeners, ThreadLocals).
> Find it via heap growth/GC monitoring, a heap dump (jmap / HeapDumpOnOOM), analyzed in Eclipse MAT to
> see what retains the objects.

**Q: javac vs JIT?**
> javac compiles source to portable bytecode ahead of time. The JIT compiles hot bytecode to native
> machine code at runtime using profiling (tiered C1→C2). That's why the JVM warms up and then runs
> fast.

**Q: What is GraalVM Native Image and its trade-offs?**
> An AOT compiler producing a standalone native binary — instant startup, low memory, no JVM. Costs:
> longer builds, closed-world (reflection needs config), and usually lower peak throughput than a
> warmed JIT. Great for serverless/CLIs.

**Q: JDK vs JRE vs JVM?**
> JVM runs bytecode; JRE = JVM + libraries (run apps); JDK = JRE + dev tools (compile/debug/package).

**Q: How do you slim down a Java runtime?**
> `jdeps` to find needed modules, then `jlink` to build a minimal custom runtime with only those
> modules — much smaller images and attack surface. Or GraalVM native image to drop the JVM entirely.

**Q: What is type erasure?**
> Generics are compile-time only; the JVM removes generic type info at runtime for backward
> compatibility, so `List<String>` and `List<Integer>` are both just `List`. Hence no `new T[]` or
> generic `instanceof`.

**Q: Records vs Lombok vs Kotlin data classes?**
> All reduce boilerplate for data holders. Java records (16+) are built-in, immutable, auto-generate
> accessors/equals/hashCode/toString. Kotlin data classes do the same (plus `copy`) and predate them.

**Q: How do Kotlin coroutines work under the hood?**
> The compiler transforms `suspend` functions into a state machine (continuation-passing). Suspension
> points free the underlying thread instead of blocking, so millions of coroutines multiplex onto a
> small thread pool — cheap structured concurrency.

**Q: Coroutines vs Java virtual threads?**
> Both enable massive concurrency cheaply. Coroutines are a compiler/library feature with suspend
> semantics and structured concurrency. Virtual threads (Java 21/Loom) are JVM-level lightweight
> threads that look like normal blocking code but don't pin an OS thread — simpler interop with
> existing blocking APIs.

**Q: Why is Kotlin null safety better than Java's?**
> It's enforced by the type system at compile time (`String` vs `String?`), with safe calls `?.`,
> elvis `?:`, and smart casts — eliminating most NPEs before runtime, versus Java's runtime NPEs (or
> `Optional`/annotations bolted on).

**Q: What's metaspace and how is it different from PermGen?**
> Metaspace (Java 8+) stores class metadata in **native** memory and auto-grows (bounded by
> `-XX:MaxMetaspaceSize`), replacing the fixed-size heap-based PermGen that caused
> `OutOfMemoryError: PermGen space`.

**Q: What is escape analysis?**
> A JIT optimization: if an object never "escapes" a method (no outside reference), the JVM can
> allocate it on the stack or eliminate it, reducing heap allocation and GC pressure.

---

## 14. Cheat Sheet

- **Both languages → bytecode → JVM** (same GC, JIT, interop).
- **Heap** = objects (GC'd, shared). **Stack** = locals/frames (per-thread, auto-freed).
- **Heap = young (Eden+survivors) + old**; most objects die young.
- **GC pick:** G1 (default/balanced) · ZGC (low pause, big heap) · Parallel (throughput).
- **Two compiles:** `javac`/`kotlinc` → bytecode; **JIT** (C1→C2) → native hot code at runtime.
- **AOT = GraalVM Native Image** → instant startup, lower peak throughput, closed-world.
- **JDK = JRE + tools; JRE = JVM + libs.** Distros: Temurin, Corretto, Zulu, GraalVM, Oracle.
- **LTS Java:** 8, 11, 17, 21 (25 next). **Kotlin milestone:** 2.0 (K2 compiler).
- **Customize JDK:** modules (`module-info`) → `jdeps` → `jlink` (minimal runtime) → `jpackage`.
- **Type erasure:** generics are compile-time only.
- **Records/sealed/`var`/pattern matching** = modern Java; **null safety + coroutines + data classes**
  = Kotlin highlights.
- **Concurrency at scale:** virtual threads (Java 21) / coroutines (Kotlin).
- **Memory leaks happen** via retained references; find with heap dumps + MAT.
- **Tune by measuring:** JFR/VisualVM/`jstat`; set `-Xms=-Xmx`; cut allocations.

---

*End of handbook. Master the four pillars — memory model, GC, the two-stage compilation, and JDK
customization — and you'll handle any Java/Kotlin internals interview. ☕*
