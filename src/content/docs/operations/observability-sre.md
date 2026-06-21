---
title: "Observability & SRE — Interview Handbook"
description: "Observability and SRE: metrics, logs, traces, Prometheus, Grafana, OpenTelemetry, SLO/SLA, error budgets, alerting, incident response — with a Q&A bank."
sidebar:
  label: "Observability & SRE"
---

> What senior/staff interviewers expect about running systems in production: observability vs
> monitoring, the three pillars (metrics, logs, traces) and how they fit together, SLI/SLO/SLA and
> error budgets, the RED and USE methods, alerting on symptoms not causes, incident response and
> blameless postmortems, and core SRE ideas (toil, capacity, on-call) — plus the **tooling landscape**
> (Prometheus, Grafana, Loki, ELK, Jaeger/Tempo, OpenTelemetry, **SigNoz**, Datadog) with pros/cons,
> **tracking logs & traces across microservices**, and monitoring best practices — with a Q&A bank.

---

## 1. Observability vs Monitoring

- **Monitoring** answers *known* questions: "is CPU high? is the service up?" — predefined dashboards
  and alerts.
- **Observability** is the property that lets you ask **new** questions about a system **without shipping
  new code** — to debug the *unknown unknowns* ("why are *these specific* users in *this region* on
  *this version* slow?").

> **Senior answer:** "Monitoring tells me **that** something is wrong; observability lets me explore
> **why** — including failure modes I never anticipated. High-cardinality, well-structured telemetry is
> what makes a system observable."

---

## 2. The Three Pillars

| Pillar | Answers | Form | Cost |
|---|---|---|---|
| **Metrics** | "How much / how often / how fast?" (aggregate) | Numeric time series | Cheap, low cardinality |
| **Logs** | "What exactly happened in this event?" | Discrete, timestamped records | Medium; expensive at volume |
| **Traces** | "Where did the time go across services?" | Causal span tree per request | Higher; usually sampled |

They're complementary: a **metric/alert** tells you *something is wrong*; a **trace** shows you *which
hop* is slow; **logs** tell you *exactly what* that hop did. Tie them together with a shared
**trace/correlation ID**.

- **Metrics:** counters, gauges, histograms (for latency percentiles). Prometheus-style pull, time-series
  DBs.
- **Logs:** prefer **structured logs** (JSON key-values), not free text — queryable, with the trace ID.
- **Traces:** **distributed tracing** propagates a context across service boundaries (OpenTelemetry,
  Jaeger, Zipkin) to build the per-request span tree.

> **Nice to know:** **OpenTelemetry (OTel)** is the vendor-neutral standard unifying all three —
> instrument once, export anywhere. Naming it signals current practice.

---

## 3. Percentiles, Not Averages

**Never reason about latency with the mean.** Averages hide tail latency that real users feel. Use
**percentiles**: p50 (median), p95, **p99**, p99.9.

- A p99 of 2s means **1 in 100** requests is that slow — and a page may make many calls, so a user likely
  hits the tail. Tail latency dominates user experience at scale.
- Aggregate percentiles with **histograms**, not by averaging percentiles (you can't average p99s).

> **Trap:** "Average latency is 100ms, we're fine." The interviewer wants **p99/p99.9** — the tail is
> where outages and angry users live.

---

## 4. The RED and USE Methods

Two complementary recipes for "what do I actually measure?"

- **RED** (per **service / request-driven**): **R**ate (requests/sec), **E**rrors (failed/sec),
  **D**uration (latency distribution). The default for microservice health.
- **USE** (per **resource**): **U**tilization, **S**aturation (queue depth/wait), **E**rrors. For CPUs,
  disks, pools, queues — find the saturated resource.

> **Senior answer:** "For services I dashboard **RED** (rate, errors, duration); for resources I use
> **USE** (utilization, saturation, errors). RED catches user-facing symptoms; USE finds the bottleneck
> behind them."

---

## 5. SLI, SLO, SLA, and Error Budgets (the core SRE idea)

- **SLI (Indicator)** — a measured number: "% of requests served < 300ms" or "success rate."
- **SLO (Objective)** — your internal **target** for an SLI: "99.9% of requests succeed over 30 days."
- **SLA (Agreement)** — a **contract** with customers (with penalties); always looser than your SLO.
- **Error budget** = `100% − SLO`. At 99.9%, you may "spend" **0.1%** unavailability (~43 min/month) on
  failures and risky releases.

**Why error budgets are powerful:** they turn reliability into a **shared, quantified decision**. Budget
left → ship features faster. Budget exhausted → **freeze risky releases** and invest in reliability. It
ends the "devs want speed vs ops want stability" fight with data.

> **Senior answer:** "I don't chase 100% — it's infinitely expensive and users can't tell. I set an SLO
> from what users actually need, then the **error budget** governs release risk: spend it on velocity
> while it lasts, slow down when it's gone."

---

## 6. Alerting: on Symptoms, Not Causes

Good alerting wakes people **only** for things users feel.

- **Alert on symptoms / SLO burn** ("error rate up, latency SLO burning"), not on every cause ("CPU at
  80%" — which may be totally fine).
- **Burn-rate alerts** — page when you're consuming the error budget too fast (e.g. multi-window:
  fast-burn pages now, slow-burn opens a ticket).
- Kill **alert fatigue**: every page must be **actionable and urgent**; route non-urgent signals to
  tickets/dashboards. A noisy pager gets ignored — that's how outages get missed.

> **Trap:** alerting on causes (high CPU, a full disk that auto-rotates) creates noise and fatigue. Page
> on **user-visible symptoms and budget burn**; investigate causes with dashboards.

---

## 7. Incident Response

A repeatable process under pressure (interviewers love this):

1. **Detect** — alert/SLO breach.
2. **Triage & declare severity** — how many users, how bad.
3. **Assign roles** — **Incident Commander** (coordinates, decides), Comms lead, Ops/responders. The IC
   doesn't fix; they run the response.
4. **Mitigate first** — stop the bleeding (roll back, fail over, shed load, feature-flag off) **before**
   root-causing. Recovery > diagnosis during an active incident.
5. **Communicate** on a cadence — status page / stakeholders.
6. **Resolve, then postmortem.**

Key reflexes: a fast, safe **rollback** path and **feature flags** are your best incident tools (see the
CI/CD handbook).

---

## 8. Blameless Postmortems

After any significant incident, write a **blameless postmortem**: timeline, impact, root cause(s),
what went well/poorly, and **concrete, owned, dated action items** that you track to completion.

- **Blameless** = focus on the **system and process** that allowed a human action to cause harm, not the
  human. If one mistake can take prod down, the **system** is at fault.
- Goal: honest disclosure and **systemic** fixes. Blame drives problems underground and repeats outages.

> **Senior answer:** "Blameless isn't 'no accountability' — it's accountability to **fix the system**.
> People are honest when they won't be punished, and honesty is what prevents the next incident."

---

## 9. Reliability Engineering Practices

- **Toil** — manual, repetitive, automatable operational work that doesn't scale. SRE caps toil (e.g.
  ~50%) and **automates it away**; rising toil is a signal to invest.
- **Capacity planning & load testing** — know your headroom; test to failure to find the knee.
- **Graceful degradation** — shed load, serve stale/cached, disable non-critical features under stress
  rather than collapsing.
- **Redundancy & failover** — no single point of failure; practice failover (and **chaos
  engineering** — inject failures deliberately to verify resilience).
- **Health checks** — **liveness** (restart if dead) vs **readiness** (don't send traffic until ready);
  beware **gray failures** that pass naive health checks while degraded.

---

## 10. The Observability Tooling Landscape (with pros & cons)

Interviewers want to know you can **choose** tools, not just name them. The space splits by pillar, plus
all-in-one platforms.

**Metrics**

| Tool | Pros | Cons |
|---|---|---|
| **Prometheus** | De-facto standard, powerful **PromQL**, pull-based, huge ecosystem, free, Alertmanager, K8s-native | Single-node by default (needs **Thanos/Cortex/Mimir** for HA + long-term storage); pull model awkward for batch/short-lived jobs (**Pushgateway**); **high-cardinality labels blow up memory** |
| **Grafana** | Best-in-class **dashboards**, connects to many sources, alerting, free | Visualization only (needs a data source); dashboard sprawl |

**Logs**

| Tool | Pros | Cons |
|---|---|---|
| **ELK / Elastic Stack** (Elasticsearch + Logstash/Beats + Kibana) | Powerful **full-text search** & analytics, mature, flexible | **Resource-hungry & costly** to operate at scale; operational complexity |
| **Grafana Loki** | Cheap (**indexes labels, not full text**), Prometheus-style labels, integrates with Grafana | Weaker full-text search; best when you query **by labels** |
| **Fluent Bit / Fluentd / Vector / Logstash** | Collector/shipper layer; Fluent Bit is lightweight (K8s DaemonSet) | Logstash is heavy; another pipeline to run |

**Traces**

| Tool | Pros | Cons |
|---|---|---|
| **Jaeger / Zipkin** | Open-source tracing backends, span/trace views, service maps | Trace storage cost; another system to run |
| **Grafana Tempo** | **Cheap** trace storage (object storage, no index), pairs with Grafana/Loki | Find traces via IDs/labels (no rich trace search by default) |

**Standard & all-in-one**

- **OpenTelemetry (OTel)** — the **vendor-neutral standard** (SDKs + Collector) for all three signals.
  **Best practice: instrument once with OTel, export anywhere** → no vendor lock-in. Cons: still maturing
  in places; the Collector is one more component.
- **SigNoz** — **open-source, OpenTelemetry-native, single app for metrics + logs + traces**, backed by
  **ClickHouse**. **Pros:** one tool for all three pillars (no stitching Prometheus + Loki + Jaeger),
  **built-in correlation** across signals, self-hostable, a **cost-effective Datadog alternative**.
  **Cons:** younger/smaller ecosystem than Prometheus/Grafana, you operate ClickHouse, fewer
  integrations than incumbents.
- **Datadog / New Relic / Grafana Cloud / Honeycomb** — commercial SaaS, turnkey, great UX and
  correlation. **Cons:** **cost balloons** (per-host/ingest/cardinality pricing surprises), vendor
  lock-in, data leaves your infrastructure.

> **Senior answer:** "There are three real options: **best-of-breed** (Prometheus + Grafana + Loki +
> Tempo/Jaeger — free but you operate it), an **open-source all-in-one** like **SigNoz** (OTel-native,
> one app, ClickHouse), or **SaaS** like Datadog (turnkey but expensive and lock-in). I instrument with
> **OpenTelemetry** so the backend is a swappable decision, not a one-way door."

---

## 11. Tracking Logs & Traces Across Microservices (the hard part)

In a monolith you `grep` one log file. Across dozens of services and hundreds of instances, you can't —
these are the challenges and the fixes interviewers probe:

1. **Scattered logs** (every service/instance logs locally). → **Centralized aggregation**: a collector
   (Fluent Bit/Vector, a K8s **DaemonSet** scraping every node's stdout) ships all logs to one store
   (Loki/ELK). Never SSH into pods to read logs.
2. **Following one request across services.** → A **correlation/trace ID** generated at the **edge**
   (API gateway), **propagated** through every hop via headers (**W3C Trace Context `traceparent`**) and
   written into **every log line**. Distributed tracing (OTel) assembles the **span tree** so you see the
   full path and the slow hop.
3. **Context propagation across async boundaries.** → The trace context must cross threads, async calls,
   and **message queues** — inject the trace ID into **Kafka/RabbitMQ headers** so a consumer continues
   the same trace. OTel auto-instrumentation handles most of this.
4. **Volume & cost (high cardinality).** → **Sampling**: **head-based** (decide at the start, e.g. keep
   1%) is cheap; **tail-based** (decide after, **keep all errors/slow traces**) is smarter but needs a
   buffer. Add **retention tiers** (hot/cold) and drop noisy high-cardinality labels.
5. **Inconsistent log formats.** → Enforce **structured JSON logging** via a shared library and a
   standard schema (always include `trace_id`, `service`, `level`, `timestamp`).
6. **Clock skew across hosts.** → Don't trust cross-host wall-clock ordering — rely on **trace
   spans/causality** and keep NTP in sync. (See the Distributed Systems handbook on clocks.)
7. **PII / secrets in logs.** → **Redaction/scrubbing** at the logging layer; never log tokens, passwords,
   or personal data (GDPR/compliance).

> **Senior answer:** "The backbone is a **trace ID created at the edge and propagated everywhere** —
> across HTTP **and** message queues — stamped into structured logs, with logs centralized and traces
> sampled. That's what turns 'forty services' from undebuggable into a single reconstructable request."

---

## 12. Monitoring Tricks & Best Practices

- **Instrument with OpenTelemetry** — vendor-neutral; make the backend swappable.
- **Structured logs + trace ID in every line**; link logs ↔ traces ↔ metrics (Prometheus **exemplars**
  jump from a metric spike to an example trace).
- **Correlation ID at the edge**, propagate **W3C Trace Context** through every hop, including async/queues.
- **Sample traces** (tail-based keeps errors/slow) — don't store everything; control cost.
- **Dashboard RED/USE; alert on SLO burn rate**, not raw causes — keep the pager actionable.
- **Watch cardinality** — labels like `user_id`/`request_id` on metrics explode Prometheus; keep label
  sets bounded.
- **Dashboards & alerts as code** (versioned, reviewed) — not hand-clicked and undocumented.
- **The four golden signals** (latency, traffic, errors, saturation) as a baseline per service.
- **Test your observability:** after an incident, ask "could I actually debug this from what we collect?"
  — if not, add the missing signal.

> **Trap:** logging everything at full volume with high-cardinality labels and no sampling — it's
> expensive, slow, and *still* hard to search. Signal quality and correlation beat raw volume.

---

## 13. Interview Q&A Bank

**Q: How do you trace a single request across many microservices?**
> Generate a correlation/trace ID at the edge, propagate it through every hop via W3C Trace Context
> headers (and into message-queue headers for async), stamp it into structured logs, and use distributed
> tracing (OpenTelemetry → Jaeger/Tempo) to assemble the span tree and find the slow hop.

**Q: Compare Prometheus, Loki, ELK, Jaeger/Tempo, SigNoz, and Datadog.**
> Prometheus = metrics (PromQL, pull, scales via Thanos/Mimir). Loki = cheap label-indexed logs; ELK =
> powerful full-text logs but heavy/costly. Jaeger/Tempo = traces (Tempo is cheap object storage). SigNoz
> = open-source OTel-native all-in-one (metrics+logs+traces on ClickHouse). Datadog = turnkey SaaS, great
> UX but expensive and lock-in. Instrument with OpenTelemetry to stay portable.

**Q: Best-of-breed vs all-in-one observability?**
> Best-of-breed (Prometheus+Grafana+Loki+Tempo) is free but you operate it; all-in-one open-source
> (SigNoz) gives one correlated app you self-host; SaaS (Datadog) is turnkey but costly with lock-in.
> OTel keeps the backend a swappable decision.

**Q: How do you control observability cost / cardinality?**
> Sample traces (tail-based keeps errors/slow), avoid high-cardinality metric labels (user_id), use
> retention tiers (hot/cold), structured logs at sensible levels, and drop noisy data. Signal quality and
> correlation beat raw volume.

**Q: What are common microservices logging challenges?**
> Scattered logs (→ centralize via Fluent Bit/Loki/ELK), following a request (→ propagated trace ID),
> async context propagation (→ trace IDs in queue headers), inconsistent formats (→ structured JSON),
> clock skew (→ rely on spans/causality), and PII in logs (→ redaction).

**Q: Observability vs monitoring?**
> Monitoring answers predefined questions (is it up?); observability lets you ask new questions about
> unforeseen failures without new code, via high-cardinality structured telemetry.

**Q: What are the three pillars and how do they work together?**
> Metrics (aggregate trends/alerts), logs (exact event detail), traces (cross-service latency
> breakdown). Alert on a metric → trace finds the slow hop → logs show what it did, linked by a trace ID.

**Q: Why percentiles over averages?**
> Averages hide tail latency real users hit. p99/p99.9 reveal the slow fraction; with fan-out, users
> routinely experience the tail. Aggregate via histograms, don't average percentiles.

**Q: Explain SLI, SLO, SLA, and error budget.**
> SLI = measured indicator; SLO = internal target; SLA = customer contract (looser, with penalties);
> error budget = 1 − SLO, the allowed unreliability you spend on releases/failures.

**Q: How do error budgets resolve the dev-vs-ops tension?**
> They quantify acceptable risk: budget remaining → ship fast; budget exhausted → freeze risky changes
> and invest in reliability. A shared, data-driven decision instead of an argument.

**Q: What should you alert on?**
> User-visible symptoms and SLO/error-budget burn rate — not raw causes like CPU. Every page must be
> urgent and actionable to avoid alert fatigue; route the rest to tickets.

**Q: RED vs USE?**
> RED (Rate, Errors, Duration) for request-driven services; USE (Utilization, Saturation, Errors) for
> resources. RED shows symptoms, USE finds the saturated bottleneck.

**Q: Walk me through an incident response.**
> Detect → triage/severity → assign Incident Commander + comms → mitigate first (rollback/failover/flag)
> → communicate on cadence → resolve → blameless postmortem with owned, dated actions.

**Q: What makes a postmortem blameless and why?**
> It targets the system/process that allowed the error, not the person. It produces honest disclosure and
> systemic fixes; blame hides problems and repeats incidents.

**Q: Liveness vs readiness probes?**
> Liveness: restart a hung/dead instance. Readiness: stop routing traffic to an instance that isn't ready
> (warming up, dependency down) without killing it. Watch for gray failures that pass naive checks.

**Q: What is toil and how do SREs handle it?**
> Manual, repetitive, automatable ops work that scales with load. SRE bounds it (~50%) and automates it;
> growing toil signals where to invest engineering effort.

---

## 14. Cheat Sheet

- **Observability** = ask new questions without new code (unknown unknowns); **monitoring** = known
  questions.
- **Three pillars:** metrics (trends/alerts) + logs (event detail, **structured**) + traces
  (cross-service latency), linked by a **trace/correlation ID**. Standard: **OpenTelemetry**.
- **Percentiles, not averages** — p95/p99/p99.9; aggregate with histograms.
- **RED** (Rate/Errors/Duration) for services; **USE** (Utilization/Saturation/Errors) for resources.
- **SLI** (measured) → **SLO** (target) → **SLA** (contract). **Error budget = 1 − SLO** governs release
  risk; don't chase 100%.
- **Alert on symptoms + budget burn rate**, not causes; keep the pager actionable (no fatigue).
- **Incident:** declare severity, **Incident Commander**, **mitigate first** (rollback/failover/flag),
  communicate, then **blameless postmortem** with owned, dated actions.
- **SRE practices:** cut **toil** (automate), capacity/load test, **graceful degradation**, redundancy +
  **chaos engineering**, **liveness vs readiness**, watch **gray failures**.
- **Tooling:** **Prometheus** (metrics/PromQL, scale via Thanos/Mimir) + **Grafana** (dashboards) ·
  **Loki** (cheap label logs) / **ELK** (powerful full-text, heavy) · **Jaeger/Tempo** (traces) ·
  **OpenTelemetry** (instrument once, vendor-neutral) · **SigNoz** (OSS OTel-native all-in-one) ·
  **Datadog** (turnkey SaaS, costly/lock-in).
- **Microservices tracking:** **centralize logs** (Fluent Bit → Loki/ELK), **trace ID at the edge**
  propagated via **W3C Trace Context** (incl. queue headers) into **structured JSON logs**; **sample**
  traces (tail-based keeps errors); watch **cardinality**; redact **PII**.
- **Best practices:** OTel instrumentation, logs↔traces↔metrics linkage (exemplars), **four golden
  signals**, dashboards/alerts **as code**, test that you can actually debug from what you collect.

---

*End of handbook. The signal: you don't just build systems, you **run** them — measure what users feel
(percentiles, RED), set **SLOs with error budgets**, alert on **symptoms**, and respond with
**mitigate-first incidents and blameless postmortems** that make the system stronger.*
