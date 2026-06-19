# AGENTS.md

Context and house rules for AI agents (and humans) working on this repository.
Read this fully before adding or editing any content.

## What this project is

A free, open-source library of **engineering interview handbooks** aimed at
**senior, staff, and principal** level candidates. It is a static docs site built with
**Astro + Starlight** and deployed to **Cloudflare Pages**.

Maintained by **Saeid Darvishghazvini** (https://saeiddrv.com) for the community.
Content license: **CC BY-NC 4.0**.

## Core values (the bar every page must meet)

1. **Clear first, deep second.** Explain the concept in plain English, then add the depth.
   If a smart engineer who is new to the topic can't follow it, rewrite it.
2. **Real over abstract.** Use concrete examples, analogies, diagrams, and runnable-looking code —
   not dictionary definitions.
3. **Interview signal, no fluff.** Every section should help someone answer better. Call out what
   interviewers are really testing, the senior-sounding answer, and the trap that fails people.
4. **Faithful to the author.** Do **not** rewrite, summarize, or "improve" existing content unless
   explicitly asked. Preserve the author's wording, examples, and structure. Append or insert; don't
   replace.
5. **No filler.** Do not add unsolicited sections (e.g. "1-week study plans", motivational intros,
   marketing copy). Add only what was asked for.
6. **Easy to contribute.** Keep it plain Markdown. Avoid custom components, heavy HTML, or anything a
   casual contributor couldn't copy from an existing page.

## Hard rules (do not break)

- **No emoji in content.** They look cheap on the site. Use the text labels below instead.
- **No manual "Table of Contents".** Starlight generates the right-hand "On this page" TOC.
- **No `# H1` heading in the body.** The page title comes from frontmatter `title`.
- **No PDFs.** This project is web-only; do not add PDF generation or commit `*.pdf`.
- **Never invent technical facts.** If unsure, say so or verify. Accuracy beats confidence.
- **Don't push or change git remotes** unless the user explicitly asks.

## Signal labels (use instead of icons)

Highlight high-value moments inline with **bold labels**:

- `**What they're testing:**` — the intent behind an interview question.
- `**Senior answer:**` — a high-signal line the candidate can say out loud.
- `**Trap:**` — the common mistake that fails candidates.
- `**Nice to know:**` — bonus depth that impresses.

For a bigger callout, Starlight asides are allowed (use sparingly):

```markdown
:::caution[Trap]
Explain the mistake and how to avoid it.
:::

:::tip[Senior answer]
The line that sounds senior.
:::
```

## Page structure (every handbook follows this shape)

1. **Frontmatter** (no `# H1` after it):
   ```yaml
   ---
   title: "Topic — Interview Handbook"
   description: "One sentence for search engines and previews."
   sidebar:
     label: "Topic"
   ---
   ```
2. **One-paragraph intro** as a blockquote (`>`).
3. **Numbered sections**: `## 1. Section`, `## 2. Section`, … Each goes
   concept → example → tricky points. Renumber sequentially if you add/remove a section.
4. **Tables, ASCII diagrams, and real code** where they aid understanding.
5. **`## Interview Q&A`** — questions as `**Q: ...**` with the answer in a blockquote (`>`).
6. **`## Cheat Sheet`** — one-screen revision (key commands + concept recap).

## How to add a NEW topic

1. Pick the category folder under `src/content/docs/`:
   `data-storage`, `messaging`, `backend`, `architecture`, `security`, `tooling`, `ai-ml`.
   (Create a new folder + add it to `sidebar` in `astro.config.mjs` only if no category fits.)
2. Create `src/content/docs/<category>/<topic>.md` with a **lowercase-kebab-case** filename
   (e.g. `terraform.md`, `graphql.md`). Closely related topics may share one file when the
   comparison is itself an interview question (e.g. `kafka-vs-rabbitmq.md`).
3. Add the frontmatter and write the body using the structure and labels above.
4. The page appears in the sidebar automatically (nav autogenerates per category folder).
5. Build and verify (see below).

### Topics worth adding next (senior → principal coverage gaps)
Terraform/IaC, cloud/AWS, security threat-modeling, performance engineering, data engineering. (Now
covered: distributed-systems theory, staff behavioral/leadership, Java/Kotlin data structures &
concurrency, API design & GraphQL, observability/SRE, CI/CD, testing strategy, soft skills.) Ship
each as its own PR.

## How to EDIT an existing topic

- **Insert/append faithfully.** Match the surrounding tone, depth, and the signal-label convention.
- Keep section numbering consistent if you add a section.
- When the user asks a clarifying question and then says "add it", fold the answer into the relevant
  section — do not bolt on a stray new section unless it truly warrants one.
- Do not strip or reword existing examples to "tidy up".

## Build & verify (always do this before finishing)

```bash
npm install        # first time only
npm run dev        # live preview: http://localhost:4321/interview-handbooks/
npm run build      # MUST succeed with no errors before you call it done
```

Quick content checks:

```bash
# no emoji should ever match in content (portable, works on macOS)
python3 - <<'PY'
import pathlib, re
rng = re.compile('[\U0001F300-\U0001FAFF\u2600-\u26FF\u2700-\u27BF\u2B00-\u2BFF]')  # emoji only (arrows like → are fine)
bad = [str(p) for p in pathlib.Path('src/content/docs').rglob('*.md') if rng.search(p.read_text())]
print('FIX: emoji in', bad) if bad else print('no emoji ✓')
PY
# code fences must be balanced (no odd counts)
for f in $(find src/content/docs -name '*.md'); do n=$(grep -c '^```' "$f"); [ $((n%2)) -ne 0 ] && echo "ODD FENCES: $f"; done
```

## Project map

```
src/content/docs/        the handbooks (Markdown), grouped by category
  index.mdx              splash landing page (card grid) — MDX, not a handbook
src/components/Footer.astro   copyright override (Saeid Darvishghazvini / saeiddrv.com)
src/styles/custom.css    brand colours
astro.config.mjs         title, sidebar nav, social links, editLink, site
CONTRIBUTING.md          human-facing contribution guide (keep in sync with this file)
```

## Deployment notes

- Hosted on **Cloudflare Pages** at **https://interview.saeiddrv.com**. No CI pipeline — Cloudflare
  builds on every push (Framework preset: Astro · Build command: `npm run build` · Output: `dist`).
- `site` in `astro.config.mjs` is the custom domain root, so there is **no `base` subpath**. Keep it
  that way unless the hosting changes.
- `repo_url` / `editLink` / `social` still point to the GitHub repo (source of truth for PRs).
- Do not commit `dist/` or `.astro/`.
