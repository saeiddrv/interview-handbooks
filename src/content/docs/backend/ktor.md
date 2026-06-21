---
title: "Ktor (vs Spring Boot) — Interview Handbook"
description: "Ktor deep dive: routing, the plugin pipeline, authentication, the Ktor client, testing, and a Ktor vs Spring Boot comparison — with a Q&A bank."
sidebar:
  label: "Ktor (vs Spring Boot)"
---

> A practical guide to **Ktor**, JetBrains' lightweight, **coroutine-native** Kotlin web framework:
> how it differs from the annotation-and-reflection world of Spring, its server engines, the
> application/module **DSL**, the routing DSL, the **plugin pipeline**, content negotiation and
> serialization, authentication, the multiplatform **Ktor client**, configuration and testing — and a
> head-to-head **Ktor vs Spring Boot** comparison so you can argue the tradeoff. With a Q&A bank and
> cheat sheet.

---

## 1. What Ktor Is (and the philosophy)

**Ktor** is a Kotlin framework for building **asynchronous** servers and clients, built **from the
ground up on Kotlin coroutines**. Its design philosophy is the near-opposite of Spring's:

- **Explicit over magic** — you wire things in code with a **DSL**; there are **no annotations**, almost
  no reflection, and no classpath-scanning auto-configuration. What you see is what runs.
- **Lightweight & modular** — the core is tiny; you add only the **plugins** you need. Fast startup, low
  memory → good for **microservices, serverless, and gateways**.
- **Async by default** — every request handler is a **`suspend` function**, so non-blocking I/O is the
  natural state, not an opt-in reactive mode.
- **Multiplatform** — the **Ktor client** runs on Kotlin Multiplatform (JVM, Android, iOS, JS, Native);
  the server is primarily JVM.

> **Senior answer:** "Ktor is the un-Spring: instead of convention, annotations, and a big IoC
> container, you compose a small set of coroutine-based building blocks explicitly in a DSL. You trade
> Spring's vast ecosystem and magic for simplicity, transparency, fast startup, and async-by-default."

---

## 2. A Minimal Ktor Server

```kotlin
fun main() {
    embeddedServer(Netty, port = 8080) {   // pick an engine, configure the app
        routing {
            get("/health") {
                call.respondText("OK")     // suspend handler — non-blocking
            }
        }
    }.start(wait = true)
}
```

- `embeddedServer(engine) { ... }` — start a server with a chosen **engine**; the lambda is the
  **application module** where you `install` plugins and define `routing`.
- The handler lambda runs in a coroutine, so you can call other `suspend` functions (DB, HTTP) directly
  without blocking a thread.

---

## 3. Engines (the pluggable I/O layer)

Ktor separates the **framework** from the **engine** that actually does the network I/O. You choose one:

| Engine | Nature | Use |
|---|---|---|
| **Netty** | Async, JVM, most popular | Default for production servers |
| **CIO** | Coroutine-based I/O, pure Kotlin | Lightweight, multiplatform-friendly |
| **Jetty** | Servlet-based | When you need Jetty/servlet integration |
| **Tomcat** | Servlet-based | Existing Tomcat environments |

> **Nice to know:** the engine is swappable because Ktor's pipeline is engine-agnostic. **Netty** and
> **CIO** are fully async; the servlet engines (Jetty/Tomcat) bridge to a blocking servlet model.

---

## 4. Application & Modules

A Ktor app is organized into **modules** — ordinary functions on `Application` that install plugins and
routes. This is Ktor's unit of composition (the rough equivalent of Spring's `@Configuration`).

```kotlin
fun Application.module() {
    install(ContentNegotiation) { json() }
    install(CallLogging)
    configureRouting()
}
fun Application.configureRouting() { routing { /* ... */ } }
```

Modules can be wired in code or referenced from configuration (`application.conf`), which keeps startup
explicit and testable.

---

## 5. Routing DSL

Routes are defined with a nested DSL — no `@RequestMapping` annotations:

```kotlin
routing {
    route("/users") {
        get { call.respond(userService.all()) }              // GET /users
        get("/{id}") {                                        // GET /users/42
            val id = call.parameters["id"]!!.toLong()
            call.respond(userService.find(id))
        }
        post {
            val dto = call.receive<CreateUser>()              // deserialize body
            call.respond(HttpStatusCode.Created, userService.create(dto))
        }
    }
}
```

- **`ApplicationCall`** is the request/response handle: `call.respond()`, `call.receive<T>()`,
  `call.parameters`, `call.request`, `call.respondText()`.
- Routes **nest** and can share interceptors (auth, etc.) at any level.
- Type-safe routing is available via the **Resources** plugin (`@Resource` classes) for compile-checked
  URLs.

---

## 6. The Plugin Pipeline (Ktor's core mechanism)

This is the concept interviewers probe. Every request flows through a **pipeline** of **phases**, and
**plugins** (formerly "features") are interceptors installed into those phases. It's how Ktor does
cross-cutting concerns — the analogue of Spring's filters/interceptors/AOP, but explicit and
coroutine-based.

```kotlin
install(ContentNegotiation) { json() }   // serialize/deserialize JSON
install(CORS) { anyHost() }
install(Compression)
install(CallLogging)
install(StatusPages) {                   // central exception handling
    exception<NotFoundException> { call, _ -> call.respond(HttpStatusCode.NotFound) }
}
install(Authentication) { jwt { /* verify */ } }
```

Common plugins: **ContentNegotiation** (serialization), **Authentication**, **Sessions**, **CORS**,
**Compression**, **CallLogging**, **StatusPages** (error handling), **RateLimit**, **CallId**,
**DefaultHeaders**.

> **Senior answer:** "Ktor's request handling is a **pipeline of phases** you intercept with plugins.
> Instead of annotations and proxies, cross-cutting concerns are explicit `install {}` calls — you can
> read the whole request lifecycle in one place."

---

## 7. Content Negotiation & Serialization

Ktor doesn't bake in a JSON library; you choose one via **ContentNegotiation**:

```kotlin
install(ContentNegotiation) { json() }   // kotlinx.serialization (idiomatic Kotlin)
// alternatives: jackson { }, gson { }

@Serializable data class User(val id: Long, val name: String)   // kotlinx.serialization
```

- **kotlinx.serialization** is the idiomatic choice — compile-time, reflection-free, multiplatform.
- `call.receive<User>()` deserializes the body; `call.respond(user)` serializes the response based on the
  `Accept`/`Content-Type` negotiated.

---

## 8. Authentication & Sessions

The **Authentication** plugin supports `basic`, `form`, `digest`, `bearer`, **`jwt`**, `oauth`, and
`session` providers; protected routes go inside an `authenticate { }` block:

```kotlin
install(Authentication) {
    jwt("auth-jwt") { verifier(jwtVerifier); validate { cred -> /* -> Principal */ } }
}
routing {
    authenticate("auth-jwt") {
        get("/me") { val p = call.principal<JWTPrincipal>(); call.respond(...) }
    }
}
```

**Sessions** (cookie- or header-based, optionally signed/encrypted) are installed via `install(Sessions)`
and read/written with `call.sessions`. (See the OAuth2 & JWT handbook for the token concepts.)

---

## 9. Async by Default (the coroutine model)

The defining trait: **handlers are `suspend` functions**, so Ktor is non-blocking end-to-end **without a
separate "reactive" programming model**. You write straight-line sequential code that *is* async.

```kotlin
get("/dashboard") {
    coroutineScope {
        val user   = async { userService.fetch(id) }     // run concurrently
        val orders = async { orderService.recent(id) }    // both suspend, no thread blocked
        call.respond(Dashboard(user.await(), orders.await()))
    }
}
```

- Suspension parks the coroutine (frees the thread) on I/O — the same benefit as Spring WebFlux's event
  loop, but with **readable sequential code** instead of `Mono`/`Flux` operator chains.
- **Trap (the same as everywhere):** a **blocking** call (JDBC, `Thread.sleep`, blocking libs) inside a
  handler blocks the engine's thread. Wrap blocking work in `withContext(Dispatchers.IO)`. (See the
  Concurrency handbook for the coroutine/dispatcher details.)

> **Senior answer:** "Ktor gets WebFlux-style non-blocking scalability with coroutine ergonomics — the
> code reads sequentially but suspends instead of blocking. The catch is identical to reactive: one
> blocking call on the engine thread ruins it, so blocking work goes on `Dispatchers.IO`."

---

## 10. No Built-in DI (a key contrast)

Ktor has **no dependency-injection container**. You wire dependencies **manually** or with a lightweight
library — typically **Koin** (or Kodein):

```kotlin
val appModule = module { single { UserService(get()) }; single { UserRepository() } }
fun Application.module() { install(Koin) { modules(appModule) } }
```

This is deliberate (keeps the core small and explicit) and a major day-to-day difference from Spring's
all-encompassing IoC container.

> **What they're testing:** awareness that Ktor trades Spring's automatic DI/bean graph for explicit
> wiring — simpler and more transparent, but you (or Koin) do the work Spring's container does for free.

---

## 11. Configuration

Two styles, often combined:

- **Code (DSL)** — `embeddedServer(Netty, port = 8080) { ... }` for full programmatic control.
- **File** — `application.conf` (**HOCON**) or YAML, loaded by **`EngineMain`**; good for ports,
  modules, and environment-specific values:

```hocon
ktor {
    deployment { port = 8080 }
    application { modules = [ com.example.ApplicationKt.module ] }
}
```

Environment values come from the config + system properties/env vars — no `@Value`/`@ConfigurationProperties` machinery.

---

## 12. Testing

Ktor ships a **test host** that runs the app **in-memory without real network sockets** — fast and
deterministic:

```kotlin
@Test fun health() = testApplication {
    application { module() }
    val res = client.get("/health")
    assertEquals(HttpStatusCode.OK, res.status)
}
```

`testApplication { }` spins up the app with a test engine and gives you a configured client. (See the
Testing Strategy handbook for the broader approach.)

---

## 13. The Ktor Client (bonus: multiplatform)

Ktor is also a **coroutine-based HTTP client**, and it's **multiplatform** — the same client code runs on
the JVM, Android, iOS, JS, and Native:

```kotlin
val client = HttpClient(CIO) { install(ContentNegotiation) { json() } }
val user: User = client.get("https://api/users/1").body()   // suspend, non-blocking
```

This is a real differentiator: a shared networking layer in Kotlin Multiplatform projects, where Spring's
`RestClient`/`WebClient` are JVM-only.

---

## 14. Ktor vs Spring Boot (the comparison)

| Dimension | **Ktor** | **Spring Boot** |
|---|---|---|
| Language | **Kotlin-first** | Java-first (Kotlin supported) |
| Style | Explicit **DSL**, no annotations | Annotations + convention + auto-config |
| Async model | **Coroutines** (async by default) | Thread-per-request (MVC) **or** Reactor (WebFlux) |
| DI | **None built-in** (Koin/manual) | Full **IoC container** out of the box |
| "Magic"/reflection | Minimal, transparent | Heavy auto-config/reflection (AOT improving it) |
| Startup / footprint | **Fast, small** | Slower, larger (native image helps) |
| Ecosystem | Smaller, younger | **Huge, mature** (Data, Security, Cloud, Batch…) |
| Persistence | Bring your own (Exposed, JDBC) | **Spring Data/JPA** integrated |
| Learning curve | Simple, few concepts | Steeper, many conventions |
| Multiplatform | **Client is KMP** | JVM only |
| Best for | Lightweight microservices, serverless, gateways, KMP | Enterprise apps, large teams, broad integration needs |

**When to choose Ktor:** Kotlin-centric team; you want a **lightweight, explicit, async-first** service;
microservices/serverless where **fast startup and small footprint** matter; you're sharing a client
across Kotlin Multiplatform; you dislike framework "magic."

**When to choose Spring Boot:** you need the **vast ecosystem** (Spring Data, Security, Cloud, Batch,
Integration); a **large team** already fluent in Spring; rich out-of-the-box **transactions/JPA**,
enterprise integrations, and long-term support; convention-over-configuration at scale.

> **Senior answer:** "Ktor and Spring Boot sit at opposite ends of a tradeoff. Ktor is minimal, explicit,
> and coroutine-native — great for lean Kotlin microservices and fast startup. Spring Boot is a batteries-
> included enterprise platform — unmatched ecosystem and integrations at the cost of weight and magic. I'd
> pick Ktor for a focused, async, Kotlin-first service, and Spring Boot when I need its ecosystem and team
> familiarity. Notably, Spring also supports coroutines and Spring Boot 3 + GraalVM narrows the startup gap."

---

## 15. Interview Q&A Bank

**Q: What is Ktor and how is it different from Spring Boot?**
> A lightweight, coroutine-native Kotlin web framework using an explicit DSL — no annotations, minimal
> reflection, no built-in DI, async by default. Spring Boot is an annotation-driven, batteries-included
> enterprise platform with a full IoC container and huge ecosystem.

**Q: How does Ktor handle asynchronous requests?**
> Every handler is a suspend function running in a coroutine, so I/O is non-blocking by default and you
> write sequential-looking code that suspends instead of blocking — no separate reactive model. Blocking
> work must go on Dispatchers.IO.

**Q: What are Ktor plugins and the pipeline?**
> The request flows through a pipeline of phases; plugins are interceptors installed into those phases
> (ContentNegotiation, Authentication, StatusPages, CORS, CallLogging…). It's how Ktor does cross-cutting
> concerns — explicitly, instead of annotations/proxies.

**Q: What engines does Ktor support and why pluggable?**
> Netty (default, async), CIO (pure-Kotlin coroutine I/O), Jetty, Tomcat. The framework is engine-
> agnostic, so you swap the I/O layer without changing app code.

**Q: Does Ktor have dependency injection?**
> No built-in DI — you wire manually or use Koin/Kodein. This keeps the core small and explicit, unlike
> Spring's automatic bean container.

**Q: How do you serialize JSON in Ktor?**
> Install ContentNegotiation with kotlinx.serialization (idiomatic, reflection-free, multiplatform) or
> Jackson/Gson; then call.receive<T>() and call.respond(obj) handle (de)serialization via negotiation.

**Q: How is error handling done in Ktor?**
> The StatusPages plugin maps exceptions (and status codes) to responses centrally — the equivalent of
> Spring's @ControllerAdvice/@ExceptionHandler.

**Q: When would you pick Ktor over Spring Boot, and vice versa?**
> Ktor for lightweight, async, Kotlin-first microservices/serverless, fast startup, or KMP client sharing.
> Spring Boot for the mature ecosystem (Data/Security/Cloud), big teams, and rich out-of-the-box
> transactions/JPA and enterprise integrations.

**Q: What's the catch with Ktor's async model?**
> The same as any non-blocking stack: a blocking call (JDBC, blocking libs) on an engine thread kills
> scalability. Wrap blocking work in withContext(Dispatchers.IO) and prefer suspend-friendly libraries.

**Q: How do you test a Ktor app?**
> testApplication { } runs the app in-memory with a test engine and client — no real sockets — so route
> and plugin tests are fast and deterministic.

---

## 16. Cheat Sheet

- **Ktor** = lightweight, **coroutine-native** Kotlin framework; **explicit DSL, no annotations, minimal
  reflection, no built-in DI**; async by default.
- **`embeddedServer(engine) { module }`**; **engines**: Netty (default async), CIO (pure-Kotlin), Jetty/
  Tomcat (servlet).
- **Modules** install plugins + routing; **Routing DSL** (`get/post`, `{id}` params, `call.respond`/
  `call.receive`).
- **Plugins = pipeline interceptors:** ContentNegotiation, Authentication (jwt/oauth/session), StatusPages
  (errors), CORS, Compression, CallLogging, RateLimit.
- **Serialization:** kotlinx.serialization via ContentNegotiation (`@Serializable`).
- **Async:** handlers are **suspend** → non-blocking with sequential code; blocking work →
  `withContext(Dispatchers.IO)`.
- **DI:** none built-in → **Koin**/manual. **Config:** code DSL or HOCON `application.conf` + `EngineMain`.
- **Testing:** `testApplication { }` in-memory. **Ktor client:** coroutine-based, **multiplatform**.
- **vs Spring Boot:** Ktor = minimal/explicit/async/fast-startup/Kotlin-first → lean microservices &
  serverless & KMP. Spring Boot = batteries-included/huge ecosystem/IoC/JPA → enterprise apps & big teams.

---

*End of handbook. The signal: Ktor is the **explicit, coroutine-native** alternative to Spring Boot —
you compose small async building blocks in a DSL instead of leaning on annotations, auto-config, and a
big IoC container. Pick it for **lean, async, Kotlin-first** services and fast startup; pick **Spring
Boot** when you need its **ecosystem, integrations, and team familiarity**.*
