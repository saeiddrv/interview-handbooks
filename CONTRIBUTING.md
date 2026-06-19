# Contributing

Thanks for helping improve these handbooks. The goal is a consistent, high-quality library that
reads the same on every page. Please keep these conventions.

## Ground rules

1. **Be accurate.** If you change a technical claim, make sure it is correct. Cite the mental model,
   not just the fact.
2. **Be clear first, deep second.** Explain a concept in plain English, then add the depth.
3. **No emoji in the content.** Icons look cheap on the site. Use the text labels below instead.
4. **Keep it plain Markdown.** No custom HTML unless necessary. This keeps contributing easy.

## Signal labels (use these instead of icons)

Highlight the high-value moments inline with **bold labels**:

- `**What they're testing:**` — the intent behind an interview question.
- `**Senior answer:**` — a high-signal line a candidate can say out loud.
- `**Trap:**` — the common mistake that fails candidates.
- `**Nice to know:**` — bonus depth.

For bigger callouts you may use Material admonitions:

```markdown
!!! warning "Trap"
    Explain the mistake and how to avoid it.

!!! tip "Senior answer"
    The line that sounds senior.
```

## Page structure

Each handbook follows the same shape:

1. `# Title` + a one-paragraph blockquote intro.
2. Numbered `## N. Section` headings (concept → example → tricky points).
3. Tables, diagrams, and real code where they help.
4. `## Interview Q&A` — questions as `**Q: ...**` with a blockquote answer.
5. `## Cheat Sheet` — one-screen revision.

> The right-hand table of contents is generated automatically — do **not** add a manual
> "Table of Contents" section.

## Adding a new handbook

1. Create `docs/<category>/<topic>.md` using a lowercase-kebab-case filename.
2. Add it to the `nav:` section of `mkdocs.yml`.
3. Run `mkdocs serve` and check it renders cleanly.
4. Open a pull request.

## Local preview

```bash
pip install -r requirements.txt
mkdocs serve
```

By contributing you agree your contribution is licensed under the project's
[CC BY-NC 4.0](LICENSE) license.
