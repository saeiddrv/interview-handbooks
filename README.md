# Interview Handbooks

[![Deploy site](https://github.com/saeiddrv/interview-handbooks/actions/workflows/deploy.yml/badge.svg)](https://github.com/saeiddrv/interview-handbooks/actions/workflows/deploy.yml)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)
[![Made with Material for MkDocs](https://img.shields.io/badge/Material_for-MkDocs-526CFE)](https://squidfunk.github.io/mkdocs-material/)

A free, open-source library of **senior, staff, and principal level** engineering interview
handbooks — clear explanations, real examples, the tricky points called out, and a curated
**interview Q&A bank** with strong, ready-to-say answers.

**Live site:** https://saeiddrv.github.io/interview-handbooks/

Maintained by **[Saeid Darvish](https://saeiddrv.com)** for the community.

## Topics

Data & Storage (PostgreSQL, Redis, Elasticsearch) · Messaging & APIs (Kafka vs RabbitMQ, gRPC) ·
Backend (Spring Boot, Hibernate/JPA, JVM Internals) · Architecture & Infra (System Design,
Microservices, Docker, Kubernetes, Nginx) · Security (OAuth2/JWT) · Tooling (Git) · AI/ML (LLM
Engineering).

## Run it locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
mkdocs serve            # live preview at http://127.0.0.1:8000
```

Build the static site:

```bash
mkdocs build            # output in ./site
```

## Project layout

```
docs/                 # the handbooks (Markdown, grouped by category)
mkdocs.yml            # site config, theme, navigation
requirements.txt      # mkdocs-material
.github/workflows/    # auto-deploy to GitHub Pages on push to main
```

## Contributing

Contributions are welcome — fix a typo, sharpen an answer, or add a topic. See
[CONTRIBUTING.md](CONTRIBUTING.md). The quickest path: click the **pencil (edit) button** on any
page of the live site to open a pull request.

## License

Content is licensed under
[Creative Commons Attribution-NonCommercial 4.0](LICENSE) &copy; Saeid Darvish.
You may share and adapt it with attribution for non-commercial use.
