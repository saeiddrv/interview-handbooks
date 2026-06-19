---
title: "CI/CD & Deployment Strategies — Advanced Interview Handbook"
description: "Shipping software safely and fast: CI vs CD vs continuous deployment, the pipeline stages, trunk-based development, deployment strategies (blue-green, canary, rolling), feature flags, database migrations, rollbacks, and DORA metrics — with a Q&A bank."
sidebar:
  label: "CI/CD & Deployment"
---

> How modern teams ship safely and often: CI vs continuous delivery vs continuous deployment, what a
> good pipeline does, trunk-based development and branching, the deployment strategies (rolling,
> blue-green, canary) and when to use each, decoupling deploy from release with feature flags, safe
> database migrations, fast rollbacks, and the DORA metrics — with a Q&A bank.

---

## 1. CI vs CD vs CD (define them precisely)

- **Continuous Integration (CI)** — every commit is automatically **built and tested** on merge to the
  main branch, so integration problems surface in minutes, not at a big merge later.
- **Continuous Delivery (CD)** — every change that passes CI is **automatically prepared for release**
  and is **always deployable**; the actual production push is a **manual button**.
- **Continuous Deployment (CD)** — goes one step further: every passing change is **automatically
  deployed to production** with no human gate.

> **Senior answer:** "CI = automated build+test on every merge. Continuous **Delivery** keeps main
> always releasable with a manual deploy gate. Continuous **Deployment** removes that gate entirely. The
> jump from delivery to deployment requires strong automated tests, observability, and fast rollback."

---

## 2. The Pipeline

A typical pipeline, fail-fast (cheap, fast checks first):

```
commit → build → unit tests → static analysis (lint, SAST, license) →
  package (artifact/image) → integration tests → deploy to staging →
  e2e/smoke tests → deploy to prod (canary → full) → post-deploy verification
```

Principles:
- **Fast feedback** — keep CI under ~10 minutes; parallelize; run the cheapest checks first.
- **Build once, promote the same artifact** — the **identical** immutable image flows dev → staging →
  prod. Never rebuild per environment (config comes from the environment, not the build).
- **Everything as code** — pipeline, infra (IaC), and config are versioned and reviewed.
- **Shift left** — security/quality checks in the pipeline (SAST/DAST, dependency/secret scanning), not
  after release.

> **Trap:** rebuilding the artifact for each environment. "Build once, promote the same artifact"
> guarantees what you tested is what you ship.

---

## 3. Branching: Trunk-Based Development

- **Trunk-based development** — everyone integrates to **main** frequently (at least daily) behind small
  PRs and **feature flags** for incomplete work. Enables true CI and fast flow. The modern default for
  high-performing teams.
- **GitHub Flow** — short-lived feature branches off main, merged via PR. Simple, works well with CD.
- **GitFlow** — long-lived develop/release/hotfix branches. Heavy; suits scheduled releases and versioned
  products, but **slows integration** and causes painful merges. Often an anti-pattern for web services.

> **Senior answer:** "I favor **trunk-based development** with short-lived branches and feature flags —
> long-lived branches defeat the 'continuous' in CI by deferring integration pain. GitFlow only earns its
> complexity for versioned, scheduled-release software."

---

## 4. Deployment Strategies

The core knowledge area. Each trades risk, cost, and complexity:

**Recreate** — stop old, start new. Simple but causes **downtime**. Only for non-critical/batch.

**Rolling** — replace instances in batches; old and new run together during the rollout.
- No downtime, no extra fleet. **But** mixed versions serve traffic simultaneously (needs
  backward-compatible changes), and rollback is slow (roll the batch back). Kubernetes default.

**Blue-Green** — run two **full** environments (Blue = current, Green = new). Deploy/test Green, then
**switch all traffic** (load balancer/DNS) at once.
- **Instant cutover and instant rollback** (flip back to Blue). **But** doubles infrastructure cost and
  needs careful DB compatibility across both.

**Canary** — release to a **small % of users/traffic** first, watch metrics (errors, latency, business
KPIs), then **gradually ramp** (1% → 10% → 50% → 100%) or auto-roll-back on regression.
- **Lowest blast radius**, real production validation. **But** more complex (traffic splitting,
  automated analysis); runs mixed versions.

| Strategy | Downtime | Rollback | Extra cost | Risk |
|---|---|---|---|---|
| Recreate | Yes | Slow | None | High |
| Rolling | No | Slow-ish | None | Medium |
| Blue-Green | No | **Instant** | **2× fleet** | Low |
| Canary | No | Fast | Small | **Lowest** |

> **Senior framing:** "Canary gives the smallest blast radius by validating on real traffic before full
> rollout; blue-green gives the fastest rollback at double the cost. For most services I run **canary
> with automated metric-based promotion/rollback**."

---

## 5. Decouple Deploy from Release: Feature Flags

**Deploying** code ≠ **releasing** a feature. **Feature flags** (toggles) let you ship dark code and turn
it on independently — per user, %, or cohort.

- **Decouple deploy/release**, instant **kill switch** (turn off a broken feature without a redeploy),
  **gradual rollout** and **A/B testing**, and merging incomplete work safely (trunk-based).
- **Costs:** flag debt (remove stale flags!), combinatorial testing, and config as a new failure surface.

> **Senior answer:** "Feature flags are my most powerful release tool — they separate deploy from
> release, give an instant kill switch (faster than any rollback), and let me ramp like a canary at the
> feature level. The discipline is **removing flags** once a feature is stable."

---

## 6. Database Migrations (the hard part of CD)

Schema changes are the riskiest deploys because the DB is **stateful** and shared by old + new code
during a rollout.

- **Backward-compatible, expand/contract (parallel change):**
  1. **Expand** — add the new column/table (nullable, no constraint) — old code ignores it.
  2. **Migrate/backfill** — dual-write or backfill data; deploy code that uses the new shape.
  3. **Contract** — once nothing reads the old shape, drop it.
- **Never** make a breaking schema change in lockstep with code — during a rolling/canary deploy, both
  versions run.
- Use a **migration tool** (Flyway, Liquibase) with versioned, reviewed, forward-only migrations; avoid
  destructive ops (`DROP`/rename) until the contract step.

> **Trap:** "Just add a NOT NULL column and deploy." During the rollout the old instances insert rows
> without it → failures. Expand-migrate-contract is the safe pattern.

---

## 7. Rollbacks & Safety Nets

- **Make rollback trivial and fast** — it's your primary incident tool. Immutable artifacts + blue-green
  flip or `kubectl rollout undo` make it one step.
- **Forward-fix vs rollback** — prefer rollback to a known-good state during an incident; fix forward
  after.
- **Migrations break simple rollback** — a deployed schema change may not be reversible, which is *why*
  backward-compatible migrations matter (so rolling code back still works against the new schema).
- Safety nets: **smoke/health checks gate promotion**, automated canary analysis, and **feature-flag kill
  switches** for instant mitigation.

---

## 8. DORA Metrics (how to measure delivery)

The research-backed measures of software delivery performance:

- **Deployment Frequency** — how often you ship.
- **Lead Time for Changes** — commit → production.
- **Change Failure Rate** — % of deploys causing a failure.
- **MTTR (Mean Time to Restore)** — how fast you recover.

Elite teams ship **frequently with low failure rate and fast recovery** — speed and stability rise
**together** (small, frequent, automated changes are *safer*, not riskier).

> **Senior answer:** "Counterintuitively, **shipping more often improves stability** — small batches are
> easier to test, review, and roll back. DORA shows speed and reliability aren't a tradeoff; they're
> correlated outcomes of good automation."

---

## 9. Interview Q&A Bank

**Q: CI vs continuous delivery vs continuous deployment?**
> CI = auto build+test on every merge. Continuous delivery = always-releasable main with a manual deploy
> gate. Continuous deployment = automatic prod deploy with no gate (needs strong tests + rollback).

**Q: Why "build once, promote the same artifact"?**
> The exact image you tested in staging is what reaches prod — rebuilding per environment risks shipping
> something untested. Config comes from the environment, not the build.

**Q: Rolling vs blue-green vs canary?**
> Rolling: replace in batches, no extra cost, slow rollback, mixed versions. Blue-green: two full envs,
> instant switch/rollback, 2× cost. Canary: small % first with metric-based ramp, lowest blast radius,
> more complex.

**Q: What's the difference between deploying and releasing?**
> Deploying ships code to prod; releasing exposes a feature to users. Feature flags decouple them — ship
> dark, toggle on gradually, kill switch off instantly.

**Q: How do you deploy a breaking database schema change safely?**
> Expand/contract: add the new shape (backward-compatible), backfill/dual-write, deploy code using it,
> then drop the old shape once unused. Never change schema in lockstep during a rolling/canary deploy.

**Q: Why is trunk-based development preferred for CI/CD?**
> Frequent integration to main (behind flags) surfaces conflicts early and enables continuous flow.
> Long-lived branches (GitFlow) defer integration pain and cause big merges.

**Q: What are feature flags good and bad at?**
> Good: decouple deploy/release, kill switch, gradual rollout, A/B, trunk-based safety. Bad: flag debt,
> testing combinations, and config as a new failure surface — remove stale flags.

**Q: How do you make rollback safe?**
> Immutable artifacts + one-step rollback (blue-green flip / rollout undo), backward-compatible
> migrations so old code works against the new schema, and feature-flag kill switches for instant
> mitigation.

**Q: What are the DORA metrics?**
> Deployment frequency, lead time for changes, change failure rate, MTTR. Elite teams score high on all —
> frequent shipping correlates with better stability, not worse.

**Q: What does "shift left" mean?**
> Move quality and security checks (tests, SAST/DAST, dependency/secret scanning) earlier into the
> pipeline so defects are caught cheaply at commit time, not after release.

---

## 10. Cheat Sheet

- **CI** = build+test every merge · **Continuous Delivery** = always releasable, manual deploy ·
  **Continuous Deployment** = auto to prod.
- **Pipeline:** fast-fail order, **build once / promote same artifact**, everything-as-code, **shift
  left** security.
- **Branching:** **trunk-based** (+ feature flags) for CI/CD; GitFlow only for versioned releases.
- **Strategies:** Recreate (downtime) · **Rolling** (no extra cost, slow rollback) · **Blue-Green**
  (instant rollback, 2× cost) · **Canary** (smallest blast radius, metric-based ramp).
- **Feature flags:** decouple **deploy vs release**, instant kill switch, gradual rollout — remove stale
  flags.
- **DB migrations:** **expand → migrate/backfill → contract**; backward-compatible; Flyway/Liquibase;
  no breaking change in lockstep.
- **Rollback:** trivial + fast (immutable artifacts), backward-compatible migrations, flag kill switches;
  rollback first, fix forward later.
- **DORA:** deployment frequency, lead time, change failure rate, MTTR — **ship small + often = safer**.

---

*End of handbook. The signal: ship **small, frequent, automated** changes; **build once and promote**;
choose a deployment strategy by **blast radius vs cost** (canary/blue-green); **decouple deploy from
release** with flags; make **migrations backward-compatible** and **rollback trivial** — speed and
stability rise together.*
