---
title: "Spring Boot — Interview Handbook"
description: "A deep, easy-to-understand guide to Spring & Spring Boot for senior interviews: the IoC container, bean lifecycle, auto-configuration internals, AOP &…"
sidebar:
  label: "Spring Boot"
---

> A deep, easy-to-understand guide to Spring & Spring Boot for senior interviews: the IoC container,
> bean lifecycle, auto-configuration internals, AOP & proxies, transactions, the tricky proxy/self-
> invocation traps, async/scheduling, configuration, Actuator, testing, and the gotchas that separate
> seniors from juniors — plus a deep Q&A bank.
>

---

## 1. Spring vs Spring Boot (and the "magic")

- **Spring Framework** = the core (IoC container, DI, AOP, MVC, transactions). Powerful but needs lots
  of configuration.
- **Spring Boot** = Spring + **opinionated auto-configuration** + **starters** + embedded server +
  production features (Actuator). It removes boilerplate so you "just run."

> **Senior framing:** "Spring Boot isn't a new framework — it's convention-over-configuration on top
> of Spring: starters pull curated dependencies, auto-configuration wires beans based on what's on the
> classpath, and an embedded server makes the app a self-contained jar."

**The three pillars:** **Starters** (dependency bundles), **Auto-configuration** (conditional bean
wiring), **Actuator** (ops endpoints).

---

## 2. IoC & Dependency Injection

**Inversion of Control (IoC):** instead of objects creating their dependencies, the **container**
creates and injects them. The **ApplicationContext** is the IoC container.

**Injection types:**
| Type | How | Verdict |
|---|---|---|
| **Constructor** | Deps via constructor | **Preferred** — immutable, testable, fails fast, enables `final`, no circular deps hidden |
| **Setter** | Via setters | For optional deps |
| **Field** (`@Autowired`) | Directly on fields | Discouraged — hides deps, hard to test, no immutability |

> **"Why constructor injection?"** Dependencies are explicit and required, the object is immutable
> (`final` fields), it's trivially testable without Spring, and **circular dependencies fail at startup**
> instead of hiding. Field injection hides dependencies and needs reflection to test.

**Resolving ambiguity** (multiple beans of a type): `@Primary`, `@Qualifier("name")`, or inject a
`List<T>`/`Map<String,T>` of all of them.

> **Circular dependency trap:** A→B and B→A with constructor injection **fails at startup**
> (`BeanCurrentlyInCreationException`). Fix the design, or use `@Lazy` / setter injection as a band-aid.
> (Spring Boot 2.6+ disables circular refs by default.)

---

## 3. Bean Scopes & Lifecycle

**Scopes:**
| Scope | Instances |
|---|---|
| **singleton** (default) | One per container — shared |
| **prototype** | New instance every injection/lookup |
| **request / session / application** | Web-scoped |
| **websocket** | Per WebSocket session |

> **Singleton-injecting-prototype trap:** a singleton injects a prototype **once** → you keep the
> same instance forever (scope is ignored). Fix with `@Lookup`, `ObjectProvider`, or scoped proxies.

> **Singletons must be stateless/thread-safe** — they're shared across all threads. Mutable instance
> state = race conditions.

**Lifecycle hooks:** `@PostConstruct` (after deps injected) → bean in use → `@PreDestroy` (on
shutdown). Also `InitializingBean`/`DisposableBean`, `BeanPostProcessor` (intercept all beans),
`BeanFactoryPostProcessor` (modify bean definitions before instantiation — e.g.,
`PropertySourcesPlaceholderConfigurer`).

> Order: BeanFactoryPostProcessor → instantiate → populate deps → BeanPostProcessor.before →
> `@PostConstruct`/afterPropertiesSet → BeanPostProcessor.after → ready. **AOP proxies are created in
> a BeanPostProcessor** — key to understanding self-invocation (§6).

---

## 4. Auto-Configuration Internals

The "magic" demystified — a top senior question.

- `@SpringBootApplication` = `@SpringBootConfiguration` + `@EnableAutoConfiguration` +
  `@ComponentScan`.
- **`@EnableAutoConfiguration`** loads auto-config classes listed in
  `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (was
  `spring.factories` pre-2.7).
- Each auto-config class uses **`@Conditional`** annotations to wire beans **only when appropriate**:
  - `@ConditionalOnClass` — a class is on the classpath (e.g., `DataSource` present → configure JPA).
  - `@ConditionalOnMissingBean` — only if **you haven't defined your own** (so your bean wins).
  - `@ConditionalOnProperty`, `@ConditionalOnBean`, `@ConditionalOnWebApplication`, etc.

> "Auto-configuration is just `@Configuration` classes guarded by `@Conditional`. The key is
> **`@ConditionalOnMissingBean`** — Spring backs off the moment you define your own bean, so defaults
> never override your explicit config."

> **"How do you debug what got auto-configured?"** Run with `--debug` for the **Conditions
> Evaluation Report** (what matched/didn't and why), or use Actuator `/conditions`. Exclude with
> `@SpringBootApplication(exclude = ...)`.

**Custom starter:** an auto-config module + `AutoConfiguration.imports` + a starter pom that bundles
deps — how libraries integrate with Boot.

---

## 5. Component Scanning, Stereotypes & Conditions

- **Stereotypes:** `@Component` (generic), `@Service`, `@Repository` (adds exception translation),
  `@Controller`/`@RestController`, `@Configuration` (bean factory).
- **`@Bean` vs `@Component`:** `@Component` is class-level auto-detected; `@Bean` is method-level in a
  `@Configuration` class (for third-party classes you can't annotate).
- **`@Configuration` proxying:** Spring proxies `@Configuration` classes so calling one `@Bean`
  method from another returns the **same singleton** (not a new object). With `proxyBeanMethods=false`
  (Boot's "lite" mode), that guarantee is gone.

---

## 6. AOP & Proxies (the tricky engine)

**AOP (Aspect-Oriented Programming)** factors out **cross-cutting concerns** (transactions, security,
logging, caching) into **aspects** instead of scattering them.

**Vocabulary:** **Aspect** (the module), **Advice** (the action: `@Before`, `@After`, `@Around`),
**Pointcut** (where it applies), **Join point** (a method execution).

### How Spring AOP works — proxies
Spring wraps your bean in a **proxy** that runs the advice around your method. Two kinds:
- **JDK dynamic proxy** — if the bean implements an interface (proxies the interface).
- **CGLIB proxy** — subclass-based, if no interface (Boot defaults to CGLIB).

### The self-invocation trap(the #1 senior gotcha)
Proxy-based AOP only intercepts calls that go **through the proxy**. A method calling **another method
in the same class** (`this.other()`) **bypasses the proxy** → `@Transactional`, `@Cacheable`,
`@Async`, `@PreAuthorize` on that inner method **silently don't apply**.

```java
@Service
class OrderService {
    public void place() { this.charge(); }      // internal call — bypasses proxy
    @Transactional public void charge() { ... }  // NOT transactional when called via place()!
}
```
**Fixes:** move the method to **another bean**, self-inject the proxy, or use
`AopContext.currentProxy()`. (AspectJ compile/load-time weaving avoids the proxy limitation entirely.)

> **"Why didn't my `@Transactional`/`@Async` work?"** Proxy limitations: (1) **self-invocation**,
> (2) method **not public** (default proxy mode), (3) the call doesn't go through a Spring-managed bean.
> Know all three.

---

## 7. Transactions — the Deep Dive

`@Transactional` wraps a method in a DB transaction via the proxy + a `PlatformTransactionManager`.

### Propagation (how nested transactional calls behave)
| Propagation | Behavior |
|---|---|
| **REQUIRED** (default) | Join existing tx, or create one |
| **REQUIRES_NEW** | Always a **new** tx; suspends the outer one |
| **NESTED** | Savepoint within the current tx (partial rollback) |
| **MANDATORY** | Must already be in a tx, else error |
| **SUPPORTS / NOT_SUPPORTED / NEVER** | Run with/without/forbid a tx |

> **REQUIRES_NEW gotcha:** an inner `REQUIRES_NEW` commits **independently** — if the outer rolls
> back, the inner's work **stays committed**. Great for audit logs, dangerous if you expected atomicity.

### Isolation levels (what concurrent txns see)
`READ_UNCOMMITTED` → `READ_COMMITTED` (common default) → `REPEATABLE_READ` → `SERIALIZABLE`. They
prevent **dirty reads, non-repeatable reads, phantom reads** respectively (tighter = safer but slower).

### Rollback rules
By default Spring rolls back on **unchecked (RuntimeException) and Errors** — **NOT checked
exceptions**. Use `@Transactional(rollbackFor = Exception.class)` to change this. A swallowed
exception = no rollback.

> "Defaults: REQUIRED propagation, the DB's default isolation, rollback only on runtime exceptions.
> I put `@Transactional` on **service** methods, keep them short, use `readOnly=true` for queries, and
> watch self-invocation + checked-exception rollback."

> More traps: `@Transactional` on **private/non-public** methods is ignored; transaction commits at
> method **return** (lazy loading after that throws); long transactions hold DB connections.

---

## 8. Configuration & Profiles

- **Property sources & precedence** (highest wins): command-line args → env vars → `application-
  {profile}.yml` → `application.yml` → defaults. (Plus config server, `@TestPropertySource`, etc.)
- **`@ConfigurationProperties`** — bind a whole group of properties to a typed POJO (validated,
  relaxed binding). Preferred over scattering `@Value`.
- **`@Value("${...}")`** — inject a single property (no relaxed binding/validation).
- **Profiles** — `@Profile("prod")`, `spring.profiles.active=prod`; profile groups; environment-
  specific beans/config.
- **Externalized config** — 12-factor; secrets via env/Vault/config server, not in the jar.

> **`@Value` vs `@ConfigurationProperties`:** use `@ConfigurationProperties` for grouped, typed,
> validated, relaxed-bound config; `@Value` for one-off simple values.

---

## 9. Async, Scheduling & the Event System

- **`@Async`** — runs a method on a separate thread (returns `void`/`Future`/`CompletableFuture`).
  Needs `@EnableAsync`; subject to the **self-invocation** rule and uses a configurable `Executor`
  (configure your own pool — the default `SimpleAsyncTaskExecutor` creates a thread per task!).
- **`@Scheduled`** — cron/fixed-rate/fixed-delay jobs (`@EnableScheduling`). single-threaded by
  default; in a cluster they run on **every instance** (use ShedLock/leader election for once-only).
- **Application events:** `ApplicationEventPublisher.publishEvent(...)` + `@EventListener`
  (synchronous by default; `@Async` to decouple). Good for in-process decoupling;
  `@TransactionalEventListener` fires after commit.

---

## 10. Spring MVC vs WebFlux (Reactive)

| | **Spring MVC** | **Spring WebFlux** |
|---|---|---|
| Model | Servlet, **blocking**, thread-per-request | **Reactive**, non-blocking event loop |
| Types | `@RestController` returns objects | Returns `Mono<T>`/`Flux<T>` |
| Server | Tomcat (default) | Netty (default) |
| Best for | Most apps, blocking JDBC | High concurrency, streaming, I/O-bound |
| Backpressure | No | **Yes** (Reactive Streams) |

> **"When WebFlux over MVC?"** When you have **many concurrent, I/O-bound** calls and a fully
> non-blocking stack (R2DBC, WebClient). If you block (JDBC, blocking libs) in WebFlux you ruin it —
> blocking the event loop is worse than thread-per-request. Most CRUD apps are fine (and simpler) on MVC.

> "Reactive only pays off end-to-end non-blocking. A single blocking call on the event loop negates
> the benefit. With Java 21 **virtual threads**, MVC gets much of the scalability with simpler code."

---

## 11. Exception Handling & Validation

- **`@RestControllerAdvice` + `@ExceptionHandler`** — centralized, consistent error responses.
- **`@Valid` / Bean Validation** (`@NotNull`, `@Size`, custom validators) on request bodies →
  `MethodArgumentNotValidException` handled globally.
- **`ResponseStatusException`** / `ProblemDetail` (RFC 7807) for structured errors.
- **`ResponseEntity<T>`** for full control of status/headers/body.

> "I centralize errors in a `@RestControllerAdvice`, return RFC 7807 `ProblemDetail`, and validate
> inputs with `@Valid` — consistent, documented error contracts instead of ad-hoc try/catch."

---

## 12. Actuator, Metrics & Observability

- **Actuator** exposes ops endpoints: `/health`, `/info`, `/metrics`, `/env`, `/loggers`, `/threaddump`,
  `/heapdump`, `/conditions`, `/mappings`. **Secure them** — don't expose `/env`/`/heapdump`
  publicly.
- **Health groups** + liveness/readiness probes (`/health/liveness`, `/health/readiness`) for
  Kubernetes.
- **Micrometer** — the metrics facade → Prometheus/Datadog/etc. Custom metrics via `MeterRegistry`.
- **Distributed tracing** — Micrometer Tracing (formerly Sleuth) + OpenTelemetry → Zipkin/Jaeger.

---

## 13. Testing (slices, context caching)

- **`@SpringBootTest`** — full context (integration tests). Slow — Spring **caches contexts** across
  tests with identical config; dirtying config (`@MockBean`, `@TestPropertySource`,
  `@DirtiesContext`) creates new contexts and slows the suite.
- **Test slices** — load only part of the context: `@WebMvcTest` (controllers + MockMvc),
  `@DataJpaTest` (repositories + in-memory/Testcontainers DB), `@JsonTest`, `@RestClientTest`.
- **`@MockBean`** — replace a bean with a Mockito mock in the context.
- **Testcontainers** — real DBs/brokers in Docker for trustworthy integration tests.

> **"Why are my Spring tests slow?"** Too many distinct contexts. Reuse configuration so context
> caching kicks in; use **slices** instead of full `@SpringBootTest`; minimize `@DirtiesContext`/
> per-test `@MockBean` variations.

---

## 14. Performance & Startup (native, lazy)

- **Lazy initialization** (`spring.main.lazy-initialization=true`) — faster startup, but defers errors
  and first-request latency.
- **Spring Boot 3 + GraalVM Native Image** — AOT-compiled native executables: millisecond startup,
  low memory (serverless). Cost: closed-world (reflection needs hints), longer builds, lower peak
  throughput.
- **AOT processing**, conditional beans pruned at build time.
- **Virtual threads (Java 21, Boot 3.2+)** — `spring.threads.virtual.enabled=true` for cheap blocking
  concurrency on MVC.

---

## 15. Advanced Gotchas (senior-level)

1. **Self-invocation** breaks `@Transactional`/`@Async`/`@Cacheable`/`@PreAuthorize` (§6).
2. **Checked exceptions don't roll back** transactions by default (§7).
3. **`@Async` default executor** creates unbounded threads — always configure a bounded pool.
4. **`@Scheduled` in a cluster** runs on every node — use ShedLock/leader election.
5. **Singletons are shared** — don't store request state in fields.
6. **`open-in-view=true`** (default) hides lazy-loading issues and holds DB connections through view
   render — disable it.
7. **Prototype in singleton** keeps one instance — use `ObjectProvider`/`@Lookup`.
8. **`@ConfigurationProperties` needs binding** — getters/setters (or records/constructor binding) and
   `@EnableConfigurationProperties`/`@ConfigurationPropertiesScan`.
9. **Bean definition order / `@DependsOn`** for init ordering; circular deps now fail by default.
10. **Filter vs Interceptor vs AOP** — filters (servlet level, all requests), `HandlerInterceptor` (MVC
    pre/post handler), AOP (any bean method). Pick the right layer.
11. **N+1 from JPA** surfacing in REST endpoints — use DTO projections / entity graphs.
12. **`RestTemplate` is in maintenance** — prefer `WebClient` (or `RestClient` in Boot 3.2).

> "The senior trifecta to mention unprompted: **proxy self-invocation**, **checked-exception
> rollback**, and **open-in-view**. They reveal you understand how Spring actually works, not just the
> annotations."

---

## 16. Interview Q&A Bank

**Q: Spring vs Spring Boot?**
> Spring is the core framework (IoC/DI/AOP/MVC); Boot adds auto-configuration, starters, an embedded
> server, and Actuator for convention-over-configuration and self-contained jars.

**Q: How does auto-configuration work?**
> `@EnableAutoConfiguration` loads conditionally-guarded `@Configuration` classes (from
> AutoConfiguration.imports). `@ConditionalOnClass`/`OnMissingBean`/`OnProperty` decide what to wire;
> your beans win via `@ConditionalOnMissingBean`. Debug with `--debug`/`/conditions`.

**Q: Why constructor injection over field injection?**
> Explicit required deps, immutability (`final`), trivially testable without Spring, and circular deps
> fail fast instead of hiding.

**Q: Bean scopes? Singleton thread-safety?**
> singleton (default, one shared), prototype (new each time), request/session. Singletons are shared
> across threads — keep them stateless or you get races.

**Q: Why didn't @Transactional/@Async work?**
> Proxy-based AOP: self-invocation (this.method()) bypasses the proxy, non-public methods aren't
> advised, or the call doesn't go through a Spring bean.

**Q: Explain transaction propagation, esp. REQUIRES_NEW.**
> REQUIRED joins/creates; REQUIRES_NEW suspends the outer and runs independently — it commits even if
> the outer rolls back; NESTED uses savepoints for partial rollback.

**Q: Do checked exceptions roll back transactions?**
> No — only unchecked exceptions/Errors by default. Use rollbackFor for checked exceptions.

**Q: How do AOP proxies work (JDK vs CGLIB)?**
> Spring wraps beans in proxies running advice around methods. JDK dynamic proxy for interfaces, CGLIB
> subclassing otherwise (Boot default). Self-invocation bypasses them.

**Q: @Value vs @ConfigurationProperties?**
> @Value for single simple values; @ConfigurationProperties for grouped, typed, validated, relaxed-
> bound config.

**Q: MVC vs WebFlux — when reactive?**
> Reactive for high-concurrency I/O-bound, fully non-blocking stacks. Blocking anywhere in WebFlux
> negates it. Most apps are simpler/fine on MVC (now boosted by virtual threads).

**Q: Why are Spring tests slow and how to speed them?**
> Multiple distinct application contexts. Reuse config for context caching, use slices (@WebMvcTest/
> @DataJpaTest), minimize @DirtiesContext and per-test mock variations.

**Q: How do you run a scheduled job once in a cluster?**
> @Scheduled runs on every instance; use ShedLock or leader election to ensure single execution.

**Q: How does Boot support native images and why?**
> Spring Boot 3 AOT + GraalVM for native executables: instant startup, low memory (serverless), at the
> cost of closed-world reflection hints and lower peak throughput.

---

## 17. Cheat Sheet

- **Boot = Spring + auto-config + starters + embedded server + Actuator.**
- **Constructor injection**, stateless singletons, resolve ambiguity with `@Primary`/`@Qualifier`.
- **Auto-config = `@Configuration` + `@Conditional`**; `@ConditionalOnMissingBean` lets your beans win;
  debug with `--debug`.
- **AOP = proxies** (JDK/CGLIB); **self-invocation bypasses** advice (transactions/async/cache/security).
- **@Transactional:** REQUIRED default; REQUIRES_NEW commits independently; rolls back on unchecked
  only; on services; readOnly for queries.
- **Config precedence:** CLI > env > profile yml > application.yml; `@ConfigurationProperties` for
  typed config.
- **@Async/@Scheduled:** configure pools; cluster-safe scheduling via ShedLock.
- **MVC vs WebFlux:** reactive only if fully non-blocking; virtual threads help MVC.
- **Errors:** `@RestControllerAdvice` + `@Valid` + ProblemDetail.
- **Actuator + Micrometer + tracing**; secure sensitive endpoints; liveness/readiness probes.
- **Testing:** slices + context caching; Testcontainers for real deps.
- **Senior gotchas:** self-invocation, checked-exception rollback, open-in-view, async default executor,
  clustered @Scheduled, prototype-in-singleton.

---

*End of handbook. The senior signal in Spring interviews is understanding **proxies, the bean lifecycle,
and auto-configuration conditionals** — the "magic" is just `@Conditional` + proxies.*
