---
title: "OOP & Design Patterns — Advanced Interview Handbook"
description: "OOP design and the Gang of Four patterns explained simply but deeply: the four OOP pillars, composition over inheritance, SOLID and DRY/KISS/YAGNI, all 23 GoF patterns (creational, structural, behavioral) with when to use each, real Java/Kotlin examples, how Spring and the JDK use them, Kotlin idioms (object, sealed, data class, delegation), anti-patterns and overengineering — with a high-level Q&A bank."
sidebar:
  label: "OOP & Design Patterns"
---

> Object-oriented design and the **Gang of Four** patterns, explained **simply but deeply** — with the
> part interviewers actually care about: **when to reach for each one and when not to**. Covers the
> **four OOP pillars**, **composition over inheritance**, **SOLID** (and DRY/KISS/YAGNI), and **all 23
> GoF patterns** (creational, structural, behavioral) with **real Java/Kotlin examples**, how **Spring
> and the JDK** use them, **Kotlin idioms** that replace boilerplate patterns, and the **anti-patterns**
> — plus a high-level Q&A bank.

---

## 1. The Four Pillars of OOP

- **Encapsulation** — bundle data + behavior, hide internals behind a small public surface. Fields
  `private`, expose intent via methods. (Why: change internals without breaking callers.)
- **Abstraction** — expose *what* an object does, hide *how*. Program to **interfaces**, not
  implementations.
- **Inheritance** — a subtype reuses/specializes a supertype ("is-a"). Powerful but easily abused.
- **Polymorphism** — one interface, many implementations; the right method is chosen at runtime
  (dynamic dispatch). This is what makes most patterns work.

> **Senior framing:** "Patterns are just disciplined applications of **abstraction + polymorphism +
> composition** to keep code open to change. If you understand those, the 23 patterns are mostly named
> recipes."

---

## 2. Composition Over Inheritance

The single most important design instinct. **Inheritance** is rigid: it's compile-time, exposes the
parent's internals, and a deep hierarchy becomes brittle (the "fragile base class"). **Composition**
("has-a") assembles behavior from parts you can swap at runtime.

```java
// Inheritance explosion: FlyingDuck, RubberDuck, DecoyDuck... every combo a new class.
// Composition: inject the behavior.
class Duck {
    private FlyBehavior fly;       // has-a (swappable)
    private QuackBehavior quack;
    void performFly()  { fly.fly(); }
}
```

> **Senior answer:** "Prefer composition: it's flexible (swap behavior at runtime), avoids deep brittle
> hierarchies, and keeps classes small. I use inheritance only for a genuine, stable 'is-a' with shared
> contract — otherwise compose. Kotlin even makes classes **`final` by default** to nudge you this way."

---

## 3. SOLID Principles

Five principles for maintainable OO code:

- **S — Single Responsibility:** a class has **one reason to change**. Split a class that mixes
  persistence + business logic + formatting.
- **O — Open/Closed:** open for **extension**, closed for **modification**. Add behavior via new
  classes/strategies, not by editing a giant `switch`.
- **L — Liskov Substitution:** a subtype must be usable **anywhere** its supertype is, without breaking
  expectations. The classic violation: `Square extends Rectangle` (setting width changes height →
  surprises callers).
- **I — Interface Segregation:** many small, focused interfaces beat one fat one. Don't force a class to
  implement methods it doesn't need.
- **D — Dependency Inversion:** depend on **abstractions**, not concretions. High-level modules and
  low-level modules both depend on interfaces — this is what **dependency injection** delivers.

> **Trap:** Liskov is the subtle one. If overriding a method **strengthens preconditions** or
> **weakens postconditions** (e.g. throws where the parent didn't, or returns narrower results), you've
> broken substitutability even though it compiles.

**Other guiding rules:** **DRY** (don't repeat yourself), **KISS** (keep it simple), **YAGNI** (you
aren't gonna need it — don't build for imagined futures), **Law of Demeter** (talk to friends, not
strangers — avoid `a.getB().getC().doX()`).

---

## 4. The Gang of Four: Three Families

The 23 GoF patterns group by intent:

- **Creational** — *how objects get created* (decouple construction): Singleton, Factory Method, Abstract
  Factory, Builder, Prototype.
- **Structural** — *how objects are composed* (assemble into bigger structures): Adapter, Decorator,
  Facade, Proxy, Composite, Bridge, Flyweight.
- **Behavioral** — *how objects interact / share responsibility*: Strategy, Observer, Command, Template
  Method, State, Chain of Responsibility, Iterator, Mediator, Visitor, Memento, Interpreter.

---

## 5. Creational Patterns

### Singleton
**Intent:** exactly one instance, globally accessible. **When:** shared stateless service, registry,
config. **Trap:** global mutable state, hard to test, hidden dependency — often an **anti-pattern**;
prefer **DI** (a container-managed singleton scope) over a hard-coded one.

```java
public enum Config { INSTANCE; }   // enum = the safest Java singleton (thread-safe, serialization-proof)
```
```kotlin
object Config { val url = "..." }  // Kotlin: `object` IS a singleton, done.
```

### Factory Method
**Intent:** defer instantiation to a method/subclass so callers don't `new` concrete types. **When:**
the exact type depends on context/config. **Real use:** `List.of`, `Integer.valueOf`,
`Collection.iterator()`.

```java
interface Notifier { void send(String msg); }
static Notifier create(Channel c) {            // factory method
    return switch (c) { case EMAIL -> new EmailNotifier(); case SMS -> new SmsNotifier(); };
}
```

### Abstract Factory
**Intent:** create **families** of related objects without naming concretes (e.g. a UI toolkit:
`Button` + `Checkbox` for Mac vs Windows). **When:** you must keep a product family consistent.

### Builder
**Intent:** construct a complex object step by step; great for **many optional params** and
immutability. **When:** telescoping constructors get unreadable. **Real use:**
`StringBuilder`, `Stream.Builder`, Lombok `@Builder`, `HttpRequest.newBuilder()`.

```java
var user = User.builder().name("Sam").email("s@x.com").age(30).build();
```
```kotlin
// Kotlin often doesn't need Builder: named + default args + apply{} cover it.
val user = User(name = "Sam", email = "s@x.com")        // default args
val req = Request().apply { url = "..."; method = "GET" } // apply as a builder
```

### Prototype
**Intent:** create new objects by **cloning** an existing one (when construction is costly). **When:**
many similar objects, expensive setup. **Trap:** shallow vs deep copy (see Language Tricky Points;
Kotlin `data class copy()` is shallow).

---

## 6. Structural Patterns

### Adapter
**Intent:** make an incompatible interface fit what a client expects (a "wrapper/translator"). **When:**
integrating a third-party/legacy API. **Real use:** `Arrays.asList`, `InputStreamReader` (bytes → chars).

### Decorator
**Intent:** add behavior to an object **dynamically** by wrapping it — same interface, layered. **When:**
you'd otherwise subclass for every combination (Open/Closed without inheritance explosion). **Real
use:** `java.io` streams (`new BufferedReader(new InputStreamReader(...))`), Spring's transactional
proxies.

```java
Coffee c = new MilkDecorator(new SugarDecorator(new SimpleCoffee())); // stack behaviors
```

### Facade
**Intent:** one simple entry point over a complex subsystem. **When:** hide messy internals behind a
clean API. **Real use:** Spring's `JdbcTemplate` (facade over raw JDBC), SLF4J.

### Proxy
**Intent:** a stand-in that controls access to the real object (lazy init, security, remoting, caching).
**When:** intercept calls. **Real use:** Hibernate **lazy-loading** proxies, Spring AOP proxies,
dynamic proxies (`java.lang.reflect.Proxy`).

> **Decorator vs Proxy:** both wrap. **Decorator adds behavior** the client opted into; **Proxy
> controls access** (often transparently) to the same behavior.

### Composite
**Intent:** treat individual objects and groups **uniformly** via a tree (part-whole). **When:**
hierarchies like file systems, UI components, org charts. **Real use:** `java.awt` containers, the DOM.

### Bridge
**Intent:** separate an **abstraction** from its **implementation** so they vary independently (avoid a
combinatorial class explosion across two dimensions). **When:** e.g. `Shape` × `Renderer`.

### Flyweight
**Intent:** share immutable intrinsic state across many objects to save memory. **When:** millions of
similar objects. **Real use:** the **Integer cache** (`-128..127`), `String` pool interning.

---

## 7. Behavioral Patterns

### Strategy
**Intent:** define a family of interchangeable algorithms and pick one at runtime. **When:** multiple
ways to do one thing (sort order, pricing, payment). **The Open/Closed workhorse** — replaces big
`switch`/`if` chains. **Real use:** `Comparator`, Spring's pluggable strategies.

```java
sort(list, Comparator.comparing(User::age));   // pass the strategy as a lambda
```
```kotlin
class Checkout(val pay: (Double) -> Unit)       // Kotlin: a strategy is often just a function (lambda)
```

### Observer
**Intent:** when one object changes, notify its dependents (publish/subscribe). **When:** event-driven
UIs, domain events. **Real use:** `PropertyChangeListener`, Spring `ApplicationEvent`/`@EventListener`,
RxJava/Reactor, Kotlin `Flow`/`StateFlow`.

### Command
**Intent:** wrap a request as an object (so you can queue, log, undo, schedule it). **When:** undo/redo,
task queues, transactional ops. **Real use:** `Runnable`/`Callable`, the `Executor` framework.

### Template Method
**Intent:** define an algorithm's skeleton in a base method, let subclasses fill in specific steps.
**When:** shared flow, varying details. **Real use:** Spring's `*Template` classes,
`AbstractList`. **Trap:** uses inheritance — Strategy (composition) is often the more flexible
alternative.

### State
**Intent:** an object changes behavior when its internal state changes — each state is a class.
**When:** complex state machines (order lifecycle, connection states) replacing sprawling `if` ladders.

### Chain of Responsibility
**Intent:** pass a request along a chain until someone handles it. **When:** pipelines/middleware. **Real
use:** Servlet **filters**, Spring Security filter chain, logging handlers.

### Iterator
**Intent:** traverse a collection without exposing its internals. **Real use:** `Iterator`/`Iterable`
(every `for-each`), Kotlin sequences.

### Mediator
**Intent:** centralize complex many-to-many communication in one object so components don't reference
each other directly. **Real use:** message brokers, UI dialog coordinators.

### Visitor
**Intent:** add new operations to an object structure without changing its classes (double dispatch).
**When:** stable class hierarchy, many operations (AST processing, compilers). **Trap:** painful when the
hierarchy changes often. **Kotlin:** `sealed class` + `when` is usually a cleaner alternative.

### Memento
**Intent:** capture and restore an object's state without exposing internals. **When:** undo,
snapshots, checkpoints.

### Interpreter
**Intent:** represent a grammar and evaluate sentences in it. **When:** small DSLs, expression
evaluators (rarely hand-rolled today).

---

## 8. Patterns You Already Use (JDK, Spring, Kotlin)

- **JDK:** `java.io` streams (**Decorator**), collections **Iterator**, `Comparator` (**Strategy**),
  `Runnable` (**Command**), `Integer`/`String` caches (**Flyweight/Singleton**), `valueOf`/`of`
  (**Factory**), dynamic `Proxy`.
- **Spring:** **DI** = Dependency Inversion + container-managed **Singleton**; `@Configuration`
  (**Factory**), AOP/transactions (**Proxy/Decorator**), `*Template` (**Template Method/Facade**),
  `@EventListener` (**Observer**), Security filters (**Chain of Responsibility**).
- **Hibernate:** lazy entities (**Proxy**), `SessionFactory` (**Factory**).

> **Senior framing:** "Frameworks are patterns made concrete. Naming where Spring uses Proxy, Strategy,
> Template Method, and Observer shows you understand the *why*, not just the annotations."

---

## 9. Kotlin Idioms That Replace Boilerplate Patterns

- **`object`** → Singleton (language-level, thread-safe).
- **`data class`** → value objects (equals/hashCode/toString/copy free).
- **`sealed class` + `when`** → exhaustive type hierarchies; often replaces **Visitor**/**State**.
- **Delegation `by`** → the **Decorator/Proxy** pattern built into the language
  (`class Logger(s: Service) : Service by s`).
- **Lambdas / higher-order functions** → **Strategy**, **Command**, **Observer** become plain functions.
- **`apply`/`copy`/default + named args** → often remove the need for a **Builder**.
- **Extension functions** → add behavior without **Decorator**/wrapping in many cases.
- **DSL builders** (`buildList`, `html { }`) → type-safe **Builder** via lambdas-with-receiver.

> **Senior answer:** "Many GoF patterns exist to work around Java limitations. Kotlin folds several into
> the language — `object` for Singleton, `by` for Decorator/Proxy, functions for Strategy/Command — so
> the *pattern* survives but the *boilerplate* disappears."

---

## 10. Anti-Patterns & Overengineering

- **God object / blob** — one class doing everything (violates SRP). Split it.
- **Singleton abuse** — global mutable state, hidden dependencies, untestable. Prefer DI.
- **Anemic domain model** — objects are bags of getters/setters with all logic elsewhere (procedural in
  disguise).
- **Premature patterning** — adding factories/abstractions "just in case" (violates YAGNI/KISS).
- **Deep inheritance / fragile base class** — prefer composition.

> **Trap:** the most common senior-interview failure is **overengineering** — reaching for patterns
> before there's a real axis of change. The mature move is to start simple and **refactor toward a
> pattern when duplication or change pressure appears.**

---

## 11. How to Pick a Pattern (cheat by intent)

- "Construction is messy / many options" → **Builder** / **Factory**.
- "Swap one behavior at runtime" → **Strategy**.
- "Add behavior without subclassing" → **Decorator**.
- "Control access / lazy / remote" → **Proxy**.
- "One thing changed, notify others" → **Observer**.
- "Same flow, different steps" → **Template Method** (or Strategy).
- "Behavior depends on state" → **State**.
- "Incompatible interfaces" → **Adapter**.
- "Simplify a complex subsystem" → **Facade**.
- "Tree of part-whole objects" → **Composite**.
- "Pipeline of handlers" → **Chain of Responsibility**.

---

## 12. Interview Q&A Bank

**Q: Why composition over inheritance?**
> Inheritance is compile-time, exposes the parent's internals, and deep hierarchies become brittle
> (fragile base class). Composition assembles swappable behavior at runtime, keeps classes small, and
> avoids the subclass explosion. Use inheritance only for a stable, genuine "is-a."

**Q: Explain SOLID briefly.**
> SRP (one reason to change), Open/Closed (extend without modifying), Liskov (subtypes substitutable),
> Interface Segregation (small focused interfaces), Dependency Inversion (depend on abstractions). DI is
> Dependency Inversion realized.

**Q: Give a Liskov violation.**
> Square extends Rectangle: setting width also changes height, breaking code that relies on Rectangle's
> independent width/height. The subtype violates the supertype's contract though it compiles.

**Q: Strategy vs Template Method?**
> Both vary an algorithm. Strategy uses composition (inject the algorithm as an object/lambda, swap at
> runtime); Template Method uses inheritance (subclass overrides steps of a fixed skeleton). Prefer
> Strategy for flexibility.

**Q: Decorator vs Proxy vs Adapter?**
> All wrap an object. Decorator adds behavior (same interface, client opts in); Proxy controls access
> (lazy/security/remote, often transparent); Adapter converts one interface into another the client
> expects.

**Q: When is Singleton an anti-pattern?**
> When it's global mutable state with hidden dependencies and no seam for testing. Prefer a DI
> container's singleton scope. A stateless config/registry is fine; shared mutable state is the smell.

**Q: How does Spring use design patterns?**
> DI = Dependency Inversion + Singleton scope; @Configuration = Factory; AOP/transactions = Proxy/
> Decorator; JdbcTemplate/*Template = Template Method/Facade; @EventListener = Observer; Security filter
> chain = Chain of Responsibility.

**Q: Which patterns does Kotlin make unnecessary?**
> Singleton (`object`), Builder (named/default args + apply), Decorator/Proxy (`by` delegation),
> Strategy/Command/Observer (lambdas/Flow), Visitor/State (sealed + when). The intent stays; the
> boilerplate goes.

**Q: How do you avoid overengineering with patterns?**
> Start simple (KISS/YAGNI); introduce a pattern only when a real axis of change or duplication appears.
> Refactor toward patterns; don't speculatively scatter factories and abstractions.

**Q: Builder vs telescoping constructors vs setters?**
> Telescoping constructors are unreadable with many params; setters break immutability and allow invalid
> intermediate states. Builder gives readable, immutable, validated construction. In Kotlin, named +
> default args usually replace it.

**Q: What is the Open/Closed Principle in practice?**
> Add new behavior by adding classes (a new Strategy, a new subclass), not by editing existing code/
> switch statements — so existing, tested code stays untouched. Strategy and polymorphism are the usual
> tools.

**Q: Difference between Factory Method and Abstract Factory?**
> Factory Method creates one product via a method/subclass; Abstract Factory creates families of related
> products through a set of factory methods, keeping the family consistent.

---

## 13. Cheat Sheet

- **OOP pillars:** encapsulation, abstraction, inheritance, polymorphism. **Prefer composition over
  inheritance.**
- **SOLID:** **S**RP, **O**pen/Closed, **L**iskov, **I**nterface Segregation, **D**ependency Inversion
  (= DI). Plus **DRY/KISS/YAGNI**, Law of Demeter.
- **Creational:** Singleton, Factory Method, Abstract Factory, **Builder**, Prototype — *how objects are
  made*.
- **Structural:** Adapter, **Decorator**, Facade, **Proxy**, Composite, Bridge, Flyweight — *how objects
  compose*.
- **Behavioral:** **Strategy**, **Observer**, Command, Template Method, State, Chain of Responsibility,
  Iterator, Mediator, Visitor, Memento, Interpreter — *how objects interact*.
- **Key distinctions:** Decorator (adds behavior) vs Proxy (controls access) vs Adapter (converts
  interface); Strategy (composition) vs Template Method (inheritance).
- **Where they live:** java.io = Decorator; Comparator = Strategy; Spring AOP = Proxy; *Template =
  Template Method; @EventListener = Observer; Security filters = Chain of Responsibility; Hibernate lazy
  = Proxy.
- **Kotlin shortcuts:** `object` (Singleton), `by` (Decorator/Proxy), lambdas (Strategy/Command/Observer),
  `sealed`+`when` (Visitor/State), named/default args + `apply` (Builder), `data class` (value objects).
- **Anti-patterns:** God object, Singleton abuse, anemic model, premature patterning, deep inheritance.
- **Rule of thumb:** **don't reach for a pattern until there's a real axis of change** — refactor toward
  it.

---

*End of handbook. The signal: you treat patterns as **tools for managing change**, not trophies — you
lead with **composition, SOLID, and polymorphism**, you can name **which pattern fits which problem** and
**where Spring/the JDK already use it**, you know Kotlin folds many patterns into the language, and you
**refactor toward a pattern only when the design pressure is real** rather than overengineering up front.*
