---
title: "Java & Kotlin Data Structures — Advanced Interview Handbook"
description: "A deep guide to Java collections and Kotlin data structures: every implementation, its internals, time/space complexity, when (and when not) to use it, the version that introduced it, and the why behind the choices — HashMap vs TreeMap, ArrayList vs LinkedList, ConcurrentHashMap internals, Kotlin read-only vs mutable, sequences — with a Q&A bank."
sidebar:
  label: "Java & Kotlin Data Structures"
---

> A deep, practical guide to data structures in Java and Kotlin: the Collections Framework map, every
> List/Set/Map/Queue implementation with its internals, Big-O, the version that introduced it, and the
> real decision of *when and why* to pick it (HashMap vs TreeMap, ArrayList vs LinkedList, ArrayDeque
> vs Stack, ConcurrentHashMap internals), the equals/hashCode contract, concurrency, immutability — and
> a full pass on Kotlin's read-only vs mutable collections and lazy sequences — plus a Q&A bank.

---

## 1. The Collections Framework — The Map

Java's `java.util` collections sit under a few **interfaces** (the contract) with multiple
**implementations** (the tradeoffs). Pick by interface first, implementation second.

```
Iterable
 └─ Collection
     ├─ List      (ordered, indexed, duplicates)      → ArrayList, LinkedList, Vector, CopyOnWriteArrayList
     ├─ Set       (no duplicates)                      → HashSet, LinkedHashSet, TreeSet, EnumSet
     └─ Queue     (FIFO/priority)                      → ArrayDeque, PriorityQueue, LinkedList
         └─ Deque (double-ended)                       → ArrayDeque, LinkedList

Map  (key → value, NOT a Collection)                   → HashMap, LinkedHashMap, TreeMap, Hashtable,
                                                          ConcurrentHashMap, EnumMap, WeakHashMap
```

**Key fact:** `Map` is **not** a `Collection` — it's a separate hierarchy because it stores
*pairs*, not elements.

> **What they're testing:** whether you choose by *required behavior* (ordering? sorting? uniqueness?
> concurrency?) rather than reaching for `ArrayList`/`HashMap` reflexively.

---

## 2. Big-O Cheat Table (memorize this)

| Structure | get/access | search | insert | delete | Ordering | Notes |
|---|---|---|---|---|---|---|
| **ArrayList** | O(1) | O(n) | O(1) amortized at end, O(n) middle | O(n) | Insertion (indexed) | Contiguous array |
| **LinkedList** | O(n) | O(n) | O(1) at ends | O(1) at ends | Insertion | Doubly linked; also a Deque |
| **HashMap / HashSet** | O(1) avg | O(1) avg | O(1) avg | O(1) avg | None | O(log n) worst (treeified bucket) |
| **LinkedHashMap/Set** | O(1) avg | O(1) avg | O(1) avg | O(1) avg | Insertion / access | HashMap + linked list |
| **TreeMap / TreeSet** | O(log n) | O(log n) | O(log n) | O(log n) | **Sorted** | Red-black tree |
| **ArrayDeque** | O(1) ends | O(n) | O(1) ends | O(1) ends | Insertion | Best stack & queue |
| **PriorityQueue** | O(1) peek | O(n) | O(log n) | O(log n) | **Heap order** | Binary min-heap |

> **Trap:** "LinkedList is faster for inserts." Only at the **ends**, or when you already hold the
> node. Inserting "in the middle" still costs O(n) to *walk there*. In practice `ArrayList` wins
> almost always due to cache locality.

---

## 3. List Implementations

**ArrayList** *(Java 1.2)* — a resizable array. **Default choice for lists.**
- O(1) random access and amortized O(1) append; O(n) insert/remove in the middle (shifts elements).
- Backing array grows by **~1.5×** when full (`newCap = old + old>>1`). Default capacity 10, allocated
  lazily on first add (since Java 8). Pre-size with `new ArrayList<>(expectedSize)` to avoid resizes.
- Not thread-safe.
- **Use when:** you index, iterate, and append — i.e. nearly always.

**LinkedList** *(Java 1.2)* — a doubly-linked list; also implements `Deque`.
- O(1) insert/remove at head/tail (or via an iterator's current node); **O(n) random access**.
- High memory overhead (two pointers per node) and poor cache locality.
- **Use when:** you genuinely need a queue/deque from both ends *and* aren't using `ArrayDeque` — which
  is rare. In modern code, prefer `ArrayDeque`.

> **Senior answer (ArrayList vs LinkedList):** "I default to `ArrayList`. `LinkedList` only wins for
> frequent add/remove at the ends, but `ArrayDeque` does that faster with less memory. `LinkedList`'s
> O(1) middle-insert is a myth in practice because you pay O(n) to *find* the position, and its cache
> behavior is terrible."

**Vector / Stack** *(Java 1.0, legacy)* — synchronized `ArrayList`/LIFO. **Avoid.** Every method is
synchronized (slow, coarse-grained). For a stack use `ArrayDeque`; for thread-safety use a concurrent
collection.

**CopyOnWriteArrayList** *(Java 5)* — thread-safe; every write copies the whole array.
- Reads are lock-free and never see a `ConcurrentModificationException`.
- **Use when:** **read-mostly** data with rare writes (e.g. listener/observer lists). Writes are O(n)
  and expensive.

---

## 4. Set Implementations

**HashSet** *(Java 1.2)* — backed by a `HashMap` (elements are keys). O(1) ops, **no ordering**.
Default uniqueness set.

**LinkedHashSet** *(Java 1.4)* — `HashSet` + linked list → **predictable insertion-order** iteration,
still O(1). Use when you want dedup *and* stable order.

**TreeSet** *(Java 1.2)* — backed by `TreeMap` (red-black tree). **Sorted**, O(log n). Implements
`NavigableSet` → `first()`, `last()`, `ceiling()`, `floor()`, `headSet()`, `tailSet()`, range views.
Use when you need elements in sorted order or range queries. Elements must be `Comparable` or you pass
a `Comparator`. **No nulls** (can't compare).

**EnumSet** *(Java 5)* — ultra-fast set for enum values, internally a **bit vector** (a `long`). Tiny
and blazing. **Always** prefer it over `HashSet<MyEnum>`.

**CopyOnWriteArraySet** *(Java 5)* — `CopyOnWriteArrayList` semantics for sets; read-mostly.

---

## 5. Map Implementations

**HashMap** *(Java 1.2)* — hash table, **the default map**. O(1) average. Allows **one null key** and
multiple null values. Unordered. (Internals in §7.)

**LinkedHashMap** *(Java 1.4)* — `HashMap` + a doubly-linked list across entries → **insertion-order**
iteration (or **access-order** with `new LinkedHashMap<>(cap, lf, true)`). Override `removeEldestEntry`
to build a simple **LRU cache**:

```java
// Bounded LRU cache in ~5 lines
Map<K,V> lru = new LinkedHashMap<>(16, 0.75f, true) {  // accessOrder = true
    protected boolean removeEldestEntry(Map.Entry<K,V> e) { return size() > MAX; }
};
```

**TreeMap** *(Java 1.2)* — red-black (self-balancing BST). **Sorted by key**, O(log n). `NavigableMap`:
`firstKey`, `ceilingKey`, `floorKey`, `subMap`, range scans. Use for ordered iteration / range queries.

**Hashtable** *(Java 1.0, legacy)* — synchronized `HashMap`, **no nulls**. **Avoid** — use
`ConcurrentHashMap` for concurrency, `HashMap` otherwise.

**ConcurrentHashMap** *(Java 5)* — thread-safe, high-concurrency map. **No null keys/values.** The
go-to concurrent map. (Internals in §11.)

**EnumMap** *(Java 5)* — array-indexed by enum ordinal; extremely fast and compact. Prefer over
`HashMap<MyEnum, V>`.

**WeakHashMap** *(Java 1.2)* — keys held by **weak references**; an entry vanishes when its key is no
longer referenced elsewhere. Use for **caches / canonicalizing maps** that shouldn't prevent GC.

**IdentityHashMap** *(Java 1.4)* — compares keys with `==` not `equals()`. Niche (serialization graphs,
identity tracking).

---

## 6. Why HashMap, Not "Hash Tree"? (the canonical question)

The interviewer usually means **HashMap vs TreeMap**. The answer is about the **access pattern and the
cost of ordering**:

| | HashMap (hash table) | TreeMap (red-black tree) |
|---|---|---|
| Lookup/insert/delete | **O(1) average** | O(log n) |
| Ordering | **None** | **Sorted by key** |
| Needs | good `hashCode`/`equals` | `Comparable`/`Comparator` |
| Nulls | one null key OK | no null keys |
| Memory | array of buckets | node per entry (left/right/parent/color) |

- **Use `HashMap`** when you just need fast key→value lookup and **don't care about order** — which is
  the overwhelming majority of cases. Hashing gives near-constant time; a tree pays a `log n` factor on
  *every* operation to maintain an order you don't need.
- **Use `TreeMap`** only when you need keys **sorted** or **range/nearest queries** (`ceilingKey`,
  `subMap`, "all events between t1 and t2"). You pay O(log n) for that capability.

> **Senior answer:** "Default to `HashMap` — O(1) lookups, and most code doesn't need ordering. I
> switch to `TreeMap` only when I need sorted iteration or range/floor/ceiling queries, accepting the
> O(log n) cost. If I need insertion-order *and* O(1), that's `LinkedHashMap`, not a tree."

> **Nice to know:** since **Java 8**, a single *over-full HashMap bucket* converts from a linked list
> to a **red-black tree** — so a pathological bucket degrades to O(log n) instead of O(n). So HashMap
> already borrows the tree trick *locally*, without paying for global ordering.

---

## 7. HashMap Internals (deep dive)

A `HashMap` is an **array of buckets** (`Node[] table`). To store a key:

1. Compute `h = key.hashCode()`, then **spread** it: `h ^ (h >>> 16)` (mixes high bits into low bits so
   that masking with the table size still uses the entropy of the high bits).
2. Index = `h & (capacity - 1)` (capacity is always a power of two, so this is a fast modulo).
3. Walk the bucket: if a key `equals()` an existing one, **replace**; else **append**.

**Load factor & resize.** Default capacity **16**, load factor **0.75**. When
`size > capacity × loadFactor` (e.g. 12 of 16), the table **doubles** and all entries are **rehashed**
into the new, larger array. 0.75 balances space vs collision rate. Pre-size to avoid repeated resizes:
`new HashMap<>(expectedSize / 0.75 + 1)`.

**Treeification (Java 8).** If one bucket exceeds **8 entries** (`TREEIFY_THRESHOLD`) **and** the table
is at least **64** (`MIN_TREEIFY_CAPACITY`), that bucket becomes a **red-black tree** → worst case per
bucket drops from O(n) to O(log n). Below 64, it resizes instead. Shrinks back to a list at **6 entries**
(`UNTREEIFY_THRESHOLD`). This hardened HashMap against hash-collision DoS attacks.

**Java 7 → 8 change (a great interview detail).** Java 7 inserted at the bucket **head** and could form
a **cycle during concurrent resize**, causing an infinite loop (100% CPU). Java 8 inserts at the
**tail** and preserves relative order on resize, eliminating that specific hazard. (`HashMap` is still
**not** thread-safe — use `ConcurrentHashMap`.)

**Nulls:** one `null` key (stored in bucket 0), any number of null values.

**Fail-fast:** modifying the map during iteration (outside the iterator) throws
`ConcurrentModificationException` via a `modCount` check — a bug detector, not a concurrency guarantee.

> **What they're testing:** do you understand that "O(1)" depends on a **good hash distribution** and
> the **load factor**, and that bad `hashCode()` collapses everything into one bucket?

---

## 8. The equals / hashCode Contract (non-negotiable)

Hash-based collections (`HashMap`, `HashSet`) break silently if this contract is violated:

1. If `a.equals(b)` then `a.hashCode() == b.hashCode()` — **equal objects must have equal hashes.**
2. Unequal objects *may* share a hash (collision), but good hashes spread out.
3. Both must be **consistent** and based on the **same fields**.

**Consequences of getting it wrong:**
- Override `equals` but **not** `hashCode` → two "equal" keys land in different buckets → `map.get(key)`
  returns `null` even though you put it there. The #1 collections bug.
- Use a **mutable field** in `hashCode` and then mutate the key after inserting → it's lost in the wrong
  bucket. **Keys should be effectively immutable.**

```java
record Point(int x, int y) {}   // Java 16 records: correct equals/hashCode for free
```

> **Senior answer:** "Any object used as a `HashMap` key or `HashSet` element must override `equals`
> **and** `hashCode` together, derived from the same immutable fields. Records (Java 16) or Kotlin
> `data class` give you that automatically."

---

## 9. Queues, Deques & Heaps

**ArrayDeque** *(Java 6)* — resizable circular array. **The best general stack and queue.**
- O(1) at both ends; no capacity limit; **no nulls**.
- **Faster than `Stack`** (use `push`/`pop`) and **faster than `LinkedList`** as a queue (better cache
  locality, less garbage).
- **Senior move:** "For a stack I use `ArrayDeque`, not the legacy synchronized `Stack`."

**PriorityQueue** *(Java 5)* — a **binary heap** (array-backed). `offer`/`poll` O(log n), `peek` O(1).
Orders by natural order or a `Comparator`. **Not** sorted on iteration — only the head is the min.
Use for Dijkstra, top-K, schedulers, merge-k-lists.

**BlockingQueue** family *(Java 5, `java.util.concurrent`)* — thread-safe producer/consumer queues:
`ArrayBlockingQueue` (bounded), `LinkedBlockingQueue`, `PriorityBlockingQueue`, `SynchronousQueue`
(hand-off, used by cached thread pools), `DelayQueue`. Backbone of thread pools.

---

## 10. Comparable vs Comparator

- **`Comparable<T>`** — *natural* order, implemented **on the class** (`compareTo`). One per type.
  Used by `TreeMap`/`TreeSet`/`Collections.sort` by default.
- **`Comparator<T>`** — an *external*, swappable ordering. Many per type. Modern style:

```java
list.sort(Comparator.comparing(User::lastName)
                    .thenComparing(User::firstName)
                    .reversed());
```

> **Trap:** an inconsistent comparator (not transitive, or `compare` disagreeing with `equals`) causes
> `TreeMap` to "lose" keys or throws "Comparison method violates its general contract."

---

## 11. Concurrent Collections (the staff-level part)

`HashMap` under concurrent writes corrupts or loops. Options:

**ConcurrentHashMap** *(Java 5, rewritten Java 8)* — the default concurrent map.
- **Java 7:** **segmented** (lock striping) — 16 segments, each independently locked → up to 16
  concurrent writers.
- **Java 8:** segments removed. Per-bucket concurrency: **CAS** for empty-bucket inserts,
  `synchronized` on the **bucket head** for collisions, plus the same treeification. Far higher
  concurrency and simpler.
- **No null keys/values** (a null return must unambiguously mean "absent" in a concurrent setting).
- Atomic compound ops: `computeIfAbsent`, `merge`, `compute` — use these instead of check-then-act.
- Iterators are **weakly consistent** (no `ConcurrentModificationException`; reflect some-but-maybe-not-
  all concurrent updates).

**ConcurrentSkipListMap / ...Set** *(Java 6)* — concurrent **sorted** map/set (a `TreeMap` alternative
under concurrency), O(log n), lock-free skip list.

**CopyOnWriteArrayList / ...Set** *(Java 5)* — read-mostly, snapshot-on-write.

**`Collections.synchronizedMap(...)`** — wraps a map with one global lock. Coarse and slow; prefer
`ConcurrentHashMap`. Also still requires manual synchronization when *iterating*.

> **Senior answer:** "For shared mutable maps I use `ConcurrentHashMap` with atomic `computeIfAbsent`/
> `merge`, never `Hashtable` or `synchronizedMap`. Since Java 8 it locks per-bucket with CAS, so reads
> are lock-free and writers only contend on the same bucket."

---

## 12. Immutable & Unmodifiable Collections

- **`List.of()`, `Set.of()`, `Map.of()`** *(Java 9)* — truly immutable, compact factories. **No nulls**,
  and `Set.of`/`Map.of` reject duplicate keys. Prefer these for constants.
- **`List.copyOf(coll)`** *(Java 10)* — immutable snapshot copy.
- **`Collections.unmodifiableList(...)`** *(Java 1.2)* — a read-only **view** over a mutable list; the
  backing list can still change. Weaker than `List.of`.

> **Trap:** "unmodifiable" ≠ "immutable." `unmodifiableList` only blocks the *view*; mutate the original
> and the view changes. `List.of` is genuinely immutable.

---

## 13. Version Timeline (when each arrived)

| Version | Added |
|---|---|
| **Java 1.0–1.1** | `Vector`, `Stack`, `Hashtable`, `Enumeration` (legacy) |
| **Java 1.2** | **Collections Framework**: `List`/`Set`/`Map`, `ArrayList`, `LinkedList`, `HashMap`, `HashSet`, `TreeMap`, `TreeSet`, `Collections`, `WeakHashMap` |
| **Java 1.4** | `LinkedHashMap`, `LinkedHashSet`, `IdentityHashMap` |
| **Java 5** | **Generics**, `java.util.concurrent`: `ConcurrentHashMap`, `CopyOnWriteArrayList`, `BlockingQueue`, `PriorityQueue`, `EnumMap`, `EnumSet`, `Queue` |
| **Java 6** | `ArrayDeque`, `NavigableMap`/`NavigableSet`, `ConcurrentSkipListMap`/`Set` |
| **Java 8** | HashMap **treeification** + resize fix, `ConcurrentHashMap` rewrite, default methods, **Streams**, `Map.computeIfAbsent`/`merge`/`getOrDefault` |
| **Java 9** | `List.of`/`Set.of`/`Map.of` immutable factories |
| **Java 10** | `List.copyOf`, `Collectors.toUnmodifiableList` |
| **Java 16** | **`record`** (auto equals/hashCode for keys) |
| **Java 21** | **Sequenced collections** (`SequencedCollection`/`SequencedMap`: `getFirst`/`getLast`/`reversed`) |

---

## 14. Kotlin Collections (this is important)

Kotlin **does not** ship its own collection runtime — at runtime these **are** the Java collections
(`ArrayList`, `HashMap`, …). What Kotlin adds is a **type-level distinction** and a rich standard library.

**Read-only vs mutable interfaces (the key idea):**

```kotlin
val a: List<Int>        = listOf(1, 2, 3)        // read-only interface
val b: MutableList<Int> = mutableListOf(1, 2, 3) // can add/remove
b.add(4)                                          // OK
// a.add(4)  // compile error — List has no add()
```

- `List`, `Set`, `Map` are **read-only**; `MutableList`, `MutableSet`, `MutableMap` extend them with
  mutators. This is **compile-time** safety — it expresses *intent* (you won't modify this).
- **Crucial nuance:** read-only is **not immutable**. A `List<Int>` can be a *view* over a
  `MutableList`; someone holding the mutable reference can still change it, and you'll see it. It also
  doesn't deep-freeze the elements. (Truly immutable collections need the
  `kotlinx.collections.immutable` library or `List.of` interop.)

**Builders:**

```kotlin
listOf(1, 2, 3)            // read-only List (backed by ArrayList/Arrays)
mutableListOf<Int>()       // ArrayList
setOf("a"); mutableSetOf() // LinkedHashSet (preserves order!)
mapOf("k" to 1)            // read-only Map; LinkedHashMap-backed
mutableMapOf()             // LinkedHashMap
hashMapOf(); linkedMapOf(); sortedMapOf()      // explicit Java types
hashSetOf(); linkedSetOf(); sortedSetOf()
buildList { add(1); add(2) }                   // Kotlin 1.6: build then freeze to read-only
emptyList(); arrayListOf()
```

> **Nice to know:** Kotlin's default `setOf`/`mapOf` are **insertion-ordered** (`LinkedHashSet`/
> `LinkedHashMap`), unlike Java's `HashSet`/`HashMap`. Predictable iteration by default.

**`data class` = correct keys for free** — auto-generates `equals`/`hashCode`/`toString` from the
primary-constructor properties, so a `data class` is immediately safe as a `HashMap` key:

```kotlin
data class Point(val x: Int, val y: Int)   // equals/hashCode generated
```

**Arrays vs collections in Kotlin:** `Array<T>` is a fixed-size object array. For primitives use
**`IntArray`, `LongArray`, `DoubleArray`, …** — these compile to Java `int[]`/`long[]` with **no
boxing** (use them in hot numeric loops; `List<Int>` boxes each element).

---

## 15. Kotlin Sequences vs Collections (lazy vs eager)

Kotlin collection operators (`map`, `filter`, …) are **eager**: each step builds a new intermediate
list. For long chains over large data, that's wasteful.

```kotlin
// EAGER: creates an intermediate List after filter, then again after map
val r1 = list.filter { it > 0 }.map { it * 2 }.take(5)

// LAZY: processes element-by-element, stops after 5 — like Java Streams
val r2 = list.asSequence().filter { it > 0 }.map { it * 2 }.take(5).toList()
```

- **`Sequence<T>`** is Kotlin's lazy pipeline (analogous to Java `Stream`). Operations are fused and run
  **per element**, with **short-circuiting** (`take`, `first`) — no intermediate collections.
- **Use sequences when:** the data is large, the chain has multiple steps, or you can short-circuit.
- **Use plain collections when:** data is small — sequences add per-element overhead and aren't worth it.
- Build with `asSequence()`, `generateSequence { ... }`, or the `sequence { yield(...) }` coroutine
  builder (infinite/lazy generation).

> **Senior answer:** "Same rule as Java Streams: go lazy with `asSequence()` for large multi-step
> pipelines or when short-circuiting; stay eager for small collections where the overhead isn't worth
> it."

---

## 16. Decision Guide (say this structure out loud)

- **Need key → value, don't care about order?** → `HashMap` (Kotlin `mutableMapOf`/`hashMapOf`).
- **Need keys sorted / range queries?** → `TreeMap` (`NavigableMap`).
- **Need insertion order + O(1)?** → `LinkedHashMap` / `LinkedHashSet`.
- **Need an LRU cache?** → `LinkedHashMap(accessOrder=true)` + `removeEldestEntry`.
- **Need a list you index and append?** → `ArrayList`.
- **Need a stack or queue?** → `ArrayDeque` (not `Stack`/`LinkedList`).
- **Need a priority/top-K?** → `PriorityQueue`.
- **Enum keys/values?** → `EnumMap` / `EnumSet`.
- **Concurrent map?** → `ConcurrentHashMap` (sorted+concurrent → `ConcurrentSkipListMap`).
- **Read-mostly shared list?** → `CopyOnWriteArrayList`.
- **Cache that mustn't pin memory?** → `WeakHashMap`.
- **Constant/immutable?** → `List.of`/`Map.of` (Java 9) / Kotlin `listOf` + intent via read-only type.

---

## 17. Interview Q&A Bank

**Q: HashMap vs TreeMap — when each?**
> HashMap for O(1) unordered key lookup (the default). TreeMap (red-black tree) for O(log n) when you
> need sorted keys or range/floor/ceiling queries. Don't pay log n for ordering you don't need.

**Q: ArrayList vs LinkedList?**
> ArrayList (array) for indexing/iteration/append — almost always, thanks to cache locality. LinkedList
> only for frequent end operations, and even then ArrayDeque is better. "O(1) middle insert" ignores the
> O(n) walk to the position.

**Q: How does HashMap work internally?**
> Array of buckets; index = spread(hash) & (capacity-1). Collisions chain in a list, treeified to a
> red-black tree past 8 entries (table ≥ 64) since Java 8. Default capacity 16, load factor 0.75; doubles
> and rehashes when exceeded.

**Q: What changed in HashMap in Java 8?**
> Buckets treeify under heavy collision (O(n)→O(log n)); insertion moved from head to tail, fixing the
> Java 7 concurrent-resize infinite-loop. Still not thread-safe.

**Q: Why must equals and hashCode be overridden together?**
> Hash collections locate keys by hashCode then confirm with equals. Override one without the other and
> equal keys land in different buckets — get() returns null. Use immutable fields; records/data classes
> generate both.

**Q: Can HashMap keys be null? ConcurrentHashMap?**
> HashMap: one null key, many null values. ConcurrentHashMap and Hashtable: no nulls (ambiguous "absent
> vs null" under concurrency).

**Q: How does ConcurrentHashMap achieve thread safety?**
> Java 7: lock striping over ~16 segments. Java 8: per-bucket — CAS for empty buckets, synchronized on
> the bucket head for collisions, plus treeification. Reads are lock-free; iterators weakly consistent.

**Q: Stack vs ArrayDeque?**
> Stack is legacy and synchronized (slow). ArrayDeque is the modern stack and queue — O(1) ends, no
> locking, better locality. No nulls.

**Q: How do you build an LRU cache with the JDK?**
> LinkedHashMap with accessOrder=true, overriding removeEldestEntry to cap size. O(1) get/put with
> automatic eviction of the least-recently-accessed entry.

**Q: PriorityQueue ordering on iteration?**
> It's a binary heap — only the head is guaranteed minimum. Iterating does NOT yield sorted order; poll
> repeatedly (O(log n) each) for sorted output.

**Q: unmodifiableList vs List.of?**
> unmodifiableList is a read-only *view* — the backing list can still change. List.of (Java 9) is truly
> immutable and rejects nulls.

**Q: Kotlin List vs MutableList — is List immutable?**
> No. List is a *read-only interface* (no mutators) but the underlying object can be mutable and change
> via another reference. It expresses intent, not immutability. Use kotlinx.collections.immutable for
> real immutability.

**Q: Kotlin sequences vs collection operators?**
> Collection ops are eager (intermediate lists per step). Sequences are lazy, fused, per-element, and
> short-circuit — like Java Streams. Use sequences for large multi-step/short-circuiting pipelines.

**Q: Why IntArray over List<Int> in Kotlin?**
> IntArray compiles to Java int[] with no boxing; List<Int> boxes every element. Use primitive arrays in
> hot numeric loops.

---

## 18. Cheat Sheet

- **Pick by interface first:** List (ordered/indexed), Set (unique), Map (key→value), Queue/Deque.
- **Defaults:** `ArrayList`, `HashMap`/`HashSet`, `ArrayDeque` (stack & queue).
- **HashMap:** array of buckets, cap 16 / load 0.75, doubles on resize; **treeify > 8 (table ≥ 64)**
  since **Java 8**; one null key. O(1) avg, O(log n) worst.
- **HashMap vs TreeMap:** O(1) unordered vs O(log n) **sorted/range**. LinkedHashMap = insertion/access
  order + O(1) (→ LRU via `removeEldestEntry`).
- **equals + hashCode together**, immutable key fields. Records / Kotlin `data class` = free & correct.
- **ArrayList ≫ LinkedList** in practice (locality); LinkedList only for end ops → prefer **ArrayDeque**.
- **PriorityQueue** = binary heap, O(log n), head-only min.
- **Concurrency:** `ConcurrentHashMap` (Java 8: per-bucket CAS + synchronized; no nulls; atomic
  `computeIfAbsent`/`merge`). Sorted+concurrent → `ConcurrentSkipListMap`. Read-mostly →
  `CopyOnWriteArrayList`. Avoid `Hashtable`/`Vector`/`synchronizedMap`.
- **EnumMap/EnumSet** for enums (bit-vector/array fast). **WeakHashMap** for GC-friendly caches.
- **Immutability:** `List.of`/`Map.of` (Java 9) truly immutable; `unmodifiableX` is just a view.
- **Kotlin:** read-only `List`/`Set`/`Map` vs `MutableX` (intent, **not** immutability); default
  `setOf`/`mapOf` are insertion-ordered; **`IntArray` etc. avoid boxing**; **`Sequence` = lazy** (use for
  big multi-step pipelines).
- **Versions:** Framework=1.2 · concurrent/EnumX/PriorityQueue=5 · ArrayDeque/Navigable=6 ·
  treeify+CHM-rewrite+streams=8 · `of()` factories=9 · records=16 · sequenced collections=21.

---

*End of handbook. The signal: never reach for a structure reflexively — name the **access pattern**
(ordered? sorted? unique? concurrent? range?), pick the implementation whose **complexity and guarantees
match**, and be ready to defend "HashMap over TreeMap" with O(1) vs O(log n) and "I don't need ordering."
Know the **Java 8 HashMap internals** and **Kotlin's read-only-vs-mutable** distinction cold.*
