# Interview Handbooks

> Free, open-source interview handbooks for software engineers — **senior, staff & principal** level.

[![Live site](https://img.shields.io/badge/Live-interview.saeiddrv.com-4f46e5?logo=cloudflare&logoColor=white)](https://interview.saeiddrv.com)
[![Built with Starlight](https://img.shields.io/badge/Built%20with-Starlight-BC52EE?logo=astro&logoColor=white)](https://starlight.astro.build)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e.svg)](CONTRIBUTING.md)

Clear explanations, real-world examples, the tricky points called out, and a curated
**interview Q&A bank** with strong, ready-to-say answers — the depth real senior/staff/principal
interviews actually probe, in one place.

**Read it live → [interview.saeiddrv.com](https://interview.saeiddrv.com)**

Maintained by **[Saeid Darvishghazvini](https://saeiddrv.com)** for the community.
Found a fix? Click the **edit (pencil) button** on any page to open a pull request.

## Topics

Data & Storage (PostgreSQL, Redis, Elasticsearch) · Messaging & APIs (Kafka vs RabbitMQ, gRPC) ·
Backend (Spring Boot, Hibernate/JPA, JVM Internals) · Architecture & Infra (System Design,
Microservices, Docker, Kubernetes, Nginx) · Security (OAuth2/JWT) · Tooling (Git) · AI/ML (LLM
Engineering).

## Tech stack

Built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build) — fast,
modern docs with built-in search, dark mode, and an edit-on-GitHub button.

## Run it locally

```bash
npm install
npm run dev             # live preview at http://localhost:4321/
```

Build the static site:

```bash
npm run build           # output in ./dist
npm run preview         # serve the production build
```

## Project layout

```
src/content/docs/       # the handbooks (Markdown, grouped by category)
src/components/         # Footer override (copyright)
src/styles/            # brand colours
astro.config.mjs       # site config, theme, sidebar nav
```

## Deployment (Cloudflare Pages)

Deployed via **Cloudflare Pages** — no CI pipeline needed; Cloudflare builds on every push.

- **Framework preset:** Astro
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Custom domain:** `interview.saeiddrv.com` (added in the Pages project → Custom domains)

## Contributing

Contributions are welcome — fix a typo, sharpen an answer, or add a topic. See
[CONTRIBUTING.md](CONTRIBUTING.md). The quickest path: click the **pencil (edit) button** on any
page of the live site to open a pull request.

## License

Content is licensed under
[Creative Commons Attribution-NonCommercial 4.0](LICENSE) &copy; Saeid Darvishghazvini.
You may share and adapt it with attribution for non-commercial use.
