---
title: "Testing Strategy — Interview Handbook"
description: "Testing strategy: the test pyramid, test doubles, TDD, contract testing, flaky tests, coverage myths, and testing in production — with a Q&A bank."
sidebar:
  label: "Testing Strategy"
---

> A pragmatic guide to testing for senior/staff interviews: the test pyramid and its anti-patterns,
> the levels (unit, integration, e2e) and when each pays off, test doubles (mock vs stub vs fake vs
> spy), TDD and BDD, what is worth testing, flaky tests and how to kill them, contract testing for
> microservices, why coverage is a misleading target, and modern practices (testcontainers, testing in
> production) — with a Q&A bank.

---

## 1. Why We Test (the goal)

Tests exist to **give confidence to change code quickly**, not to chase a coverage number. A good suite
catches regressions, documents behavior, and lets you refactor fearlessly. A bad suite is slow, flaky,
brittle, and tests implementation details — so people stop trusting and running it.

> **Senior answer:** "I optimize the suite for **confidence per second** — fast, reliable feedback that
> lets me refactor without fear. Tests that break on every refactor (testing *how*, not *what*) are a
> liability, not an asset."

---

## 2. The Test Pyramid (and its anti-patterns)

The classic shape: **many fast unit tests** at the base, **fewer integration tests** in the middle, **a
few end-to-end tests** at the top.

```
        /\        E2E         few   — slow, brittle, high confidence on whole flow
       /　\       Integration  some  — real collaborators (DB, queue)
      /　　\      Unit          many  — fast, isolated, pinpoint failures
     /______\
```

Why: lower layers are **faster, cheaper, and more precise** about *where* a bug is. Push tests as low as
they can meaningfully go.

**Anti-patterns to name:**
- **Ice-cream cone** (inverted pyramid) — mostly slow E2E/manual tests, few unit tests → slow, flaky,
  expensive feedback.
- **Hourglass** — many unit + many E2E but a missing integration middle → the "do the pieces actually
  talk?" gap.
- **The Testing Trophy** (Kent C. Dodds) — a modern variant arguing **integration tests give the best
  ROI** for many apps (static analysis → unit → **integration (largest)** → e2e). Worth citing as a
  nuance: the "right" shape depends on the system.

> **Trap:** dogmatically defending the pyramid. The senior view: "Shape it by **risk and cost of
> failure** — integration tests often give the best confidence-per-effort for service-heavy apps."

---

## 3. The Test Levels

- **Unit** — one unit (class/function) in **isolation**, collaborators faked. Milliseconds. Pinpoints the
  bug. Test **behavior/public API**, not private internals.
- **Integration** — multiple components together, often with a **real** dependency (database, broker,
  HTTP) — catches wiring, serialization, SQL, config issues unit tests can't.
- **End-to-end (E2E)** — the whole system through the real UI/API, like a user. Highest confidence,
  **slowest and flakiest** — keep to critical user journeys ("happy paths that earn money").
- **Others to mention:** component, contract, performance/load, security, smoke, regression, exploratory.

> **Senior answer:** "Unit tests tell me *which* unit is wrong fast; integration tests tell me the units
> *work together*; a thin layer of E2E proves the critical journeys end-to-end. I lean on integration
> for service code because that's where most real bugs (SQL, serialization, config) live."

---

## 4. Test Doubles (know the precise differences)

Interviewers test whether you conflate these:

| Double | What it does |
|---|---|
| **Dummy** | Passed but never used (fill a parameter) |
| **Stub** | Returns **canned answers** to calls (state setup) |
| **Spy** | A stub that also **records** how it was called |
| **Mock** | Pre-programmed with **expectations**; verifies *interactions* (behavior) |
| **Fake** | A **working lightweight** implementation (in-memory DB/repository) |

- **Stub vs Mock** is the classic question: a **stub** provides state for the test ("when called, return
  X"); a **mock** asserts the **interaction happened** ("verify save() was called once"). Stub = state
  verification; mock = behavior verification.

> **Trap:** **over-mocking.** Mock only what you don't own or what's slow/non-deterministic (network,
> time, payment gateway). Mocking everything tests your mocks, not your code, and breaks on every
> refactor. Prefer **fakes** (in-memory) for repositories where possible.

---

## 5. What to Test (and what not to)

Test for **behavior and risk**, not lines:
- **Do test:** business logic, edge cases and boundaries, error/failure paths, regressions (a test per
  fixed bug), and integration seams (DB, external APIs).
- **Don't over-test:** trivial getters/setters, the framework/library itself, or **private
  implementation details** (couples tests to *how*, so refactors break them).
- **Boundary/edge focus:** empty, null, zero, one, max, off-by-one, concurrency, timeouts — most bugs
  live at boundaries.

> **Senior answer:** "I test **behavior at the public boundary** and prioritize edge/error paths and
> anything whose failure is costly. I deliberately don't test private methods or trivial code — that's
> coupling and noise, not confidence."

---

## 6. TDD and BDD

- **TDD (Test-Driven Development)** — **Red → Green → Refactor**: write a failing test, make it pass
  simply, then refactor with the safety net. Benefits: better design (testable = decoupled),
  living spec, and you never write untested code. It's a **design** discipline as much as a testing one.
- **BDD (Behavior-Driven Development)** — express tests as behavior in business language
  (Given/When/Then, Gherkin/Cucumber) so non-engineers can read them. Good for acceptance criteria.

> **Nice to know:** you don't have to do strict TDD to benefit — "test-influenced design" (writing code
> you *can* test) captures most of the value. Be honest about how you actually work.

---

## 7. Flaky Tests (the productivity killer)

A **flaky test** passes and fails non-deterministically on the same code. They're toxic: they erode
trust until people ignore *all* failures (and a real one slips through).

Common causes & fixes:
- **Timing/async** — `sleep()` and race conditions → **await conditions/polling**, deterministic clocks,
  fake timers.
- **Shared state / test order dependence** → isolate; reset state; no shared mutable fixtures.
- **Real network/time/randomness** → control via fakes, fixed seeds, injected clocks.
- **Unclean teardown** → each test sets up and tears down its own data (transactional rollback or fresh
  containers).

> **Senior answer:** "I treat a flaky test as a **production bug**: quarantine it, fix the root cause
> (usually async timing or shared state), and never paper over it with retries or sleeps. A flaky suite
> that no one trusts is worse than no suite."

---

## 8. Contract Testing (for microservices)

E2E across many services is slow and brittle; **contract tests** verify two services agree on their
interface **without** running both together.

- **Consumer-driven contracts (Pact)** — the consumer declares what it expects; the provider's CI
  verifies it still satisfies that contract. Catches breaking API changes **before** deploy, fast and in
  isolation.
- Pairs perfectly with independent deploys: you don't need a full integration environment to know you
  didn't break a downstream consumer.

> **Senior answer:** "For microservices I replace fragile cross-service E2E with **consumer-driven
> contract tests** — each side verifies the contract independently in its own pipeline, so I catch
> breaking changes early without a giant shared test environment."

---

## 9. Coverage: a Useful Signal, a Terrible Target

- Coverage measures **lines executed**, not **assertions made** or **behavior verified** — you can have
  100% coverage with zero real assertions.
- It's a **good signal** for finding *untested* areas, a **bad target** when mandated (people write
  assertion-free tests to hit a number → **Goodhart's law**).
- Prefer **mutation testing** (PIT) to measure test *quality*: it mutates code and checks whether tests
  catch it — far more honest than line coverage.

> **Trap:** "we require 90% coverage." The senior response: coverage finds gaps but shouldn't be a gate;
> **mutation testing** actually measures whether tests assert anything meaningful.

---

## 10. Modern Practices

- **Testcontainers** — spin up **real** dependencies (Postgres, Kafka, Redis) in Docker for integration
  tests → high fidelity without mocking the database. Largely replaces in-memory-DB shortcuts that lie.
- **Parameterized / property-based testing** (jqwik, QuickCheck) — generate many inputs and assert
  invariants, finding edge cases you wouldn't enumerate.
- **Testing in production** — canary analysis, synthetic monitoring, **feature flags**, and shadow/dark
  traffic. Because staging never fully matches prod, observability + safe rollout *is* part of your test
  strategy.
- **Test data management** — builders/object mothers, factories, and isolated per-test data; avoid shared
  fixtures that cause coupling and flakiness.

---

## 11. Interview Q&A Bank

**Q: What is the test pyramid and why that shape?**
> Many fast unit tests, fewer integration, few E2E — because lower layers are faster, cheaper, and pinpoint
> bugs. Inverting it (ice-cream cone) gives slow, flaky, expensive feedback.

**Q: Stub vs mock?**
> A stub returns canned data to set up state (state verification). A mock has expectations and verifies
> interactions occurred (behavior verification). Different intents; don't conflate them.

**Q: What's wrong with over-mocking?**
> You end up testing mocks, not real behavior, and tests break on every refactor. Mock only slow/external/
> non-deterministic things; prefer fakes (in-memory) and real deps via testcontainers.

**Q: Unit vs integration vs E2E — when each?**
> Unit for fast, isolated logic and pinpointing; integration for wiring/SQL/serialization with real deps;
> a thin E2E layer for critical user journeys. Lean on integration for service code.

**Q: How do you handle flaky tests?**
> Treat as a real bug: quarantine, find the root cause (async timing, shared state, real I/O), fix with
> deterministic waits/clocks and isolation — never mask with retries or sleeps.

**Q: Is high code coverage a good goal?**
> It's a useful signal for finding untested code but a bad target — 100% coverage can have no
> assertions. Use mutation testing to measure whether tests actually catch defects.

**Q: What is consumer-driven contract testing?**
> The consumer specifies expected interactions; the provider verifies it still meets them in its own CI
> (Pact). Catches breaking API changes early without running both services together.

**Q: What should you not test?**
> Trivial getters/setters, the framework itself, and private implementation details — testing internals
> couples tests to how code works and breaks on refactor.

**Q: What is TDD and what's its real benefit?**
> Red-green-refactor: failing test first, then code, then refactor under a safety net. The bigger win is
> design pressure toward decoupled, testable code, plus a living spec.

**Q: Why testcontainers over in-memory databases?**
> They run the real dependency (e.g. Postgres) in Docker, so tests exercise real SQL/behavior; in-memory
> substitutes have subtly different semantics that hide bugs.

**Q: How do you test things staging can't cover?**
> Testing in production: canary releases with metric analysis, synthetic monitoring, feature flags, and
> shadow traffic — paired with observability and fast rollback.

---

## 12. Cheat Sheet

- **Goal:** confidence to change fast — **confidence per second**, not coverage %.
- **Pyramid:** many **unit** → some **integration** → few **E2E**. Avoid **ice-cream cone**; the
  **Testing Trophy** favors integration ROI. Shape by **risk**.
- **Levels:** unit (isolated, fast, behavior not internals) · integration (real deps, wiring/SQL) · E2E
  (critical journeys only).
- **Doubles:** dummy / **stub** (canned state) / spy / **mock** (verify interaction) / **fake** (working
  in-memory). **Stub = state, mock = behavior.** Don't over-mock.
- **Test:** business logic, **edges/boundaries**, error paths, regressions, integration seams. **Don't
  test** getters, the framework, or private internals.
- **TDD:** red-green-refactor (design discipline). **BDD:** Given/When/Then for acceptance.
- **Flaky = a real bug:** fix async timing & shared state; no sleeps/retry masking.
- **Microservices → contract tests** (consumer-driven, Pact) instead of fragile cross-service E2E.
- **Coverage** = signal, not target (Goodhart); use **mutation testing** for test quality.
- **Modern:** **testcontainers** (real deps), property-based tests, **testing in production** (canary,
  synthetics, flags), isolated test data.

---

*End of handbook. The signal: tests are for **fast, trustworthy confidence to change code** — push them
**as low as meaningful**, verify **behavior not internals**, kill **flakiness** ruthlessly, use
**contract tests** across services, and treat **coverage as a signal, not a target**.*
