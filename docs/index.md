# Interview Handbooks

A free, open-source library of **senior, staff, and principal level** engineering interview
handbooks. Every guide is written to the same standard: clear explanations, real examples, the
tricky points called out, common mistakes flagged, and a curated **interview Q&A bank** with
strong, ready-to-say answers.

!!! tip "How to use this"
    Skim the **Cheat Sheet** at the bottom of a handbook the night before. Read the full guide a
    few days before. The inline callouts predict the questions an interviewer will actually ask
    and hand you a senior-sounding way to answer them.

## What you get in every handbook

- **Plain-English first** — concepts explained simply, then deeply.
- **Real examples & diagrams** — not just definitions.
- **Inline signal labels** instead of icons:
    - **What they're testing** — the intent behind a question.
    - **Senior answer** — a high-signal line you can say out loud.
    - **Trap** — the common mistake that fails candidates.
- **Interview Q&A bank** — rapid-fire questions with model answers.
- **Cheat Sheet** — one-screen revision.

## The library

### Data & Storage
- [PostgreSQL](data-storage/postgresql.md) — MVCC, indexing, HOT updates, locking, partitioning.
- [Redis](data-storage/redis.md) — data types, persistence, eviction, clustering, patterns.
- [Elasticsearch](data-storage/elasticsearch.md) — inverted index, analyzers, shards, scoring, aggregations.

### Messaging & APIs
- [Kafka vs RabbitMQ](messaging/kafka-vs-rabbitmq.md) — log vs broker, delivery semantics, ordering, when to use which.
- [gRPC & Protobuf](messaging/grpc.md) — IDL, wire format, streaming, backward compatibility.

### Backend
- [Spring Boot](backend/spring-boot.md) — IoC/DI, bean lifecycle, auto-config, AOP, transactions, MVC vs WebFlux.
- [Hibernate & JPA](backend/hibernate-jpa.md) — entity lifecycle, lazy loading, N+1, caching, transactions.
- [JVM Internals (Java & Kotlin)](backend/jvm-internals.md) — memory model, GC, class loading, concurrency.

### Architecture & Infrastructure
- [System Design](architecture/system-design.md) — scaling, caching, queues, consistency, real interview walkthroughs.
- [Microservices](architecture/microservices.md) — decomposition, Saga, Outbox, CQRS, resilience, observability.
- [Docker](architecture/docker.md) — images, layers, networking, volumes, Compose.
- [Kubernetes](architecture/kubernetes.md) — architecture, controllers, networking, scaling, rollouts, security.
- [Nginx & Load Balancing](architecture/nginx-load-balancing.md) — reverse proxy, LB algorithms, L4 vs L7, TLS, caching.

### Security
- [OAuth2 & JWT](security/oauth2-jwt.md) — flows, PKCE, OIDC, token validation, attacks & defenses.

### Tooling
- [Git](tooling/git.md) — the object model, branching, rebase vs merge, recovery, real workflows.

### AI / ML
- [LLM Engineering](ai-ml/llm-engineering.md) — prompting, RAG, agents, evaluation, production concerns.

---

## Open source

This is an open-source project maintained by **[Saeid Darvish](https://saeiddrv.com)** for the
community. Spotted a mistake or want to add a topic? Use the **edit (pencil) button** on any page,
or open a pull request — see the [contributing guide](https://github.com/saeiddrv/interview-handbooks/blob/main/CONTRIBUTING.md).
