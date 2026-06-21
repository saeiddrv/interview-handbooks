---
title: "Java & Kotlin Language Tricky Points — Interview Handbook"
description: "Java and Kotlin language traps: equals/hashCode, String pool, Integer cache, autoboxing, serialization, and visibility rules — with a Q&A bank."
sidebar:
  label: "Language Tricky Points"
---

> The low-level Java/Kotlin details that trip people up and that interviewers love: **access modifiers
> (Java vs Kotlin)**, the **Object (Java) / Any (Kotlin)** root class and **which methods you can
> override and why**, **inheritance tricks** (override vs overload vs hide) and **how `static` dodges
> polymorphism**, **`equals` vs `==`** (and
> Kotlin's **`==` vs `===`**), the **`equals`/`hashCode` contract**, **String immutability**, the
> **string pool & interning**, the **Integer cache** and autoboxing traps, **`clone` vs copy** (shallow
> vs deep), **pass-by-value**, and **serialization** — explained simply with the gotchas, plus a Q&A
> bank. (Pairs with the Data Structures and JVM Internals handbooks.)

---

## 1. The Object Class — Root of Every Class

In Java, **every class implicitly extends `java.lang.Object`** (Kotlin's root is **`Any`**, which maps to
`Object` on the JVM). So every object inherits a fixed set of methods. Knowing **which you can override**
is a classic question:

| Method | Override? | Purpose |
|---|---|---|
| `equals(Object)` | **Yes** | Logical equality |
| `hashCode()` | **Yes** | Hash bucket / must match `equals` |
| `toString()` | **Yes** | Human-readable form |
| `clone()` | Yes (protected) | Shallow copy (discouraged — §11) |
| `finalize()` | Yes (**deprecated**) | Pre-GC cleanup (don't — §14) |
| `getClass()` | **No (final)** | Runtime class |
| `wait()/notify()/notifyAll()` | **No (final)** | Thread coordination (see Concurrency handbook) |

> **Senior answer:** "Every class extends `Object`, so it inherits `equals`, `hashCode`, `toString`,
> `clone`, `finalize`, `getClass`, and the `wait`/`notify` family. I can override the first five;
> `getClass` and the `wait`/`notify` methods are **`final`**. In practice I override `equals`/`hashCode`/
> `toString` and avoid `clone`/`finalize`."

**Kotlin note:** `Any` defines only **`equals`, `hashCode`, `toString`** — the `wait`/`notify` methods
are **not** on `Any` (they come from `Object` and require a Java cast), reflecting that Kotlin steers you
to coroutines instead of low-level monitors.

---

## 2. Access Modifiers & Visibility

Who can see a class, method, or field. **Java has four levels** (note the default is *not* public):

| Modifier | Same class | Same package | Subclass (other pkg) | Everywhere |
|---|---|---|---|---|
| `private` | Yes | No | No | No |
| *(none = package-private)* | Yes | **Yes** | No | No |
| `protected` | Yes | Yes | **Yes** | No |
| `public` | Yes | Yes | Yes | **Yes** |

- **Default = package-private** (no keyword) — the most-forgotten level; visible within the same package
  only.
- **`protected`** = package **+** subclasses (even in other packages) — broader than people think.
- **Top-level classes** can only be `public` or package-private (not `private`/`protected`); only
  **nested** classes can be `private`/`protected`.
- **Encapsulation rule:** fields `private`, expose via methods. Public mutable fields leak invariants.

**Kotlin has four levels too — but different ones** (and a different default):

| Modifier | Visibility |
|---|---|
| `public` *(default)* | Everywhere |
| `internal` | Same **module** (compilation unit) |
| `protected` | Class **+ subclasses** (NOT the package) |
| `private` | Class — or **file**, for top-level declarations |

Key Java→Kotlin differences (classic question):
- **Default is `public`** in Kotlin (vs package-private in Java).
- **No package-private**; Kotlin replaces it with **`internal`** (module-scoped) — great for library APIs.
- **`protected` does NOT include the package** in Kotlin (subclasses only).
- **Top-level `private`** means **file-private**.

> **Senior answer:** "The trap is the defaults: Java defaults to **package-private**, Kotlin to
> **public**. And Kotlin swaps Java's package-private for **`internal`** (module visibility) and narrows
> `protected` to subclasses only. I keep fields private and expose the minimum."

---

## 3. Inheritance & Polymorphism Tricks

The small rules everyone is expected to know:

- **Override vs overload:** **override** = same signature in a subclass → **runtime** polymorphism
  (dispatch on the object's actual type). **Overload** = same name, different parameters → resolved at
  **compile time** by the **declared (static) type** of the argument. Always use **`@Override`** so the
  compiler catches a mistyped signature (which would silently become an overload).
- **Fields are NOT polymorphic** — they're **hidden**, not overridden. `Parent p = new Child();
  p.field` uses **Parent's** field (resolved by the reference type), while `p.method()` uses Child's
  override. Access fields through getters to avoid this.
- **`private` methods are not virtual** — they can't be overridden; a same-named subclass method is
  unrelated (effectively `final`).
- **Covariant return types** — an override may return a **subtype** of the parent's return type (Java 5+).
- **`final`** stops it: `final` method = no override; `final` class = no subclassing (e.g. `String`).
  **`abstract`** = can't instantiate; abstract methods must be implemented.
- **Constructors aren't inherited.** A subclass constructor implicitly calls `super()` first; if the
  parent has **no no-arg constructor**, the child **must** call `super(args)` explicitly.
- **Initialization order** (a favorite trap): on `new Child()` → **super constructor runs before the
  child's fields are initialized**. So calling an **overridable method from a constructor** sees the
  child override running **before** the child's fields exist → it reads `null`/defaults. **Never call
  overridable methods from a constructor.**
- **Kotlin flips the default:** classes and methods are **`final` by default** — you must mark them
  **`open`** to allow subclassing/overriding, and **`override` is mandatory**. Plus `sealed` classes for
  closed hierarchies. (This is Kotlin enforcing "design for inheritance or prohibit it.")

> **Trap:** `Parent p = new Child(); p.staticOrField` resolves by the **reference type**, but
> `p.instanceMethod()` resolves by the **object type**. Methods are polymorphic; **fields and `static`
> methods are not.**

---

## 4. static — and How It Interacts with Inheritance

**`static` members belong to the class, not instances** — one shared copy for all objects.

- **Static methods are *hidden*, not overridden** ("method hiding"). A subclass `static` method with the
  same signature **hides** the parent's; which one runs is decided at **compile time by the reference
  type**, not the object. `@Override` on a static method is a **compile error**.
- Static methods **can't use `this`** or instance members, and **can't be abstract**.
- **Static fields** are one shared slot → beware **mutable static state** (thread-safety hazards, and a
  common **memory-leak** source since it lives as long as the class).
- **Static initializer blocks** (`static { ... }`) run **once**, when the class is **loaded**, in textual
  order with static field initializers. Parent statics initialize before child statics.
- **Static nested class vs inner class:** a **`static` nested** class holds **no** reference to an outer
  instance; a **(non-static) inner** class holds an **implicit reference to the outer object** — a classic
  **memory leak** (e.g. a non-static `Handler`/`Runnable` pinning an Activity/outer). **Prefer `static`
  nested** unless you truly need the outer instance.
- **`static final` constants** of primitives/`String` are **inlined at compile time** into callers — so a
  changed constant value won't take effect in another module until it's **recompiled**.

**Kotlin has no `static`** — the equivalents:
- **`companion object`** — one per class, for factory methods/constants; add **`@JvmStatic`** to expose
  members as real Java statics.
- **Top-level functions/properties** — the idiomatic replacement for utility statics (compiled to static
  members of a file class).
- **`object`** — a singleton (one instance).
- **`const val`** — a compile-time constant (the Kotlin `static final` for primitives/strings).

> **Senior answer:** "`static` is class-level, so it isn't polymorphic — static methods are **hidden, not
> overridden**, and resolve by reference type. Watch mutable static state for leaks and concurrency, and
> prefer **static nested** over inner classes to avoid pinning the outer object. Kotlin drops `static`
> for **companion objects**, **top-level declarations**, and **`object`** singletons."

---

## 5. equals() — Reference vs Value Equality

The default `Object.equals` is **reference equality** (`==`, same object in memory). You override it for
**logical/value equality** ("same content").

```java
String a = new String("hi");
String b = new String("hi");
a == b;          // false — different objects
a.equals(b);     // true  — same content
```

The **`equals` contract** (must all hold, or collections misbehave):
- **Reflexive:** `x.equals(x)` is true.
- **Symmetric:** `x.equals(y)` ⟺ `y.equals(x)`.
- **Transitive:** `x.equals(y)` && `y.equals(z)` ⟹ `x.equals(z)`.
- **Consistent:** repeated calls give the same result (no random/mutable-field dependence).
- **Non-null:** `x.equals(null)` is false.

> **Trap:** breaking **symmetry** by making `equals` accept a superclass/subclass asymmetrically (the
> classic `Point` vs `ColorPoint` problem). The safe rule: compare with `getClass() != o.getClass()`
> (strict) rather than `instanceof` when inheritance is involved, or favor composition.

---

## 6. hashCode() — and Why It's Tied to equals

`hashCode()` returns an `int` used to pick a hash bucket. The **non-negotiable contract**:

1. **If `a.equals(b)` then `a.hashCode() == b.hashCode()`** — equal objects must have equal hashes.
2. Unequal objects *may* share a hash (a **collision** — allowed).
3. Consistent across calls (while the object's `equals` fields don't change).

```java
@Override public boolean equals(Object o) { /* compare fields */ }
@Override public int hashCode() { return Objects.hash(field1, field2); }  // same fields as equals
```

> **Trap (the #1 collections bug):** override `equals` but **not** `hashCode` → two "equal" objects get
> different hashes → land in different buckets → `map.get(key)` returns `null` even though the key is
> "in" the map. **Always override them together, over the same fields.** (Deep dive in the Data
> Structures handbook §8.)

The **default `hashCode`** is an *identity* hash (historically derived from the object, exposed via
`System.identityHashCode`) — **not** the memory address per se, and stable for the object's lifetime.

---

## 7. == vs equals (Java) and == vs === (Kotlin)

This is a top gotcha in both languages:

**Java:**
- **`==`** → reference equality for objects (same instance); **value** equality for primitives.
- **`.equals()`** → logical equality (if overridden).

**Kotlin (cleaner, deliberately):**
- **`==`** → **structural** equality — compiles to a **null-safe `equals()`** call (`a == b` becomes
  `a?.equals(b) ?: (b === null)`).
- **`===`** → **referential** equality (same instance), like Java's `==`.

```kotlin
val a = "hi"; val b = StringBuilder("hi").toString()
a == b      // true  — structural (content)
a === b     // false — different instances
```

> **Senior answer:** "Kotlin fixed Java's most error-prone operator: in Kotlin `==` means *content*
> (null-safe `equals`) and `===` means *identity*. In Java `==` on objects is identity, so comparing
> strings/wrappers with `==` is a classic bug — use `.equals()`."

---

## 8. toString()

Default `Object.toString` returns `ClassName@hexHashCode` — useless in logs. Override it for readable
output (and **never** put secrets in it).

- **Java records** and **Kotlin data classes** generate a good `toString` automatically.
- **Trap:** logging an object with a default `toString` (`User@1b6d3586`) and wondering why logs are
  unreadable.

---

## 9. Strings: Immutability, the Pool & Interning

Strings are **immutable** in both languages — every "modification" creates a **new** `String`. This
enables safe sharing, caching, hashcode caching, and thread-safety.

**The string pool (intern pool):** string **literals** are deduplicated into a pool, so identical
literals are the **same instance**; `new String("x")` forces a **new** object **outside** the pool.

```java
String a = "hello";          // pooled
String b = "hello";          // same pooled instance
a == b;                      // true  (same reference)

String c = new String("hello");   // NEW object, not pooled
a == c;                      // false
a.equals(c);                 // true
a == c.intern();             // true  — intern() returns the pooled instance
```

- **Why immutability matters:** because `String` is immutable, it's safe as a `HashMap` key, can cache
  its `hashCode`, and can be shared across threads without synchronization.
- **`StringBuilder`** for heavy concatenation — building a string in a loop with `+` creates many
  throwaway objects (O(n²)); `StringBuilder` is O(n). (The compiler optimizes simple `+` but not loops.)

> **Trap:** comparing strings with `==` in Java. It works *by luck* for pooled literals and fails for
> `new String`/runtime-built strings. Always use `.equals()` (or Kotlin `==`).

---

## 10. The Integer Cache & Autoboxing Traps

**Autoboxing** auto-converts between primitives (`int`) and wrappers (`Integer`). It hides two famous
traps:

**The Integer cache:** `Integer.valueOf` (used by autoboxing) **caches `-128..127`**, so those box to the
**same instance**; outside that range you get new objects:

```java
Integer a = 127, b = 127;
a == b;            // true  — cached
Integer c = 128, d = 128;
c == d;            // false — different objects!  (use .equals or compare as int)
```

**Unboxing null → NPE:** unboxing a `null` wrapper throws `NullPointerException`:

```java
Integer x = null;
int y = x;         // NPE — silent autounboxing
```

- **Performance:** boxing in hot loops creates garbage; prefer primitive arrays / `IntStream` / Kotlin
  `IntArray`. (See Data Structures and JVM Internals handbooks.)

> **Trap (the canonical one):** `Integer a = 1000, b = 1000; a == b` is **false**. Compare wrappers with
> `.equals()` or unbox to `int`. This bug ships to production constantly.

---

## 11. clone() vs Copy — Shallow vs Deep

Copying objects is trickier than it looks.

- **`Object.clone()`** does a **shallow copy** — primitive fields are copied, but **object references are
  shared** (both copies point to the same nested objects). Requires implementing the `Cloneable` marker
  interface and is widely considered **broken** (awkward contract, no constructor call, returns `Object`).
- **Preferred:** **copy constructors** or static factory methods (`new User(other)`), or for deep copies,
  copy nested objects explicitly (or serialize/deserialize).

**Shallow vs deep:**
- **Shallow** — top-level copied, nested objects **shared** (mutating a nested object affects both).
- **Deep** — nested objects copied recursively (fully independent).

**Kotlin `data class` `copy()`** is also a **shallow copy** — a frequent surprise:

```kotlin
data class Order(val id: Long, val items: MutableList<Item>)
val a = Order(1, mutableListOf(item))
val b = a.copy()           // NEW Order, but b.items === a.items (SAME list!)
b.items.add(other)         // also mutates a.items
```

> **Senior answer:** "I avoid `clone()`/`Cloneable` — it's broken by design. I use copy constructors or
> factories, and I remember that both Java `clone` and Kotlin `data class copy()` are **shallow**, so
> mutable nested state is shared unless I deep-copy it. The cleanest fix is **immutability** (immutable
> nested types make shallow copies safe)."

---

## 12. Pass-by-Value (Java is *always* pass-by-value)

A persistent interview myth. **Java is always pass-by-value** — including for objects. What's passed is a
**copy of the reference**, not the object and not the variable.

```java
void f(StringBuilder sb) {
    sb.append("x");        // visible to caller — same object the reference points to
    sb = new StringBuilder("new");  // NOT visible — only the local copy of the reference is reassigned
}
```

- You **can mutate** the object through the copied reference; you **cannot reassign** the caller's
  variable. That's the whole confusion: "objects are passed by reference" is wrong — *references are
  passed by value*.
- Kotlin behaves the same way.

---

## 13. Serialization

**Serialization** = converting an object to bytes (to store/transmit) and back (deserialization).

**Java built-in serialization:**
- A class opts in via the **`Serializable`** marker interface (no methods).
- **`serialVersionUID`** — a version stamp; if it doesn't match on deserialization you get
  `InvalidClassException`. **Always declare it explicitly** — otherwise the compiler generates one that
  changes when the class changes, breaking compatibility.
- **`transient`** — exclude a field from serialization (secrets, caches, derived values). **`static`**
  fields aren't serialized (they belong to the class, not the instance).
- **`Externalizable`** — full manual control via `writeExternal`/`readExternal`.

> **Trap / security:** Java's native serialization is **dangerous and discouraged** — deserializing
> **untrusted** data can execute arbitrary code (the classic Java deserialization RCE). It's also
> brittle across versions. **Prefer a data format like JSON/Protobuf** for anything crossing a trust
> boundary.

**Kotlin:** uses **`kotlinx.serialization`** — annotate with `@Serializable` and it generates
serializers at **compile time** (no reflection, multiplatform), typically to JSON. Much safer and more
idiomatic than Java's built-in mechanism.

```kotlin
@Serializable data class User(val id: Long, val name: String)
val json = Json.encodeToString(user)
val back = Json.decodeFromString<User>(json)
```

---

## 14. finalize, Cleaner & getClass

- **`finalize()`** is **deprecated** (since Java 9) — unpredictable, may never run, hurts GC. **Never use
  it.** For cleanup, use **`try-with-resources`** + **`AutoCloseable`**, or `java.lang.ref.Cleaner` for
  native resources.
- **`getClass()`** (final) returns the runtime `Class<?>` — used in reflection and strict `equals`.
- **`wait`/`notify`/`notifyAll`** (final) are the low-level monitor coordination methods — covered in the
  Concurrency handbook; in modern code you use higher-level concurrency tools or coroutines instead.

---

## 15. Kotlin-Specific Tricky Points

- **`Any` / `Any?`** — `Any` is the non-null root (≈ `Object`); `Any?` is the **nullable** root, the true
  top type. Null safety is enforced at **compile time**.
- **`data class`** auto-generates `equals`/`hashCode`/`toString`/`componentN`/`copy` — but **only from
  properties in the primary constructor** (properties declared in the body are **excluded** from
  `equals`/`hashCode`). A common surprise.
- **`==` is null-safe** — no need for `Objects.equals`; `a == b` never NPEs.
- **No `static`** — use **`companion object`** (and `@JvmStatic` for Java interop).
- **Structural destructuring** uses `componentN()` (`val (id, name) = user`) — generated by data classes.
- **Smart casts** — after an `is` check Kotlin auto-casts, but only for stable (`val`) references.

> **Nice to know:** because `data class equals`/`hashCode` touch **all** primary-constructor properties,
> they're discouraged for **JPA entities** (touching all fields triggers lazy loads and breaks identity)
> — use a business-key `equals`/`hashCode` instead. (See the Hibernate/JPA handbook.)

---

## 16. Interview Q&A Bank

**Q: Java vs Kotlin access modifiers — and the default?**
> Java: private, package-private (default), protected (package + subclasses), public. Kotlin: public
> (default), internal (module), protected (subclasses only, no package), private (class/file). Java
> defaults to package-private, Kotlin to public; Kotlin replaces package-private with internal.

**Q: Override vs overload vs hide?**
> Override = same signature in a subclass, runtime dispatch on object type (use @Override). Overload =
> same name, different params, compile-time by declared type. Fields and static methods are hidden (by
> reference type), not overridden — only instance methods are polymorphic.

**Q: Can you override a static method?**
> No — static methods are hidden, not overridden. The call resolves at compile time by the reference type;
> @Override on a static is an error. Static members belong to the class, so they aren't polymorphic.

**Q: Why not call an overridable method from a constructor?**
> The super constructor runs before the subclass's fields are initialized, so the overridden method runs
> against null/default fields — a subtle bug. Keep constructors free of overridable calls.

**Q: Static nested class vs inner class?**
> A static nested class holds no reference to an outer instance; a non-static inner class holds an
> implicit outer reference (a common memory leak). Prefer static nested unless you need the outer object.

**Q: Which Object methods can you override, and which can't?**
> Override: equals, hashCode, toString, clone, finalize (deprecated). Cannot (final): getClass, wait,
> notify, notifyAll. In practice override equals/hashCode/toString; avoid clone/finalize.

**Q: == vs equals in Java? And Kotlin's == vs ===?**
> Java: == is reference equality for objects (value for primitives); equals is logical. Kotlin: == is
> structural (null-safe equals call), === is referential identity.

**Q: State the equals and hashCode contracts.**
> equals: reflexive, symmetric, transitive, consistent, non-null. hashCode: equal objects must have equal
> hashes; unequal may collide; consistent. Equal-by-equals ⟹ equal hashCode is the link.

**Q: What breaks if you override equals but not hashCode?**
> Equal objects can get different hash buckets, so HashMap/HashSet lookups fail (get returns null) for a
> key that's logically present. Always override both over the same fields.

**Q: Why are strings immutable, and what is the string pool?**
> Immutability enables safe sharing, hashcode caching, thread-safety, and use as map keys. Literals are
> interned into a shared pool (same instance); new String() creates an unpooled object; intern() returns
> the pooled one. Compare with equals, not ==.

**Q: Explain the Integer cache gotcha.**
> Autoboxing caches Integer -128..127, so == is true there but false for larger values (new objects).
> Compare wrappers with equals or unbox. Also, unboxing a null wrapper throws NPE.

**Q: Shallow vs deep copy — and what does Kotlin's copy() do?**
> Shallow copies the top level but shares nested object references; deep copies recursively. Object.clone
> and Kotlin data class copy() are both shallow — mutable nested state is shared. Prefer copy
> constructors and immutability.

**Q: Is Java pass-by-value or pass-by-reference?**
> Always pass-by-value. For objects, a copy of the reference is passed — you can mutate the object but
> can't reassign the caller's variable. "References passed by value," not "pass by reference."

**Q: How does Java serialization work and why is it discouraged?**
> Implement Serializable, declare serialVersionUID, mark transient fields to skip. It's discouraged
> because deserializing untrusted input can run arbitrary code (RCE) and it's brittle across versions —
> prefer JSON/Protobuf. Kotlin uses compile-time kotlinx.serialization.

**Q: Should you use clone() or finalize()?**
> No to both. clone/Cloneable has a broken contract — use copy constructors/factories. finalize is
> deprecated and unreliable — use try-with-resources/AutoCloseable or Cleaner.

**Q: What does a Kotlin data class generate, and from what?**
> equals, hashCode, toString, componentN, copy — but only from primary-constructor properties; body
> properties are excluded from equals/hashCode.

---

## 17. Cheat Sheet

- **Object methods:** override **equals/hashCode/toString** (and rarely clone/finalize); **getClass,
  wait/notify/notifyAll are `final`**. Kotlin root is **`Any`** (equals/hashCode/toString only).
- **Access (Java):** `private` < package-private (**default**) < `protected` (package+subclasses) <
  `public`. **Access (Kotlin):** `public` (**default**), `internal` (module), `protected` (subclasses
  only), `private` (class/file). No package-private in Kotlin → use **`internal`**.
- **Inheritance:** override (runtime, @Override) vs overload (compile-time); **fields & static methods are
  hidden, not overridden** (resolved by reference type); covariant returns OK; **don't call overridable
  methods in constructors**; Kotlin is **`final` by default** (`open`/`override` required).
- **static:** class-level/shared; **static methods are hidden, not overridden**; mutable static = leak/
  concurrency risk; **prefer static nested over inner** (inner pins the outer); `static final` constants
  inline at compile time. Kotlin: **companion object / top-level / `object` / `const val`** instead of
  `static`.
- **Equality:** Java `==` = identity (objects) / value (primitives); `.equals` = logical. Kotlin `==` =
  **structural null-safe equals**, `===` = identity.
- **Contracts:** equals = reflexive/symmetric/transitive/consistent/non-null; hashCode = equal⟹equal-hash,
  collisions allowed, consistent. **Always override the pair together.**
- **Strings:** immutable; **literals pooled/interned**, `new String` unpooled; compare with `equals`;
  `StringBuilder` for loops.
- **Integer cache:** `-128..127` boxes to same instance → `==` true there, **false beyond 127**; unboxing
  `null` → **NPE**. Compare wrappers with `equals`.
- **Copy:** `clone()` and Kotlin **`data class copy()` are shallow** (nested refs shared). Prefer copy
  constructors + **immutability**; avoid `Cloneable`.
- **Pass-by-value always** — references copied by value (mutate yes, reassign no).
- **Serialization:** `Serializable` + **explicit `serialVersionUID`** + `transient`; native Java serial is
  **insecure (RCE) and brittle** → prefer JSON/Protobuf; Kotlin → **`@Serializable` (kotlinx)**.
- **Avoid:** `finalize` (use try-with-resources/AutoCloseable/Cleaner).
- **Kotlin:** `Any`/`Any?`, data class generates from **primary-constructor props only**, `companion
  object` instead of `static`, smart casts on `val`.

---

*End of handbook. The signal: you know the layer beneath the syntax — **every class extends Object/Any**
and which methods are yours to override, **`equals`/`hashCode` move together**, Java `==` is identity
(Kotlin `==` is content), **strings are immutable and pooled**, the **Integer cache** and **null
unboxing** bite, `clone`/`copy()` are **shallow**, Java is **pass-by-value**, and native **serialization
is a security/versioning hazard** best replaced by JSON/Protobuf.*
