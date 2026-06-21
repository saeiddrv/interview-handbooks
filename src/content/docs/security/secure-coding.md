---
title: "Secure Coding in Java & Kotlin — Interview Handbook"
description: "Secure Java/Kotlin: OWASP Top 10, SQL injection, XSS, CSRF, deserialization, password hashing, cryptography, and broken access control — with a Q&A bank."
sidebar:
  label: "Secure Coding"
---

> How to **write secure code in Java and Kotlin** and the gotchas interviewers probe: the **OWASP Top
> 10** in practice, **injection** (SQL/command — `PreparedStatement`, JPA bind params), **XSS** and
> output encoding, **CSRF**, **insecure deserialization**, **input validation** (Bean Validation),
> **password hashing & secrets**, **cryptography** done right, **broken access control / IDOR**, and
> **XXE / SSRF / path traversal** — plus what **Spring Boot** and **Ktor** give you by default. (Pairs
> with the OAuth2 & JWT handbook for auth, and the Language Tricky Points handbook for serialization.)

---

## 1. The Secure-Coding Mindset (and OWASP Top 10)

Two rules underpin everything: **never trust input** (anything from a client, file, queue, or upstream
service is hostile until validated) and **defense in depth** (layers, not a single check).

The **OWASP Top 10** is the canonical checklist interviewers expect you to know by category:

- **Broken Access Control** (#1) — missing/incorrect authorization, IDOR.
- **Cryptographic Failures** — weak/absent crypto, plaintext secrets.
- **Injection** — SQL, command, LDAP, XSS (untrusted data interpreted as code).
- **Insecure Design**, **Security Misconfiguration**, **Vulnerable Components**, **Auth Failures**,
  **Data Integrity (deserialization)**, **Logging/Monitoring gaps**, **SSRF**.

> **Senior framing:** "Security isn't a feature you add at the end — it's input validation at the
> boundary, least privilege, safe-by-default libraries, and never trusting the client. I lean on the
> framework's secure defaults (Spring Security, parameterized queries) instead of hand-rolling."

---

## 2. Injection — SQL, Command, and Friends

**SQL injection** happens when user input is **concatenated** into a query so it changes the query's
structure. The fix is always **parameterized queries / bind variables** — the data never becomes code.

```java
// VULNERABLE — string concatenation
stmt.executeQuery("SELECT * FROM users WHERE name = '" + name + "'");  // name = "' OR '1'='1"

// SAFE — PreparedStatement (bind parameter)
var ps = conn.prepareStatement("SELECT * FROM users WHERE name = ?");
ps.setString(1, name);   // input is data, never SQL
```

**In JPA / Spring Data / Hibernate:**

```java
// SAFE — named/positional bind parameters
em.createQuery("FROM User u WHERE u.name = :name").setParameter("name", name);

@Query("SELECT u FROM User u WHERE u.email = :email")   // Spring Data — safe
User findByEmail(@Param("email") String email);
```

> **Trap:** ORMs **don't** make you immune. `@Query("... WHERE name = '" + name + "'")` string-built
> JPQL, or a **native query** with concatenation, reintroduces injection. Also `ORDER BY` / column names
> **can't** be bind parameters — validate those against an **allowlist**. For dynamic queries use the
> **Criteria API / QueryDSL**, not string building. (See the Hibernate/JPA handbook.)

**Other injection** follows the same rule — never build an interpreter's input by concatenation:
- **Command injection:** avoid `Runtime.exec`/shell strings; pass args as an **array** (`ProcessBuilder`
  with a list), never a concatenated shell line.
- **LDAP / NoSQL injection:** use the driver's parameter binding / escaping.

---

## 3. Cross-Site Scripting (XSS) & Output Encoding

**XSS** = untrusted data rendered into a page so the browser executes it as **script**. The defense is
**contextual output encoding** (escape for the context: HTML body, attribute, JS, URL) — and a strong
**Content-Security-Policy (CSP)** as defense in depth.

- **Thymeleaf** auto-escapes by default: `th:text` is safe; **`th:utext` (unescaped) is dangerous** —
  never feed it user input.
- **Never** build HTML by concatenating user input. For **rich HTML** you must keep (e.g. a WYSIWYG
  field), **sanitize** with the **OWASP Java HTML Sanitizer** (allowlist of tags/attributes).
- **DOM XSS** lives in the frontend (`innerHTML`, etc.) — frameworks like React escape by default;
  `dangerouslySetInnerHTML` reopens it.
- **CSP header** limits what scripts can run, blunting XSS even if a hole slips through.

Types: **reflected** (input echoed in the response), **stored** (persisted then served), **DOM-based**
(client-side sink).

> **Trap:** "I escaped it once" isn't enough — encoding must match the **context**. A value safe in an
> HTML body can still break out inside a `<script>` block or an unquoted attribute. (Token-storage XSS
> and `httpOnly` cookies are covered in the OAuth2 & JWT handbook.)

---

## 4. CSRF (Cross-Site Request Forgery)

**CSRF** tricks a logged-in user's browser into sending a state-changing request using their **cookies**.
It only matters for **cookie/session-based** auth.

- **Spring Security enables CSRF protection by default** for browser-facing apps (synchronizer token).
  For a **stateless token API** (Bearer header, no cookies) CSRF doesn't apply, so it's commonly
  **disabled** — but only because there's no ambient cookie to ride.
- **`SameSite=Lax/Strict` cookies** are the modern first line; add an **anti-CSRF token** for
  state-changing requests.
- **Ktor** has no built-in CSRF filter — use **`SameSite` cookies** + **Origin/Referer checks** or a
  double-submit token.

> **Senior answer:** "CSRF is a **cookie** problem. With session cookies I keep Spring's CSRF tokens +
> `SameSite`. With a stateless Bearer-token API there's no cookie to forge, so I disable CSRF and rely on
> the `Authorization` header — deliberately, not by accident."

---

## 5. Insecure Deserialization

Deserializing **untrusted** data can execute arbitrary code (the classic Java **gadget-chain RCE**).

- **Java native serialization** (`ObjectInputStream.readObject`) on untrusted input is **dangerous** —
  avoid it entirely across trust boundaries. If unavoidable, use **look-ahead deserialization** /
  serialization filters (`ObjectInputFilter`) with a class **allowlist**.
- **Jackson:** never enable **default/polymorphic typing** (`enableDefaultTyping`, or `@JsonTypeInfo`
  with a broad base) on untrusted JSON — it lets the payload pick the class to instantiate. If you need
  polymorphism, configure a **`PolymorphicTypeValidator`** allowlist.
- **Prefer data formats:** plain JSON/Protobuf with explicit types. **Kotlin `kotlinx.serialization`** is
  safer by design — compile-time, closed set of serializable types, no arbitrary class instantiation.

> **Trap:** "We use JSON, so we're safe." Not if Jackson **polymorphic typing** is on — that's a
> deserialization RCE vector too. (Serialization mechanics are in the Language Tricky Points handbook.)

---

## 6. Input Validation

Validate **at the boundary** (controller/edge), with an **allowlist** (define what's valid) rather than a
denylist (chasing what's bad).

**Jakarta Bean Validation (JSR-380)** — declarative, framework-integrated:

```java
public record CreateUser(
    @NotBlank @Size(max = 50) String name,
    @Email String email,
    @Pattern(regexp = "\\d{10}") String phone) {}

@PostMapping("/users")
ResponseEntity<?> create(@Valid @RequestBody CreateUser req) { ... }  // @Valid triggers validation
```

- Spring auto-returns **400** on violations; add a handler for a clean RFC 7807 body (see API Design).
- **Ktor:** the **`RequestValidation`** plugin validates received bodies.
- Validate types, ranges, lengths, and **formats**; reject unexpected fields; canonicalize before
  checking.

> **Nice to know:** Kotlin's **null safety** removes a whole class of bugs at compile time — a
> non-nullable `String` parameter can't be `null`, so you validate **content**, not existence.

---

## 7. Passwords, Secrets & Safe Comparison

- **Hash passwords** with a **slow, salted** algorithm: **BCrypt, Argon2, scrypt, or PBKDF2** — **never**
  MD5/SHA-1/SHA-256 plain (too fast, brute-forceable). Spring Security's
  **`DelegatingPasswordEncoder`** stores `{bcrypt}...` and upgrades cleanly.
- **Constant-time comparison** for secrets/tokens (`MessageDigest.isEqual`, not `equals`) to avoid
  **timing attacks**.
- **Secrets management:** **never hardcode** credentials/keys or commit them to git. Use env vars, a
  **secrets manager / Vault**, and **never log** secrets. Rotate keys.

```java
var encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder(); // {bcrypt}
String hash = encoder.encode(rawPassword);
boolean ok  = encoder.matches(rawPassword, hash);
```

> **Trap:** storing a fast hash (or worse, plaintext) "temporarily." A DB leak then exposes every
> password. Slow salted hashing is the baseline, not an optimization.

---

## 8. Cryptography Done Right

- **Don't roll your own crypto** — use vetted libraries/standards.
- **Randomness:** use **`SecureRandom`**, never `java.util.Random` (predictable) for tokens/keys/IVs.
- **Symmetric:** **AES-GCM** (authenticated encryption) — **never ECB** (leaks patterns). Use a unique
  IV/nonce per message.
- **Transport:** **TLS** everywhere; verify certificates (don't disable hostname verification).
- **Hashing for integrity** → SHA-256+; **for passwords** → BCrypt/Argon2 (§7), not raw SHA.
- Kotlin uses the **same JCA/JCE** APIs as Java — no separate crypto stack.

> **Trap:** `Math.random()` / `new Random()` for a password-reset token — it's predictable. Always
> `SecureRandom`.

---

## 9. Broken Access Control & IDOR

OWASP **#1**. Authentication says *who you are*; **authorization** says *what you may do* — and it's
easy to forget on individual endpoints.

- **Deny by default**; grant explicitly. Enforce on the **server**, never trust the client.
- **IDOR (Insecure Direct Object Reference):** `GET /orders/123` must verify the order **belongs to the
  caller** — don't trust the ID just because the user is logged in.
- **Spring Security** method security: `@PreAuthorize("hasRole('ADMIN')")`,
  `@PreAuthorize("#order.ownerId == authentication.name")`, plus URL-level rules. **Ktor** uses
  `authenticate { }` blocks + role checks in the route.

```java
@PreAuthorize("@orders.isOwner(#id, authentication)")
@GetMapping("/orders/{id}")
Order get(@PathVariable Long id) { ... }
```

> **Senior answer:** "The most common real-world bug isn't exotic — it's a missing ownership check
> (IDOR). I enforce authorization at the service layer, deny by default, and check object ownership, not
> just 'is logged in'."

---

## 10. Other Web/Injection Risks

- **XXE (XML External Entity):** an XML parser resolving external entities can read files / SSRF.
  **Disable DTDs/external entities** on `DocumentBuilderFactory`/`SAXParser`
  (`disallow-doctype-decl`). Many libraries are unsafe by default.
- **SSRF (Server-Side Request Forgery):** user-controlled outbound URLs can hit internal services / cloud
  **metadata endpoints**. **Allowlist** destinations; block private IP ranges and link-local
  (`169.254.169.254`).
- **Path traversal:** user input in file paths (`../../etc/passwd`). **Canonicalize** and verify the
  resolved path stays within an allowed base directory; never concatenate raw input.
- **Open redirect:** validate redirect targets against an allowlist.
- **ReDoS:** a catastrophic-backtracking regex on user input can hang a thread — keep regexes simple /
  bounded.

---

## 11. What Spring Boot & Ktor Give You

**Spring Security** (secure-by-default when added):
- **CSRF protection on**, **session-fixation protection**, sensible **security headers**
  (`X-Content-Type-Options`, frame options for **clickjacking**), and easy **CSP/HSTS** config.
- **Method/URL authorization** (`@PreAuthorize`, `authorizeHttpRequests`), **password encoders**, and
  filter-chain customization.
- **Parameterized queries** come free via JPA/Spring Data when you use bind params.

**Ktor** (explicit, opt-in plugins):
- **Authentication** plugin (Basic/JWT/OAuth/sessions), **RequestValidation**, **CORS**, and you set
  **security headers** explicitly. No built-in CSRF — handle via `SameSite` + Origin checks.

> **Senior framing:** "Spring Boot is **secure-by-default** (CSRF, headers, encoders) and I customize
> from there; Ktor is **explicit** — I add exactly the security plugins I need, which means I must not
> *forget* one. Different philosophies, same checklist."

---

## 12. Dependencies & Supply Chain

Most breaches ride a **known-vulnerable dependency**, not your code (e.g. **Log4Shell** — Log4j JNDI
lookup RCE).

- **Scan** with OWASP **Dependency-Check**, **Snyk**, or **Dependabot**; patch promptly.
- Pin versions, generate an **SBOM**, minimize the dependency surface.
- Keep the **JDK/Kotlin and frameworks updated** — old runtimes carry known CVEs.

---

## 13. Java/Kotlin Language-Level Security Tricks

- **Kotlin null safety** eliminates many NPE-class bugs at compile time — fewer crash/DoS paths.
- **Immutability** (`val`, records, immutable collections) prevents tampering and TOCTOU surprises;
  return **defensive copies** of mutable internal state.
- **Don't put secrets in `String`** — strings are **immutable and pooled**, lingering in memory; use
  **`char[]`** and clear it after use. (See the Language Tricky Points handbook on the string pool.)
- **Avoid reflection / dynamic class loading** driven by untrusted input (gadget surface).
- **`SecureRandom`**, not `Random` (§8). **Constant-time** compares for secrets (§7).
- **Least privilege** for file/DB/service accounts; minimal scopes for tokens.

---

## 14. Interview Q&A Bank

**Q: How do you prevent SQL injection?**
> Always use parameterized queries / bind variables (PreparedStatement, JPA `:param`), never string
> concatenation. ORMs help but `@Query` with concatenation or native string-built queries reintroduce it.
> Column/`ORDER BY` names can't be bound — validate against an allowlist; use Criteria/QueryDSL for
> dynamic queries.

**Q: How do you prevent XSS?**
> Contextual output encoding (escape for HTML/attribute/JS/URL context) plus CSP. Thymeleaf escapes by
> default (`th:utext` is the unsafe one); sanitize rich HTML with the OWASP Java HTML Sanitizer; never
> build HTML from raw input.

**Q: When do you need CSRF protection?**
> Only for cookie/session-based auth. Spring Security enables it by default; with a stateless Bearer-token
> API there's no cookie to forge, so it's disabled. Use SameSite cookies + tokens otherwise.

**Q: Why is insecure deserialization dangerous, and how do you avoid it?**
> Deserializing untrusted data can run arbitrary code via gadget chains. Avoid Java native serialization
> across trust boundaries; don't enable Jackson default/polymorphic typing (or restrict it with a
> PolymorphicTypeValidator); prefer plain JSON/Protobuf or kotlinx.serialization.

**Q: How should passwords be stored?**
> Slow, salted hashing: BCrypt/Argon2/scrypt/PBKDF2 — never MD5/SHA plain or plaintext. Spring's
> DelegatingPasswordEncoder (`{bcrypt}`) handles it and supports upgrades. Compare in constant time.

**Q: What is IDOR and how do you stop it?**
> Insecure Direct Object Reference — accessing another user's object by guessing its ID. Stop it with
> server-side ownership checks (deny by default), e.g. `@PreAuthorize` verifying the resource belongs to
> the caller — not just "is authenticated."

**Q: SecureRandom vs Random?**
> `java.util.Random` is predictable (not cryptographic). Use `SecureRandom` for tokens, keys, IVs, and
> reset codes.

**Q: What does Spring Boot secure by default vs Ktor?**
> Spring Security: CSRF on, session-fixation protection, security headers, password encoders, method/URL
> authorization. Ktor is explicit — you add auth/validation/CORS plugins and set headers yourself (no
> built-in CSRF), so the risk is forgetting one.

**Q: How do you handle untrusted XML (XXE)?**
> Disable DTDs/external entities on the parser (`disallow-doctype-decl`) — many parsers are unsafe by
> default — to prevent file reads/SSRF.

**Q: How do you keep dependencies safe?**
> Scan with OWASP Dependency-Check/Snyk/Dependabot, patch CVEs promptly (Log4Shell-class), pin versions,
> generate an SBOM, and keep the JDK/Kotlin/frameworks updated.

---

## 15. Cheat Sheet

- **Mindset:** never trust input; defense in depth; lean on **secure defaults**; know the **OWASP Top
  10**.
- **Injection:** **parameterize everything** (`PreparedStatement`, JPA `:param`); never concatenate;
  allowlist `ORDER BY`/columns; `ProcessBuilder` args as a list.
- **XSS:** contextual **output encoding** + **CSP**; Thymeleaf escapes by default (`th:utext` unsafe);
  sanitize rich HTML (OWASP Java HTML Sanitizer).
- **CSRF:** cookie-only problem; Spring CSRF on by default + **SameSite**; stateless Bearer API → N/A.
- **Deserialization:** no Java native serial on untrusted; **no Jackson default typing**; prefer JSON/
  Protobuf / **kotlinx.serialization**.
- **Validation:** **Bean Validation** (`@Valid`, `@NotBlank`, `@Pattern`) at the boundary; **allowlist**;
  Ktor **RequestValidation**.
- **Passwords/secrets:** **BCrypt/Argon2** salted; **constant-time** compare; **never hardcode/log**
  secrets → Vault/env.
- **Crypto:** **SecureRandom**, **AES-GCM** (not ECB), **TLS** with cert verification; don't roll your own.
- **Access control:** **deny by default**, check **ownership** (stop **IDOR**), `@PreAuthorize`.
- **Also:** disable **XXE**; allowlist **SSRF** targets; canonicalize paths (**traversal**); bound regexes
  (**ReDoS**).
- **Frameworks:** Spring Boot **secure-by-default**; Ktor **explicit opt-in** plugins.
- **Supply chain:** scan deps (Dependency-Check/Snyk/Dependabot), patch CVEs, keep runtimes current.
- **Language:** Kotlin **null safety** + **immutability**; secrets in **`char[]`** not `String`; avoid
  untrusted **reflection**.

---

*End of handbook. The signal: you write secure code by default — **parameterize queries**, **encode
output**, **validate at the boundary**, **hash passwords slowly and salted**, **never deserialize
untrusted data**, **deny by default and check ownership**, use **`SecureRandom`/AES-GCM**, and lean on
**Spring Boot's secure defaults** (or wire Ktor's explicitly) while keeping **dependencies patched**.*
