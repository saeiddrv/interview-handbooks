---
title: "Elasticsearch — Advanced Interview Handbook"
description: "A deep, easy-to-understand guide to Elasticsearch for senior interviews: the inverted index, how search & relevance really work, shards & replicas, the…"
sidebar:
  label: "Elasticsearch"
---

> A deep, easy-to-understand guide to Elasticsearch for senior interviews: the inverted index, how
> search & relevance really work, shards & replicas, the cluster, analyzers, mappings, query vs filter
> context, aggregations, the read/write paths, scaling & the tricky failure modes (split-brain, deep
> pagination, mapping explosions) — plus a deep Q&A bank.
>

---

## 1. What Elasticsearch Is & When to Use It

**Elasticsearch (ES)** is a distributed **search and analytics engine** built on **Apache Lucene**. It
stores JSON documents and makes them searchable in near real-time with **full-text relevance**,
filtering, and aggregations at scale.

**Use it for:** full-text search, log/metrics analytics (the **ELK/Elastic Stack**: Elasticsearch +
Logstash/Beats + Kibana), autocomplete, geospatial, anomaly detection.

> **Senior framing:** "Elasticsearch is a distributed wrapper around Lucene's inverted index. It's a
> **search engine, not a primary database** — it's near-real-time, eventually consistent, and optimized
> for read-heavy search/analytics, so I keep a system of record elsewhere and index into ES."

> **Don't use ES as your primary datastore** — no real transactions, eventual consistency, and
> reindexing is painful. It's a search/analytics layer fed from your DB (often via CDC).

---

## 2. The Inverted Index (the core idea)

The single most important concept. A normal DB index maps **row → values**. An **inverted index** maps
**term → list of documents containing it** (like a book's index).

```
Documents:
  doc1: "the quick brown fox"
  doc2: "the lazy brown dog"

Inverted index (term → postings):
  brown → [doc1, doc2]
  quick → [doc1]
  fox   → [doc1]
  lazy  → [doc2]
  dog   → [doc2]
```

Searching "brown" is instant — just look up the term. This is why full-text search is fast and why
`LIKE '%term%'` in SQL can't compete.

> **"Why is ES faster than SQL `LIKE` for search?"** The inverted index pre-tokenizes text into
> terms mapped to documents, so a search is a direct term lookup with precomputed relevance — versus
> SQL scanning every row and being unable to use a normal B-tree for leading-wildcard matches.

Each shard is a **self-contained Lucene index** with its own inverted index, stored as immutable
**segments**.

---

## 3. Documents, Indices, Mappings

- **Document** — a JSON object (the unit of data), with an `_id`.
- **Index** — a collection of documents with similar structure (like a "table"). Made of shards.
- **Mapping** — the schema: field names → types (and how they're analyzed). Like a DB schema but
  flexible.
- **(Types are gone** — removed in ES 7; one type per index now.)

> "Index ≈ table, document ≈ row, mapping ≈ schema — but a field can be indexed **multiple ways**
> (text for search + keyword for exact/aggregations) via **multi-fields**."

---

## 4. Analyzers, Tokenizers & Text vs Keyword

**Analysis** turns text into searchable terms at index time (and query time). An **analyzer** =
**character filters → tokenizer → token filters**.

```
"The Quick-Brown FOXES!"
 → char filter (strip punctuation)
 → tokenizer (split on whitespace) → [The, Quick, Brown, FOXES]
 → token filters (lowercase, stop-words, stemming) → [quick, brown, fox]
```

- **Tokenizer** splits text into tokens; **token filters** transform them (lowercase, stemming,
  synonyms, stop-words).
- **Standard analyzer** (default), plus language analyzers, `keyword` (no analysis), custom analyzers.

### `text` vs `keyword`(the most common mapping question)
| | `text` | `keyword` |
|---|---|---|
| Analyzed? | **Yes** (tokenized, stemmed) | **No** (stored as-is) |
| Use | Full-text search (match) | Exact match, sorting, **aggregations**, filtering |
| Example | article body | status, tags, email, IDs |

> **"Why can't I sort/aggregate on a `text` field?"** Because it's analyzed into many tokens — there's
> no single value to sort. Use a **`keyword`** field (or a multi-field: `title` as text +
> `title.keyword` for sorting/aggs). This bites everyone.

> **Index-time vs query-time analysis must be compatible** — if you index with one analyzer and
> query with another, matches silently disappear.

---

## 5. Shards & Replicas

An index is split into **shards** to scale horizontally; each shard is replicated for HA.

- **Primary shard** — holds part of the data; the unit of horizontal scaling. **Fixed at index
  creation** (can't change without reindexing).
- **Replica shard** — a copy of a primary on another node → **read scaling + failover**. Can be changed
  anytime.
- A document is routed to a shard by `hash(routing) % number_of_primary_shards` (default routing = `_id`).

```
Index "logs" — 3 primaries (P0,P1,P2), 1 replica each:
 Node A: P0, R1     Node B: P1, R2     Node C: P2, R0
 (a primary and its replica never live on the same node)
```

> **"How many shards should I use?"** The classic trap. Too **few** = can't scale / huge shards; too
> **many** = "oversharding" overhead (each shard is a Lucene index with memory/file cost). Rule of
> thumb: aim for shards **~10–50GB**, and don't over-provision. You **can't change primary count**
> without reindex, so size for growth (or use rollover/data streams).

> "Replicas scale **reads** and provide HA; primaries scale **writes/storage**. Searches run on
> either; indexing goes to the primary then replicates."

---

## 6. Cluster Architecture & Node Roles

- **Master-eligible node** — manages cluster state (which shards go where); one elected **master**.
- **Data node** — stores shards, does indexing/search.
- **Coordinating node** — routes requests, gathers/merges results (every node can coordinate).
- **Ingest node** — runs ingest pipelines (transform docs before indexing).
- **ML / transform** nodes (specialized).

**Cluster state** is managed by the master and replicated; **quorum-based** master election prevents
split-brain (§15).

---

## 7. The Write Path (how indexing works)

Indexing is **near-real-time**, not instant — a key nuance.

```
Index a doc → route to primary shard → write to in-memory buffer + translog (durability)
   → (every 1s) REFRESH: buffer → new in-memory segment → searchable (NOW visible)
   → (periodically) FLUSH: fsync segments to disk, clear translog
   → MERGE: small immutable segments merged into bigger ones in the background
```

- **Refresh (default 1s)** — makes new docs **searchable**; this is the "near-real-time" delay.
- **Translog** — write-ahead log for durability between flushes (replayed on crash).
- **Flush** — persists segments to disk and trims the translog.
- **Segments are immutable** — updates/deletes mark old docs as deleted and write new ones; space is
  reclaimed on **merge**. (Same idea as a log-structured store.)

> **"Why isn't my just-indexed document found?"** The default **1-second refresh** — it's near-real-
> time, not real-time. For tests you can force `?refresh=true`, but doing that in prod kills
> throughput. For bulk loads, **increase `refresh_interval`** (e.g., 30s or -1) to speed indexing.

> "ES is append-only with immutable segments + a translog for durability and a 1s refresh for
> visibility. Updates are delete-and-reindex under the hood, reclaimed on segment merge."

---

## 8. The Read/Search Path

A search is **scatter-gather** in two phases:

```
QUERY phase:  coordinating node → fan out to all relevant shards
              → each shard finds top-K matching doc IDs + scores → return IDs to coordinator
              → coordinator merges/sorts to global top-K
FETCH phase:  coordinator asks the right shards for the full documents of the final top-K
```

> This **query-then-fetch** is why **deep pagination is expensive** — to get page 1000, every shard
> must return `from + size` results to be merged (§13).

---

## 9. Relevance Scoring (BM25)

Full-text results are **ranked by relevance score** (`_score`). The default algorithm is **BM25**,
based on:
- **TF (term frequency)** — more occurrences of the term → higher score (with diminishing returns).
- **IDF (inverse document frequency)** — rarer terms across the corpus → more weight.
- **Field length normalization** — a match in a short field counts more than in a long one.

You can tune relevance with **boosting**, `function_score`, and analyzers.

> "Default scoring is **BM25** — TF-IDF with saturation and length normalization. I tune relevance
> with field boosts and `function_score` (e.g., recency/popularity), and I test with `_explain` to see
> why a doc scored as it did."

> **Distributed scoring quirk:** IDF is computed **per shard** by default, so scores can vary across
> shards with skewed data. `dfs_query_then_fetch` computes global term stats first (more accurate,
> slower).

---

## 10. Query DSL: Query vs Filter Context

ES queries are JSON. The crucial distinction:

| | **Query context** | **Filter context** |
|---|---|---|
| Question | "How **well** does it match?" | "Does it match: **yes/no**?" |
| Produces | A relevance `_score` | No score (boolean) |
| Cacheable | No | **Yes** (filter cache) |
| Example | `match` on body text | `term` status=active, date range |

```json
{ "query": { "bool": {
  "must":   [ { "match": { "title": "elasticsearch" } } ],   // query context (scored)
  "filter": [ { "term": { "status": "published" } },         // filter context (cached, no score)
              { "range": { "date": { "gte": "2024-01-01" } } } ]
}}}
```

**`bool` clauses:** `must` (AND, scored), `should` (OR / boost), `must_not` (exclude), `filter` (AND,
no score, cached).

**Common queries:** `match` (full-text, analyzed), `term` (exact, not analyzed — never `term` on a
`text` field), `match_phrase`, `multi_match`, `range`, `wildcard`/`prefix` (expensive), `fuzzy`,
`nested`.

> **"`match` vs `term`?"** `match` analyzes the query text (use for `text` fields); `term` is exact
> and **not** analyzed (use for `keyword`/numbers/dates). Running `term` on an analyzed `text` field is
> the classic "why doesn't it match?" bug.

> "Put everything that's yes/no — statuses, ranges, IDs — in **filter context**: no scoring cost and
> it's cached. Reserve **query context** for actual relevance ranking."

---

## 11. Aggregations

ES's analytics engine — compute stats over matching docs (powers Kibana dashboards).

- **Bucket aggregations** — group docs: `terms` (group by field), `date_histogram` (time buckets),
  `range`, `histogram`, `filters`.
- **Metric aggregations** — compute: `avg`, `sum`, `min`, `max`, `cardinality` (approx distinct),
  `percentiles`, `stats`.
- **Pipeline aggregations** — aggregations on aggregations (moving averages, derivatives).
- Aggregations **nest** (terms → sub-aggregation per bucket).

```json
{ "size": 0, "aggs": {
  "by_status": { "terms": { "field": "status" },
    "aggs": { "avg_price": { "avg": { "field": "price" } } } } } }
```

> Aggregate on **`keyword`/numeric**, not analyzed `text` (needs doc_values). `cardinality` is
> **approximate** (HyperLogLog); `terms` counts can be slightly off across shards (`doc_count_error`).

---

## 12. Mappings Deep Dive & Dynamic Mapping Traps

- **Dynamic mapping** — ES guesses field types from the first document. Convenient but dangerous.
- **Mapping explosion** — uncontrolled dynamic fields (e.g., indexing arbitrary JSON keys / user
  data as fields) create thousands of fields → memory blowup and cluster instability. Control with
  `dynamic: strict`, `flattened` type, or explicit mappings.
- **You can add fields but not change/remove existing field types** — changing a mapping requires
  **reindexing** into a new index (use **aliases** to switch with zero downtime).
- **Multi-fields:** index one field several ways (`text` + `keyword`).
- **`doc_values`** — columnar on-disk structure enabling sorting/aggregations (on by default for
  non-text).

> **"How do you change a field's type with data already indexed?"** You can't in place — create a new
> index with the corrected mapping, **reindex**, and swap an **alias** so clients are unaffected.

---

## 13. Pagination (and why deep paging is dangerous)

| Method | How | Use |
|---|---|---|
| **from/size** | Skip `from`, take `size` | Shallow paging only |
| **search_after** | Cursor using sort values of the last hit | Deep pagination / infinite scroll |
| **scroll** | Snapshot for bulk export | Large exports (deprecated for paging) |
| **PIT (point-in-time)** | Consistent view + search_after | Stable deep pagination |

> **Deep pagination trap:** `from: 10000, size: 10` forces **every shard** to produce 10,010 hits to
> merge → memory/CPU blowup. ES caps it at `index.max_result_window` (default 10,000). Use
> **`search_after`** (+ PIT) for deep paging — it pages by the sort values of the last result, O(1) per
> page.

> "Never deep-page with from/size — it's O(from) per shard. Use **search_after with a point-in-time**
> for stable, scalable pagination."

---

## 14. Scaling, Performance & Index Lifecycle

- **Bulk API** — index in batches, not one doc per request (huge throughput win).
- **Tune indexing:** raise `refresh_interval`, set replicas to 0 during initial bulk load then add
  them back, size bulk requests (~5–15MB).
- **Time-based data** — use **data streams / rollover + ILM (Index Lifecycle Management)**: hot →
  warm → cold → frozen → delete tiers; roll to a new index by size/age (logs!).
- **Aliases** — abstract the real index; enables zero-downtime reindex and rollover.
- **Routing** — custom routing to co-locate related docs on one shard (faster queries, hot-spot risk).
- **Force merge** read-only indices to fewer segments for faster search.
- **Caches:** node query cache (filters), shard request cache (aggs on read-only indices), fielddata
  (avoid on text).

> **"How do you handle billions of log documents?"** Time-based indices with **rollover + ILM**,
> bulk indexing, fewer replicas during ingest, hot-warm-cold tiers, and aliases — not one giant index.

---

## 15. Consistency, Failure & Split-Brain

- **Near-real-time + eventually consistent** — refresh delay, async replication. Not for
  read-after-write-critical transactional data.
- **Write consistency:** a write succeeds on the primary then replicates; `wait_for_active_shards`
  controls how many copies must be available.
- **Split-brain** — if the network partitions and two nodes both think they're master, you get
  divergent state. Modern ES (7+) uses a built-in **quorum-based** voting/coordination layer
  (`voting_only`/`cluster.initial_master_nodes`) to prevent it (old ES used
  `minimum_master_nodes = N/2+1`).
- **Versioning / optimistic concurrency:** `_seq_no` + `_primary_term` (or external `version`) to
  prevent lost updates on concurrent writes.
- **Green/Yellow/Red** cluster health: green (all shards assigned), yellow (replicas unassigned), red
  (a primary unassigned → data unavailable).

> **"How does ES avoid split-brain?"** Quorum-based master election — a majority of master-eligible
> nodes must agree, so a minority partition can't elect its own master. Run **3 master-eligible nodes**
> for a safe quorum.

---

## 16. Advanced Gotchas (senior-level)

1. **Primary shard count is immutable** — plan ahead; reindex to change.
2. **1s refresh** — not real-time; force-refresh kills throughput.
3. **`text` vs `keyword`** — can't sort/aggregate on analyzed text; use multi-fields.
4. **`term` on `text`** silently doesn't match (analysis mismatch).
5. **Deep pagination** explodes memory — use search_after + PIT.
6. **Mapping explosion** from dynamic mapping of arbitrary keys — use `strict`/`flattened`.
7. **Fielddata on text** for sorting/aggs blows up heap — use `keyword`/doc_values instead.
8. **Per-shard IDF** skews scores on small/skewed data — use `dfs_query_then_fetch`.
9. **Not a database** — no ACID transactions/joins (only `nested`/`join` with caveats); keep a system
   of record.
10. **Heap sizing** — set JVM heap ≤ 50% RAM and **under ~31GB** (compressed oops boundary).
11. **Too many shards (oversharding)** — each shard has fixed overhead; consolidate.
12. **Reindex via aliases** for zero-downtime mapping changes.

> "The senior signals: ES is **near-real-time + eventually consistent + not a primary DB**, shard
> count is a one-way decision, `text` vs `keyword` drives search vs aggregation, and deep paging /
> mapping explosions are how clusters fall over."

---

## 17. Interview Q&A Bank

**Q: What is an inverted index?**
> A map of term → documents containing it (plus positions/frequencies), precomputed at index time, so
> full-text search is a direct term lookup instead of scanning rows.

**Q: text vs keyword?**
> text is analyzed (tokenized/stemmed) for full-text `match`; keyword is stored as-is for exact match,
> sorting, and aggregations. Use multi-fields to get both.

**Q: Shards vs replicas?**
> Primary shards partition data (scale writes/storage, fixed at creation); replicas are copies (scale
> reads + HA, adjustable). A primary and its replica never share a node.

**Q: How do you choose shard count?**
> Size shards ~10–50GB, avoid over/under-sharding, and remember primary count can't change without
> reindex — so size for growth or use rollover/data streams.

**Q: Why isn't a just-indexed doc searchable immediately?**
> The default 1-second refresh — ES is near-real-time. Force-refresh for tests; raise refresh_interval
> for bulk indexing performance.

**Q: Explain the write path.**
> Doc → primary shard → in-memory buffer + translog → refresh (1s) creates a searchable immutable
> segment → periodic flush fsyncs and trims translog → background merges consolidate segments. Updates
> are delete + reindex.

**Q: Query then fetch?**
> Query phase fans out to shards for top-K IDs+scores, coordinator merges to global top-K; fetch phase
> retrieves the full docs. This is why deep pagination is costly.

**Q: Query vs filter context?**
> Query context scores relevance (no cache); filter context is yes/no, unscored, and cached. Put
> ranges/terms/statuses in filters; use query context for relevance.

**Q: match vs term?**
> match analyzes the query (for text fields); term is exact and unanalyzed (for keyword/number/date).
> term on a text field is a classic non-match bug.

**Q: How does scoring work?**
> BM25 (TF-IDF with saturation + length normalization). Tune with boosts/function_score; explain with
> _explain. IDF is per-shard unless using dfs_query_then_fetch.

**Q: How do you paginate deeply?**
> search_after (cursor on sort values) with a point-in-time, not from/size, which forces every shard to
> return from+size hits and is capped at max_result_window.

**Q: How do you change a mapping with existing data?**
> You can add fields but not change types in place — create a new index with the correct mapping,
> reindex, and switch an alias for zero downtime.

**Q: How does ES prevent split-brain?**
> Quorum-based master election (majority of master-eligible nodes must agree); run 3 master-eligible
> nodes. A minority partition can't elect a master.

**Q: Is ES a database?**
> No — near-real-time, eventually consistent, no ACID transactions/real joins. It's a search/analytics
> layer fed from a system of record (often via CDC).

**Q: What is a mapping explosion?**
> Uncontrolled dynamic fields (e.g., arbitrary JSON keys) creating thousands of fields → heap blowup.
> Prevent with dynamic:strict, explicit mappings, or the flattened type.

---

## 18. Cheat Sheet

- **ES = distributed Lucene; inverted index = term → docs.** Search engine, **not** a primary DB.
- **Index≈table, doc≈row, mapping≈schema;** types are gone.
- **text** (analyzed, full-text) vs **keyword** (exact, sort/aggregate). Multi-fields give both.
- **Analyzer = char filters → tokenizer → token filters** (lowercase/stem/stop).
- **Primary shards** = scale/storage (immutable count); **replicas** = reads + HA.
- **Near-real-time:** 1s **refresh**; **translog** durability; immutable **segments** + **merge**.
- **Search = query-then-fetch** (scatter-gather) → deep paging is costly → **search_after + PIT**.
- **BM25** scoring (TF·IDF + length norm); per-shard IDF unless `dfs_query_then_fetch`.
- **Query vs filter context:** filters are unscored + **cached**; put statuses/ranges there.
- **match (analyzed) vs term (exact)** — never `term` a `text` field.
- **Aggregations:** bucket (terms/date_histogram) + metric (avg/cardinality) on keyword/numeric.
- **Mapping changes → reindex + alias;** beware **mapping explosion** (dynamic) and **fielddata** on text.
- **Time-series:** data streams + **rollover + ILM** (hot/warm/cold), bulk API, aliases.
- **Split-brain:** quorum master election; 3 master-eligible nodes. Heap ≤50% RAM and <31GB.

---

*End of handbook. The senior signal: ES is a **near-real-time, eventually-consistent search engine over
an inverted index** — reason about shards, analysis, refresh, and scoring from there.*
