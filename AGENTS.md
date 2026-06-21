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

   **Single-page topic:**
   ```yaml
   ---
   title: "Topic — Interview Handbook"
   description: "Keyword-rich summary of what the page covers, ≤ 160 characters."
   sidebar:
     label: "Topic"
   ---
   ```

   **Sub-page of a multi-page topic** (e.g. a topic split across several pages):
   ```yaml
   ---
   title: "Topic Sub-topic — Interview Handbook"
   description: "Keyword-rich summary of what the page covers, ≤ 160 characters."
   sidebar:
     label: "Sub-topic"
   ---
   ```

   **SEO hard limits — never exceed these:**
   - `title`: ≤ 60 characters (Google truncates longer titles in search results)
   - `description`: ≤ 160 characters (Google truncates longer descriptions in search results)
   - Every title on the site must end with `— Interview Handbook` — this is the brand signal
     that appears in search results and drives click-through from the target audience.
   - Multi-page sub-page titles must include both the topic name AND the sub-topic name so each
     page is uniquely identifiable in search (e.g. `"Database Transactions — Interview Handbook"`,
     not just `"Transactions — Interview Handbook"`).
   - Every page must have a **unique** title and a **unique** description.
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

### Section numbering — maintain all cross-references

Whenever you add or remove a numbered section, **search every file in the same multi-page topic**
for stale `§N` references and update them all in the same edit. Stale references (e.g. `§4.9`
pointing to a section that is now `§4.10`) silently mislead readers.

```bash
# Find all section cross-references in a multi-page topic
grep -rn "§" src/content/docs/<category>/<topic>/
```

Also check sibling pages for prose references like `"from the Handbook §7"` or `"(see §6)"`.

### Sibling section consistency

When a section covers multiple instances of the same concept type (e.g. data types, index types,
lock modes, algorithm variants), **every block must follow the identical structure**. Define the
pattern on the first block and apply it to every sibling. Inconsistent structure between siblings
confuses readers and signals unfinished work.

If one block has `#### Heading → one-liner → code example → **What they're testing:** → **Trap:**`,
every other block in that section must have exactly the same shape.

### Code example quality

- Every non-obvious operator, flag, or syntax must carry an inline comment explaining it.
- Comments should explain **why** the code is written this way, not just re-state what it does.
- Variable names, table names, and identifiers must match the surrounding prose and analogy.
  Never use `foo`/`bar`/`test` in a section that is already using a concrete real-world scenario.
- When comparing two approaches, show both in the same code block so the reader sees the
  difference without scrolling.

## Multi-page topics (the standard split)

Most topics are a single `.md` file. When a topic is too big for one page (like PostgreSQL), split it
into a folder `src/content/docs/<category>/<topic>/` using this **reusable template** — each page
answers one "interview mode", so pages don't overlap and nothing gets buried. Add only the pages a
topic actually needs; never split just to split.

| Tier | File | Answers | When to include |
|---|---|---|---|
| Understand | `index.md` (Handbook) | "Do you get how it works?" core model & internals | Always |
| Understand | `<concept>.md` | a concept too large for the handbook (e.g. `transactions.md`) | Only when one concept is huge |
| Use | `*-cheatsheet.md` | "Can you write it?" syntax/command reference | When there's a syntax surface |
| Use | `recipes.md` | "Can you build real things?" copy-ready patterns | Usually |
| Operate | `performance.md` | "Can you make it fast?" | Infra/runtime topics |
| Operate | `replication.md` / similar | "Can you make it scale/reliable?" | DB/infra topics |
| Operate | `operations.md` | "Can you run it safely?" backup, security, migrations | Infra/runtime topics |
| Interview | `q-and-a.md` | "Can you answer on the spot?" question bank | Usually |

Rules for a multi-page topic:
- The **Handbook (`index.md`) stays the conceptual core** — do not bloat it; promote big concepts to
  their own page instead. A focused page reads better than a giant one.
- **Q&A lives in ONE place: `q-and-a.md`.** Sub-pages must NOT carry their own `## Interview Q&A`
  section — that scatters questions and is inconsistent. Each sub-page keeps its `## Cheat Sheet`, and
  (optionally) a one-line pointer to the relevant `q-and-a.md` theme anchor. Group the central Q&A by
  theme so every page's questions have a home.
- Every page keeps the standard shape minus Q&A: blockquote intro → numbered sections → `## Cheat
  Sheet`. Only `q-and-a.md` holds questions.
- The handbook intro links to all sibling pages; sub-pages cross-link back where relevant.
- List the pages **in reading order** under a nested `label` in `astro.config.mjs` (don't rely on
  autogenerate for split topics).

### Content ownership — one home per topic

Each page in a multi-page topic owns a specific kind of content. Content that belongs to a
different page must be **moved there**, not duplicated. A shallow copy of content that lives fully
on another page is worse than nothing — it creates two sources of truth that drift apart.

**Rule:** if a section covers a concept owned by a sibling page, either:
1. Remove it and add a one-line cross-reference pointer (`> See the [Performance](/path/) page.`), or
2. Move the full content there if it is missing from the owner page.

Never keep a weaker, shorter version of content that already exists in full on another page.

Before adding a section to any page in a multi-page topic, ask: *does this concept already live,
or more naturally belong, on one of the sibling pages?* If yes — put it there and link to it.
The reader should never have to wonder which page has the real answer.

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

# SEO: every page must have "Interview Handbook" in the title and description ≤ 160 chars
python3 - <<'PY'
import pathlib, re
errors = []
for p in pathlib.Path('src/content/docs').rglob('*.md'):
    txt = p.read_text()
    title = re.search(r'^title:\s*"(.+)"', txt, re.M)
    desc  = re.search(r'^description:\s*["\'](.+)["\']', txt, re.M)
    if not title: continue  # skip files without frontmatter
    t, d = title.group(1), (desc.group(1) if desc else '')
    if 'Interview Handbook' not in t and str(p) != 'src/content/docs/index.mdx' \
       and 'privacy' not in str(p):
        errors.append(f'MISSING "Interview Handbook" in title: {p.name}  ({t!r})')
    if len(t) > 60:
        errors.append(f'TITLE TOO LONG ({len(t)} chars): {p.name}  ({t!r})')
    if d and len(d) > 160:
        errors.append(f'DESC TOO LONG ({len(d)} chars): {p.name}')
print('\n'.join(errors)) if errors else print('SEO checks passed ✓')
PY
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
