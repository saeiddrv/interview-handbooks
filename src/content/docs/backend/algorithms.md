---
title: "Sorting & Searching Algorithms — Interview Handbook"
description: "Sorting and searching: time/space complexity, stability, and how Java/Kotlin use them — Arrays.sort, TimSort, binarySearch, hashing — with a Q&A bank."
sidebar:
  label: "Algorithms: Sort & Search"
---

> The algorithms senior+ interviews still ask about, made clear: every sorting and searching algorithm
> with its **time/space complexity, stability, and in-place** properties, *why* each one wins or loses,
> and — the part most guides skip — **how Java, Kotlin, and Spring Boot actually use them in real
> code** (`Arrays.sort` dual-pivot quicksort, **TimSort**, `Collections.sort`, `binarySearch`, hashing,
> database B-tree indexes). With a Q&A bank and cheat sheet.

---

## 1. Why This Still Matters (even with libraries)

You almost never hand-write a sort — the standard library does it better. So why learn this? Because
interviewers (and real debugging) test whether you understand **what the library is doing for you**:

- Which sort does `Arrays.sort` use, and why **two different** ones?
- Why is `Collections.sort` **stable** and what does that buy you?
- When is **O(n log n)** unavoidable, and when can you beat it (counting/radix)?
- Why is a `HashMap` lookup **O(1)** but a `TreeMap` lookup **O(log n)** — and when do you want the
  slower one?
- Why does a database use a **B-tree** index instead of a binary search tree?

> **Senior answer:** "I rarely implement these, but I constantly *choose* between data structures and
> understand the cost of library calls. Knowing the algorithm behind `Arrays.sort` or a DB index is what
> lets me reason about performance instead of guessing."

---

## 2. Big-O Refresher (the vocabulary)

Big-O describes how cost grows with input size `n`, ignoring constants. The ladder you must know cold:

| Complexity | Name | Example |
|---|---|---|
| O(1) | constant | HashMap get, array index |
| O(log n) | logarithmic | binary search, balanced-tree lookup |
| O(n) | linear | scan a list, linear search |
| O(n log n) | linearithmic | **the best general comparison sort** |
| O(n²) | quadratic | bubble/insertion sort, nested loops |
| O(2ⁿ), O(n!) | exponential/factorial | brute-force combinatorics |

Two facts interviewers probe:
- **Comparison sorts cannot beat O(n log n)** in the worst case — it's a proven lower bound (you can't
  sort by comparing faster than that).
- **Non-comparison sorts** (counting, radix) *can* hit O(n) — because they don't compare, they use the
  keys' structure (digits/buckets). The catch: they only work on integers/bounded keys.

> **Trap:** quoting "average" complexity when asked about worst case. Quicksort is O(n log n) *average*
> but **O(n²) worst case**; HashMap is O(1) *average* but O(n) (or O(log n) since Java 8) on collisions.

---

## 3. Sorting — the Properties That Decide

Before the algorithms, three properties that interviewers expect you to name:

- **Stability** — a stable sort keeps **equal elements in their original order**. Critical for
  multi-key sorting (sort by name, then *stably* by age → names stay ordered within each age).
- **In-place** — uses O(1) (or O(log n)) extra memory instead of allocating a second array.
- **Adaptive** — runs faster on already-partially-sorted data (TimSort and insertion sort do).

| Algorithm | Best | Average | Worst | Space | Stable? | Notes |
|---|---|---|---|---|---|---|
| Bubble | O(n) | O(n²) | O(n²) | O(1) | Yes | Teaching only |
| Selection | O(n²) | O(n²) | O(n²) | O(1) | No | Fewest swaps |
| Insertion | **O(n)** | O(n²) | O(n²) | O(1) | Yes | **Great for small/nearly-sorted** |
| Merge | O(n log n) | O(n log n) | **O(n log n)** | O(n) | **Yes** | Predictable; external sort |
| Quick | O(n log n) | O(n log n) | **O(n²)** | O(log n) | No | Fast in practice, in-place |
| Heap | O(n log n) | O(n log n) | O(n log n) | O(1) | No | Guaranteed, in-place |
| Counting | O(n+k) | O(n+k) | O(n+k) | O(k) | Yes | Integers in small range |
| Radix | O(nk) | O(nk) | O(nk) | O(n+k) | Yes | Fixed-width keys |
| **TimSort** | **O(n)** | O(n log n) | O(n log n) | O(n) | **Yes** | **Java/Python real-world default** |

---

## 4. The Sorts You Must Be Able to Explain

**Insertion sort** — build the sorted part one element at a time, shifting larger elements right. O(n²)
in general but **O(n) on nearly-sorted** data and very low overhead — which is why real libraries switch
to it for **small subarrays** (typically < ~32–47 elements).
- **Pros:** simple, stable, in-place, **adaptive** (near-O(n) on sorted data), tiny constant overhead →
  best for small/almost-sorted inputs.
- **Cons:** O(n²) on large or random data — useless as a general-purpose sort.

**Merge sort** — *divide* the array in half, sort each half, *merge* the two sorted halves.
**Guaranteed O(n log n)**, **stable**, but needs O(n) extra space. The basis of **external sorting**
(sorting data too big for RAM) and of Java's object sort.
- **Pros:** **guaranteed** O(n log n) (no bad-input worst case), **stable**, parallelizes well, works for
  external/disk sorting and linked lists.
- **Cons:** **O(n) extra memory**, not in-place, more data movement (worse cache locality than quicksort).

**Quicksort** — pick a **pivot**, *partition* into "less than" and "greater than", recurse. Fast and
in-place; average O(n log n). **Worst case O(n²)** when pivots are bad (e.g. already-sorted with a naive
first-element pivot). Mitigated by smart pivots (median-of-three, randomization, **dual-pivot**).
- **Pros:** **fastest in practice** (great cache locality), **in-place** (O(log n) stack), the default
  for primitives.
- **Cons:** **O(n²) worst case**, **not stable**, recursion-depth risk — needs good pivot selection to be
  safe.

**Heapsort** — build a max-heap, repeatedly extract the max. **Guaranteed O(n log n)** and **in-place**,
but not stable and cache-unfriendly (slower constants than quicksort in practice). Its real-world cousin
is the **priority queue**.
- **Pros:** **guaranteed** O(n log n) **and in-place** (the only common sort with both), no worst-case
  blowup, no extra memory.
- **Cons:** **not stable**, poor cache locality → slower constants than quicksort in practice.

**Counting / Radix** — non-comparison, O(n)-ish, for **integers / fixed-width keys**. Counting sort
tallies occurrences; radix sort sorts digit-by-digit (stably). Used in specialized high-throughput
paths, not general sorting.
- **Pros:** **beats O(n log n)** — linear time, stable.
- **Cons:** **only for integers/bounded keys**, extra O(k)/O(n+k) memory, useless for general objects or
  large key ranges.

> **Senior answer:** "Merge gives guaranteed O(n log n) and stability at the cost of memory; quicksort is
> faster in practice and in-place but has an O(n²) worst case; heapsort is the guaranteed in-place
> option. Real libraries combine them — quicksort/merge for the bulk, insertion for small runs."

---

## 5. How Java *Actually* Sorts (the key real-world section)

Java uses **two different algorithms** depending on what you're sorting — and the reason is the most
important practical insight here:

**Primitives → `Arrays.sort(int[])` uses Dual-Pivot Quicksort.**
- Primitives have **no notion of "equal but distinguishable"** (two `5`s are identical), so **stability
  is irrelevant** → Java picks the faster, in-place quicksort (dual-pivot, by Vladimir Yaroslavskiy).
- Worst case is O(n²) in theory, but the dual-pivot scheme with good pivot selection makes it extremely
  fast in practice. Small ranges fall back to **insertion sort**.

**Objects → `Arrays.sort(Object[])` / `Collections.sort(List)` uses TimSort.**
- Objects **can** be equal-but-distinct (two `Person`s with the same age), so the sort **must be
  stable** → Java uses **TimSort** (a hybrid of **merge sort + insertion sort**, by Tim Peters,
  originally from Python).
- TimSort is **adaptive**: it finds existing sorted "runs" and merges them, so already-sorted or
  partially-sorted data approaches **O(n)**. Worst case O(n log n), stable, uses O(n) temp space.

```java
int[] nums = {...};
Arrays.sort(nums);                       // dual-pivot quicksort (primitives)

List<Person> people = ...;
people.sort(Comparator.comparing(Person::age));   // TimSort (stable)
Collections.sort(people);                          // same, TimSort
```

> **This is the canonical interview question:** "Why does Java use quicksort for `int[]` but TimSort for
> `Object[]`?" → **Stability.** Primitives don't need it (faster quicksort wins); objects do (stable
> TimSort), and TimSort's adaptivity makes real-world, partially-ordered data near-linear.

> **Trap:** `Comparator` that isn't consistent (violates the contract — not transitive) makes TimSort
> throw `IllegalArgumentException: Comparison method violates its general contract!` at runtime. A real
> production bug worth recognizing.

---

## 6. How Kotlin Sorts

Kotlin sits on top of the JVM, so **the same engines run underneath** — but the API is richer and
returns **new collections** by default (functional style):

```kotlin
val sorted = list.sorted()                       // returns a NEW sorted list (TimSort under the hood)
val byAge  = people.sortedBy { it.age }          // new list, stable
val desc   = people.sortedByDescending { it.age }
list.sort()                                      // in-place, on a MutableList
val arr = intArrayOf(3,1,2); arr.sort()          // primitive IntArray → dual-pivot quicksort
```

- `sorted()/sortedBy {}` → **non-mutating**, returns a copy (uses stable TimSort via Java).
- `sort()` → **in-place** on a `MutableList`/array.
- `IntArray.sort()` and friends hit the **primitive dual-pivot quicksort** — same primitive/object split
  as Java.
- **Sequences:** `asSequence().sortedBy {}` still materializes for the sort (sorting is inherently a
  terminal, whole-collection operation) — it can't be lazy.

> **Nice to know:** Kotlin's `sortedBy` / `thenBy` make **multi-key stable sorting** trivial — and it
> *relies on* the underlying sort being stable (TimSort), the same property from §5.

---

## 7. Searching — Linear vs Binary vs Hashing

**Linear search** — scan until found. **O(n)**, works on **any** (even unsorted) data. The right choice
for small or unsorted collections.
- **Pros:** no precondition (works on unsorted data), no setup cost, simple, great for small inputs.
- **Cons:** **O(n)** — doesn't scale to large collections.

**Binary search** — repeatedly halve a **sorted** array. **O(log n)**, but **requires sorted data**.

```java
int i = Arrays.binarySearch(sortedArray, key);   // O(log n); array MUST be sorted
int j = Collections.binarySearch(sortedList, key);
```

- **Trap:** `binarySearch` on an **unsorted** array returns a *garbage* (undefined) result — no error,
  just wrong. Sort first.
- Classic implementation bug: `mid = (low + high) / 2` can **overflow**; use
  `mid = low + (high - low) / 2`. (This bug lived in the JDK for years.)
- On a miss, Java's `binarySearch` returns `-(insertionPoint) - 1` — useful for "find where it *would*
  go."
- **Pros:** **O(log n)**, no extra memory, and gives ordering/insertion-point info for free.
- **Cons:** **requires sorted data** (sorting first costs O(n log n)) and **random access** — bad on
  linked lists; re-sorting on every insert kills it for frequently-changing data.

**Hash-based lookup** — **O(1) average** via `HashMap`/`HashSet` (compute the bucket from `hashCode`).
The fastest lookup when you don't need order. O(n) worst case on bad collisions (Java 8+ degrades a
bucket to a balanced tree → O(log n)).
- **Pros:** **fastest point lookup (O(1) average)**, simple to use, ideal for caches/dedup/membership.
- **Cons:** **no ordering or range queries**, needs a good `hashCode`, O(n) worst case on collisions,
  extra memory for buckets/load factor.

**Tree-based lookup** — **O(log n)** via `TreeMap`/`TreeSet` (red-black tree). Slower than hashing but
keeps keys **sorted** and supports range queries (`headMap`, `tailMap`, `ceilingKey`).
- **Pros:** **sorted order + range queries** (floor/ceiling/head/tail), predictable O(log n), no resizing
  spikes.
- **Cons:** **slower than hashing** for point lookups, needs `Comparable`/`Comparator`, more per-node
  memory/pointer overhead.

| Search | Complexity | Requires | Gives you |
|---|---|---|---|
| Linear | O(n) | nothing | works on anything |
| Binary | O(log n) | **sorted** data | order, range |
| Hash (HashMap) | **O(1)** avg | good hashCode | fastest point lookup |
| Tree (TreeMap) | O(log n) | Comparable/Comparator | **sorted + range queries** |

> **Senior answer:** "Pick the search by the data and the need: hashing for fastest point lookups when
> order doesn't matter, a tree when I need sorted order or range queries, binary search when I already
> have a sorted array, linear when it's small or unsorted."

---

## 8. Real-World Usage in Java / Kotlin / Spring Boot

The part that makes this concrete — where these algorithms actually run in your app:

- **Every `list.sort()` / `stream().sorted()` / Kotlin `sortedBy {}`** → TimSort (objects) or dual-pivot
  quicksort (primitives). Sorting API results, leaderboards, search results, report rows.
- **`HashMap` / `HashSet`** → hashing (§7) — the workhorse behind caches, dedup, request routing, Spring
  bean lookups by name. **O(1)** is why they're everywhere.
- **`TreeMap` / `ConcurrentSkipListMap`** → balanced-tree/skip-list search — when you need **sorted
  iteration or range scans** (e.g. time-ordered events, rate-limit windows).
- **`PriorityQueue`** → a binary **heap** — schedulers, Dijkstra, "top-K", retry/delay queues,
  Spring's `@Scheduled`/task ordering.
- **Spring Boot ordering** — `@Order`, `Ordered`, `AnnotationAwareOrderComparator` **sort** beans,
  filters, and `HandlerInterceptor`s; Spring Security's filter chain is an **ordered, sorted** list. That
  ordering is a stable sort by order value.
- **Pagination & sorting in Spring Data** — `PageRequest.of(page, size, Sort.by("name"))` does **not**
  sort in the JVM; it pushes `ORDER BY` to the **database**, which sorts using its own engine and
  **B-tree indexes** (see below). Sorting at the DB with an index is O(log n) seek + ordered scan, vastly
  better than pulling rows and sorting in memory.
- **Database indexes are search algorithms** → a B-tree index (PostgreSQL/MySQL default) turns a
  full-table scan **O(n)** into an indexed lookup **O(log n)**. A hash index is O(1) for equality only.
  This is the single biggest real-world payoff of "search algorithm" knowledge — see the PostgreSQL
  handbook.
- **Why B-tree, not binary search tree?** Disk/page reads are the bottleneck; a **B-tree** is shallow and
  wide (hundreds of keys per node = one page), so it needs **far fewer disk reads** than a tall binary
  tree for the same `n`. Same O(log n) class, drastically better constants on disk.

> **Senior answer:** "In a Spring Boot app the sorts I care about usually run in the **database**, not the
> JVM — so I make sure the `ORDER BY` column is **indexed** (B-tree) and let the DB sort. In-memory I rely
> on `HashMap` for O(1) lookups and `PriorityQueue` (a heap) for scheduling and top-K."

---

## 9. Choosing the Right Tool (decision guide)

- **Need fastest point lookup, order doesn't matter** → `HashMap`/`HashSet` (hashing, O(1)).
- **Need sorted keys / range queries** → `TreeMap`/`TreeSet` (O(log n)).
- **Need to sort a collection** → just call `sort()` / `sorted()` — it's TimSort/quicksort already
  tuned; don't hand-roll.
- **Need top-K / scheduling / a queue by priority** → `PriorityQueue` (heap).
- **Sorting/paging persisted data** → do it in the DB with an **indexed `ORDER BY`**, not in the JVM.
- **Searching a sorted array** → `Arrays.binarySearch` (O(log n)); otherwise linear or a hash set.
- **Huge data that doesn't fit in RAM** → external **merge sort** (the DB / big-data engine does this).

---

## 10. Interview Q&A Bank

**Q: What's the lower bound for comparison-based sorting, and how do counting/radix beat it?**
> O(n log n) worst case for comparison sorts (proven). Counting/radix avoid comparisons — they exploit the
> key structure (range/digits) — reaching O(n)/O(nk), but only for integers/bounded keys.

**Q: Why does Java use quicksort for primitives but TimSort for objects?**
> Stability. Primitives have no equal-but-distinct elements, so stability is irrelevant and the faster
> in-place dual-pivot quicksort wins. Objects need stable ordering (multi-key sorts), so Java uses
> TimSort, which is stable and adaptive (near-O(n) on partially sorted data).

**Q: What is a stable sort and when does it matter?**
> It preserves the relative order of equal elements. It matters for multi-key sorting — e.g. sort by name,
> then stably by age, and names stay ordered within each age group.

**Q: Quicksort average vs worst case — and how do you avoid the worst case?**
> O(n log n) average, O(n²) worst (bad pivots, e.g. sorted input with first-element pivot). Avoid with
> randomized/median-of-three/dual-pivot pivot selection and insertion-sort fallback for small ranges.

**Q: Merge sort vs quicksort vs heapsort — tradeoffs?**
> Merge: guaranteed O(n log n), stable, O(n) space (external sort). Quick: fast in practice, in-place,
> O(n²) worst. Heap: guaranteed O(n log n), in-place, not stable, weaker constants.

**Q: Requirements and complexity of binary search?**
> Sorted data, O(log n). Watch the `(low+high)` overflow bug (use `low + (high-low)/2`) and never run it
> on unsorted data (undefined result).

**Q: Why is HashMap O(1) but TreeMap O(log n) — and when pick the slower one?**
> HashMap computes a bucket from hashCode (O(1) average); TreeMap walks a red-black tree (O(log n)).
> Choose TreeMap when you need sorted iteration or range queries; HashMap when you just need fast lookups.

**Q: Why do databases use B-tree indexes instead of binary search trees?**
> Disk I/O dominates. A B-tree is shallow and wide (many keys per page), so it needs far fewer disk reads
> than a tall binary tree for the same data — same O(log n) class, much better real-world constants.

**Q: In a Spring Boot app, where does sorting actually happen?**
> Usually in the database: `Sort`/`PageRequest` becomes `ORDER BY`, sorted via the DB engine and B-tree
> indexes — far cheaper than loading rows and sorting in the JVM. In-memory sorts use TimSort/quicksort.

**Q: Where do heaps show up in real frameworks?**
> `PriorityQueue` (a binary heap) backs schedulers, delay/retry queues, top-K, and graph algorithms like
> Dijkstra; framework task ordering and Spring's scheduling rely on ordered/priority structures.

**Q: What does Spring's @Order do under the hood?**
> It assigns an order value; Spring stably sorts beans/filters/interceptors with
> `AnnotationAwareOrderComparator` — a comparison sort over the order values (e.g. the security filter
> chain).

---

## 11. Cheat Sheet

- **Big-O ladder:** O(1) → O(log n) → O(n) → **O(n log n)** → O(n²) → exponential. Comparison sorts
  can't beat **O(n log n)**; counting/radix hit O(n) for bounded-integer keys.
- **Sort properties:** **stable** (keeps equal order — needed for multi-key), **in-place** (O(1) space),
  **adaptive** (faster on sorted data).
- **Merge** = guaranteed O(n log n), stable, O(n) space, external sort. **Quick** = fast/in-place, O(n²)
  worst. **Heap** = guaranteed O(n log n), in-place. **Insertion** = O(n) on small/nearly-sorted.
- **Java sort split:** **primitives → dual-pivot quicksort** (stability irrelevant); **objects →
  TimSort** (stable + adaptive). Same under Kotlin (`sorted()` copy vs `sort()` in-place).
- **Search:** linear O(n) (anything) · **binary O(log n)** (sorted; watch overflow) · **hash O(1)**
  (HashMap, no order) · **tree O(log n)** (TreeMap, sorted + range).
- **Real life:** `list.sort()`→TimSort; `HashMap`→hashing O(1) (caches/dedup/bean lookup);
  `PriorityQueue`→heap (scheduling/top-K); **Spring `@Order`** = stable sort of beans/filters;
  **Spring Data `Sort`/paging** → DB `ORDER BY` on a **B-tree index** (O(log n)); huge data → external
  merge sort.
- **B-tree over BST on disk:** shallow + wide → fewer page reads; the foundation of database indexes.

---

*End of handbook. The signal: you don't reinvent sorts, but you **know what the library does and why** —
quicksort-vs-TimSort by stability, the O(n log n) lower bound, and where these run in real systems
(`HashMap` lookups, `PriorityQueue` schedulers, and — most importantly — **indexed `ORDER BY` in the
database** rather than sorting in the JVM).*
