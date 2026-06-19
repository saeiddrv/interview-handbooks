# OAuth 2.0, OIDC & JWT — Advanced Security Interview Handbook

> A deep, easy-to-understand guide to modern auth for senior interviews: authentication vs
> authorization, OAuth 2.0 roles & flows (and why the implicit/password grants are dead), OpenID
> Connect, JWT structure & validation, access vs refresh tokens, PKCE, token storage, the tricky attack
> vectors (XSS/CSRF, token theft, replay, alg=none) — plus a deep Q&A bank.
>

---

## 1. AuthN vs AuthZ (get this right first)

- **Authentication (AuthN)** = *Who are you?* Verifying identity (login, password, MFA).
- **Authorization (AuthZ)** = *What are you allowed to do?* Permissions/access control.

> "Authentication proves identity; authorization grants access. **OAuth 2.0 is an authorization
> framework** (delegated access); **OpenID Connect** adds authentication on top of it. Mixing the two
> up — e.g., using OAuth access tokens to 'log in' — is the classic mistake."

---

## 2. Why OAuth Exists (the delegation problem)

**The problem:** an app wants to access your data on another service (e.g., "let this app see your
Google contacts") **without you giving it your password.**

**OAuth 2.0** solves **delegated authorization**: you grant a third-party app **limited access** to
your resources on another server, via a **token**, without sharing credentials. You can scope and
revoke it.

> **"What problem does OAuth solve?"** Delegated, scoped, revocable access to a user's resources
> without sharing passwords. The app gets a limited-permission token, not your credentials.

---

## 3. OAuth 2.0 Roles & Tokens

**Four roles:**
| Role | Who | Example |
|---|---|---|
| **Resource Owner** | The user who owns the data | You |
| **Client** | The app wanting access | A photo-printing app |
| **Authorization Server** | Issues tokens after consent | Google's OAuth server |
| **Resource Server** | Hosts the protected API | Google Photos API |

**Key tokens:**
- **Access token** — short-lived credential to call the API (a "key card").
- **Refresh token** — long-lived; used to get new access tokens without re-login.
- **Authorization code** — a short-lived one-time code exchanged for tokens (in the code flow).
- **ID token** (OIDC) — proves *who the user is* (a JWT).

> **Confidential vs public clients:** confidential clients (backend) can keep a **client secret**;
> public clients (SPA, mobile) **can't** safely store secrets → they must use **PKCE** instead (§5).

---

## 4. The Grant Types / Flows

| Grant | Use | Status |
|---|---|---|
| **Authorization Code + PKCE** | Web apps, SPAs, mobile | **The standard** — use this |
| **Client Credentials** | Machine-to-machine (no user) | Service-to-service APIs |
| **Refresh Token** | Renew access tokens | Standard companion |
| **Device Code** | TVs/CLI/limited-input devices | Valid |
| ~~Implicit~~ | (was for SPAs) | **Deprecated** — token in URL, no refresh |
| ~~Resource Owner Password~~ | (app takes username/password) | **Deprecated** — defeats the point of OAuth |

> **"Which flow for a SPA / mobile app?"** **Authorization Code with PKCE** — NOT implicit (deprecated:
> exposes tokens in the URL fragment, no refresh tokens, vulnerable). PKCE protects public clients that
> can't hold a secret.

> "Modern guidance (OAuth 2.1): **Authorization Code + PKCE for everything user-facing**, **Client
> Credentials for machine-to-machine**. Implicit and Password grants are dead."

---

## 5. Authorization Code Flow + PKCE (the modern default)

```
1. User clicks "Login with X"
2. Client → Authorization Server  (redirect with: client_id, redirect_uri, scope, state,
                                    code_challenge = SHA256(code_verifier))
3. User authenticates + consents
4. Auth Server → Client redirect with a one-time AUTHORIZATION CODE
5. Client → Auth Server (BACK-CHANNEL): exchange code + code_verifier (+ client_secret if confidential)
6. Auth Server verifies code_challenge == SHA256(code_verifier) → returns ACCESS + REFRESH (+ ID) tokens
7. Client calls Resource Server with the access token
```

**Why the code (not the token) comes back in the redirect:** the code is useless without the
**back-channel exchange**, so even if the redirect URL leaks, an attacker can't get tokens.

**PKCE (Proof Key for Code Exchange)** — the client generates a random **`code_verifier`**, sends its
hash (**`code_challenge`**) up front, and proves possession of the verifier at exchange. This stops an
**authorization code interception** attack (a malicious app grabbing the code on a mobile redirect).

**`state` parameter** — a random value echoed back to prevent **CSRF** on the redirect. **`nonce`**
(OIDC) ties the ID token to the request to prevent replay.

> **"What does PKCE protect against?"** Authorization-code interception — without the matching
> `code_verifier`, a stolen code can't be exchanged for tokens. It replaces the client secret for public
> clients.

---

## 6. OpenID Connect (OIDC) — authentication on top

OAuth 2.0 is about **access** (authorization). **OIDC** is a thin **authentication** layer on top that
adds:
- An **ID token** (a **JWT**) proving the user's identity, with standard **claims** (`sub`, `email`,
  `name`, `iss`, `aud`, `exp`, `iat`, `nonce`).
- A **UserInfo endpoint**, **discovery** (`/.well-known/openid-configuration`), and standard scopes
  (`openid`, `profile`, `email`).

> "If I need to **log a user in**, I use **OIDC** (which gives an ID token). If I only need to **call
> an API on the user's behalf**, OAuth access tokens suffice. 'Login with Google' is OIDC, not raw
> OAuth."

> **Trap:** the **access token is for the resource server, not the client.** Don't inspect/trust the
> access token to identify the user in your app — use the **ID token** (OIDC). Treating an access token
> as proof of login is a common security bug.

---

## 7. JWT Structure & How It Works

A **JWT (JSON Web Token)** is a compact, **self-contained, signed** token: `header.payload.signature`
(three Base64URL parts joined by dots).

```
eyJhbGciOiJSUzI1NiJ9 . eyJzdWIiOiIxMjMiLCJleHAiOjE3...} . <signature>
   HEADER                 PAYLOAD (claims)                  SIGNATURE
```
- **Header** — `alg` (e.g., RS256) + `typ`.
- **Payload (claims)** — `sub` (subject/user), `iss` (issuer), `aud` (audience), `exp` (expiry),
  `iat`, `nbf`, plus custom claims (roles, scopes).
- **Signature** — signs header+payload so tampering is detectable.

> **JWTs are signed, NOT encrypted** — anyone can Base64-decode and read the payload. **Never put
> secrets in a JWT.** (Use JWE if you truly need encryption.)

**Signing algorithms:**
- **HS256** (HMAC, symmetric) — one shared secret signs & verifies. Simple, but every verifier needs the
  secret.
- **RS256/ES256** (asymmetric) — private key signs, **public key verifies**. Preferred for distributed
  systems (resource servers verify with the public key via **JWKS**, no shared secret).

> **"Why is JWT good for microservices?"** It's **stateless and self-contained** — any service can
> verify it locally with the issuer's public key (JWKS endpoint) without a database/session lookup, so
> auth scales horizontally.

---

## 8. JWT Validation (do it right)

Verifying a JWT is more than checking the signature. **Validate ALL of:**
1. **Signature** — using the issuer's key (fetch via **JWKS**, match the `kid`).
2. **`exp`** — not expired. **`nbf`** — not used before valid. **`iat`** — sane.
3. **`iss`** — the expected issuer.
4. **`aud`** — this token is meant for **your** service.
5. **`alg`** — matches what you expect (reject `none` and algorithm switches).

> **`alg: none` attack** — early JWT libraries accepted tokens with `"alg":"none"` (no signature)
> as valid. **Always pin the expected algorithm.**

> **RS256→HS256 confusion attack** — an attacker changes `alg` from RS256 to HS256 and signs with
> the **public key as the HMAC secret**; a naive verifier that picks the algorithm from the token header
> accepts it. **Never let the token choose the algorithm** — enforce it server-side.

> "I validate signature + exp + iss + aud and **pin the algorithm** (no `none`, no RS256↔HS256
> confusion), fetching public keys from the JWKS endpoint by `kid`. The audience check is the one people
> forget — it stops a token minted for service A being replayed at service B."

---

## 9. Access Tokens vs Refresh Tokens

| | **Access token** | **Refresh token** |
|---|---|---|
| Lifetime | **Short** (mins) | **Long** (days/weeks) |
| Purpose | Call the API | Get new access tokens |
| Sent to | Resource server (every request) | Auth server only |
| If stolen | Limited damage (expires soon) | Big damage (mint new tokens) → guard heavily |

**Why two tokens?** Short access tokens limit the blast radius if stolen; refresh tokens let users stay
logged in without re-authenticating, and live only on the auth server side.

> **Refresh token rotation** — each use issues a **new** refresh token and invalidates the old one.
> If an old (already-used) refresh token is presented, the auth server detects **reuse** (theft) and
> revokes the whole chain. The standard defense for public clients.

---

## 10. Token Storage & the XSS/CSRF Dilemma

Where does a browser store tokens? Every option has a trade-off — a favorite senior question.

| Storage | XSS risk | CSRF risk | Notes |
|---|---|---|---|
| **localStorage** | **High** (JS can read it) | None | Easy but XSS = token theft |
| **JS-readable cookie** | High | High | Worst of both |
| **httpOnly + Secure + SameSite cookie** | **Low** (JS can't read) | Needs CSRF defense | Best for web apps |
| **In-memory (variable)** | Lower (gone on reload) | None | Lost on refresh; pair with refresh token |

> "For browser apps I prefer the token (or session) in an **httpOnly, Secure, SameSite=Lax/Strict
> cookie** so XSS can't read it, plus CSRF protection (SameSite + anti-CSRF token for state-changing
> requests). **localStorage is convenient but any XSS steals the token.** The emerging best practice is
> a **BFF (Backend-For-Frontend)** that keeps tokens server-side and gives the browser only a session
> cookie."

> **The trade-off summary:** cookies are vulnerable to **CSRF** (mitigated by SameSite + CSRF
> tokens); localStorage is vulnerable to **XSS** (no real mitigation if XSS exists). You can defend CSRF;
> you can't fully defend a token that JS can read once XSS happens.

---

## 11. Token Revocation & Logout (the hard part)

**JWT's biggest weakness:** stateless tokens **can't be easily revoked** before they expire — there's
no server-side session to delete. If a token is stolen, it's valid until `exp`.

**Strategies:**
- **Short access-token lifetimes** (minutes) — the primary mitigation; limits the damage window.
- **Refresh token revocation** — revoke the long-lived refresh token (it *is* tracked server-side) so
  no new access tokens are minted.
- **Token blocklist/denylist** — store revoked token IDs (`jti`) in Redis until they expire (this
  reintroduces a stateful lookup, partly defeating JWT's statelessness).
- **Token versioning** — a per-user version/`tokenVersion`; bump it to invalidate all existing tokens.

> **"How do you log out / revoke a JWT?"** You can't truly invalidate a stateless JWT before expiry —
> so keep access tokens short, revoke the refresh token server-side, and for instant revocation maintain
> a denylist (Redis) or a token version checked on sensitive operations. **State the trade-off:**
> instant revocation costs you statelessness.

---

## 12. Scopes, Claims & Authorization Models

- **Scopes** — coarse, consented permissions a token carries (`read:contacts`, `write:photos`). The
  resource server enforces them.
- **Claims** — statements in the token (roles, tenant, email) used for fine-grained decisions.
- **AuthZ models:** **RBAC** (roles → permissions), **ABAC** (attribute/policy-based), **ReBAC**
  (relationship-based, e.g., Google Zanzibar/OpenFGA). Put **roles/permissions in claims** but enforce
  on the server — never trust the client.

> **Least privilege:** request the **minimum scopes** needed; over-scoped tokens are a bigger prize
> if stolen.

---

## 13. Common Attacks & Defenses

| Attack | What | Defense |
|---|---|---|
| **XSS** | Malicious JS steals tokens | httpOnly cookies/BFF, CSP, output encoding |
| **CSRF** | Forged request rides the user's cookie | SameSite cookies, anti-CSRF tokens |
| **Authorization code interception** | Steal the code on redirect | **PKCE** |
| **Token replay** | Reuse a stolen token | Short expiry, `aud`, refresh rotation, DPoP/mTLS-bound tokens |
| **`alg:none` / alg confusion** | Forge/bypass signature | Pin algorithm; verify with correct key |
| **Open redirect** | Hijack the redirect_uri | Exact `redirect_uri` allowlist |
| **CSRF on the OAuth redirect** | Inject an attacker's code | **`state`** parameter |
| **ID token replay** | Reuse an ID token | **`nonce`** + `aud`/`exp` checks |
| **Token in URL/logs** | Tokens leak via referrer/logs | Never put tokens in URLs (why implicit is dead) |
| **Secret/key leakage** | Forge tokens | Rotate keys (JWKS `kid`), short-lived signing keys |

> "Defense in depth: PKCE + `state` + `nonce` on the flow, strict `redirect_uri` allowlists, short
> tokens + rotation, algorithm pinning, httpOnly cookies/BFF + CSP for storage, and **sender-constrained
> tokens (DPoP/mTLS)** so a stolen bearer token can't be replayed elsewhere."

---

## 14. Sessions vs JWT (stateful vs stateless)

| | **Server sessions** (stateful) | **JWT** (stateless) |
|---|---|---|
| State | Stored server-side (DB/Redis), client holds a session ID cookie | Self-contained in the token |
| Revocation | **Easy** (delete the session) | **Hard** (valid until expiry) |
| Scaling | Needs shared session store / sticky sessions | **Scales freely** (no lookup) |
| Size | Small cookie | Larger token on every request |
| Best for | Traditional web apps, instant logout | APIs, microservices, SPAs/mobile |

> **"JWT or sessions?"** Sessions when you need **easy revocation/logout** and have a single app
> (simpler, secure-by-default with httpOnly cookies). JWT when you need **stateless, cross-service,
> horizontally-scalable** auth. Many production systems are **hybrid**: stateless access tokens +
> server-tracked refresh tokens, or a BFF holding tokens with a session cookie to the browser.

> **Don't reach for JWT by default** — for a classic monolith web app, server-side sessions are often
> simpler and safer (trivial revocation). JWT shines for distributed APIs, not as a blanket replacement.

---

## 15. Advanced Gotchas (senior-level)

1. **Access token ≠ login** — use the **ID token (OIDC)** to identify the user, not the access token.
2. **JWTs are readable** (signed, not encrypted) — no secrets inside.
3. **Validate `aud` and `iss`**, not just signature + expiry (audience confusion attacks).
4. **Pin the algorithm** — block `alg:none` and RS256↔HS256 confusion.
5. **Stateless JWT can't be revoked** — short expiry + refresh rotation + optional denylist.
6. **Implicit & Password grants are deprecated** — use Auth Code + PKCE / Client Credentials.
7. **`state` (CSRF) and `nonce` (replay)** are mandatory, not optional.
8. **Exact `redirect_uri` matching** — no wildcards/open redirects.
9. **localStorage = XSS-stealable**; prefer httpOnly cookies / BFF.
10. **Refresh token theft** — rotation + reuse detection revokes the chain.
11. **Clock skew** — allow small leeway on `exp`/`nbf` across servers.
12. **Bearer tokens are bearer** — anyone holding it can use it; bind with **DPoP/mTLS** for high
    security.

> "The senior trifecta to volunteer: **OAuth = authorization, OIDC = authentication, JWT = a stateless
> signed token**; validate **aud/iss/alg**, not just the signature; and JWT's Achilles' heel is
> **revocation**, which you trade statelessness to solve."

---

## 16. Interview Q&A Bank

**Q: Authentication vs authorization?**
> AuthN verifies identity (who you are); AuthZ controls access (what you can do). OAuth is authorization;
> OIDC adds authentication.

**Q: What problem does OAuth 2.0 solve?**
> Delegated, scoped, revocable access to a user's resources without sharing their password — the app
> gets a limited token, not credentials.

**Q: Which OAuth flow for a SPA/mobile app and why?**
> Authorization Code with PKCE. Implicit is deprecated (tokens in URL, no refresh, leak-prone); PKCE
> protects public clients that can't store a secret from code interception.

**Q: Explain PKCE.**
> The client sends a hashed random code_challenge up front and proves the matching code_verifier at token
> exchange, so a stolen authorization code is useless without the verifier.

**Q: OAuth vs OIDC?**
> OAuth grants API access (access tokens); OIDC adds authentication with an ID token (JWT) and standard
> claims/endpoints. Use OIDC to log users in.

**Q: Why not use the access token to identify the user?**
> The access token is meant for the resource server, not the client, and may be opaque. Use the ID token
> (OIDC) for identity; trusting the access token as login is a common bug.

**Q: What's inside a JWT and is it encrypted?**
> header.payload.signature (Base64URL). It's signed, not encrypted — anyone can read the payload, so
> never store secrets in it.

**Q: How do you validate a JWT?**
> Verify the signature (via JWKS by kid), and check exp/nbf, iss, aud, and pin the alg (reject none and
> alg-confusion). The audience check is the commonly-missed one.

**Q: HS256 vs RS256?**
> HS256 is symmetric (shared secret signs/verifies); RS256 is asymmetric (private signs, public
> verifies) — preferred for distributed systems so services verify with a public key without a shared
> secret.

**Q: Access vs refresh tokens, and rotation?**
> Short-lived access tokens call APIs; long-lived refresh tokens (auth-server-only) mint new ones.
> Rotation issues a new refresh token each use and detects reuse (theft) to revoke the chain.

**Q: Where do you store tokens in the browser?**
> httpOnly+Secure+SameSite cookies (XSS-safe, add CSRF defense) over localStorage (XSS-stealable). Best
> practice: a BFF keeping tokens server-side with a session cookie to the browser.

**Q: How do you revoke/log out a JWT?**
> You can't truly invalidate a stateless JWT before expiry — keep access tokens short, revoke the refresh
> token, and for instant revocation use a denylist (Redis) or token versioning, accepting some
> statefulness.

**Q: Sessions vs JWT?**
> Sessions = stateful, easy revocation, need shared store (great for monoliths). JWT = stateless,
> scalable, hard to revoke (great for APIs/microservices). Many systems go hybrid.

**Q: What do state and nonce protect against?**
> state prevents CSRF on the OAuth redirect; nonce (OIDC) ties the ID token to the request to prevent
> replay.

**Q: Name JWT attacks and defenses.**
> alg:none and RS256↔HS256 confusion (pin algorithm), token replay (short exp, aud, DPoP/mTLS), XSS
> theft (httpOnly/BFF), CSRF (SameSite + tokens), code interception (PKCE).

---

## 17. Cheat Sheet

- **AuthN = who you are; AuthZ = what you can do.** OAuth = authorization; **OIDC = authentication**
  (ID token).
- **Roles:** resource owner, client, authorization server, resource server.
- **Flows:** **Auth Code + PKCE** (all user-facing), **Client Credentials** (M2M). Implicit & Password =
  **dead**.
- **PKCE** stops code interception; **`state`** stops CSRF; **`nonce`** stops ID-token replay.
- **JWT = header.payload.signature**, **signed not encrypted** (no secrets inside).
- **Validate:** signature (JWKS/kid) + **exp + iss + aud** + **pin alg** (no `none`, no RS↔HS confusion).
- **HS256** (shared secret) vs **RS256** (public-key verify — best for microservices).
- **Short access tokens + refresh tokens** (rotation + reuse detection).
- **Storage:** httpOnly+Secure+SameSite cookie / **BFF** > localStorage (XSS-stealable).
- **Revocation is JWT's weakness** — short expiry + refresh revocation + denylist/version (trades
  statelessness).
- **Sessions (stateful, easy logout)** vs **JWT (stateless, scalable, hard to revoke)** — often hybrid.
- **Least privilege scopes; exact redirect_uri allowlist; sender-constrained tokens (DPoP/mTLS).**

---

*End of handbook. The senior signal: **OAuth authorizes, OIDC authenticates, JWT is a stateless signed
token** — validate `aud`/`iss`/`alg` (not just the signature), and remember JWT's hard problem is
**revocation**. 🔐*
