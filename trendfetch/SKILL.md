---
name: trendfetch
description: Run a scripted Google-search lead collection workflow for adult-product and intimate-product online stores. Use this skill when the user wants Google-driven store discovery, multilingual query expansion, contact extraction, timeout-aware skipping, and CSV export instead of an ad hoc browsing session.
---

# TrendFetch

## Overview

This skill turns a search request such as `成人用品` or `adult toys wholesale` into a repeatable lead-collection run. It expands the query across major languages, searches Google with bounded result limits, filters for relevant online stores, extracts public contact data, and writes CSV output locally.

The skill is designed to be harness-heavy. Use the bundled scripts first. Keep prompt logic limited to parameter selection, rule tuning, and result review.

## When To Use It

Use this skill when the user wants any of the following:

- Search Google for one or more commercial product niches and collect store contacts
- Expand a seed query into multiple languages before searching
- Crawl result pages with per-query caps and timeout-based skip rules
- Export structured leads to CSV with failure logs and filter logs

Do not use this skill for login-only sites, CAPTCHA-solving, bypassing access controls, or bulk scraping beyond the configured limits.

## Workflow

1. Read [references/filters.md](references/filters.md) when you need the relevance rules, multilingual keyword patterns, or exclusion heuristics.
2. Read [references/extraction.md](references/extraction.md) when you need the field extraction priorities, skip behavior, or CSV schema details.
3. Copy `scripts/config.example.json` to a run config and set:
   - `queries`
   - `top_results_limit_per_query`
   - timeouts
   - output directory
   - `manual_google_auth` when Google is likely to challenge automation
4. Run the scripted workflow:

```bash
cd /Users/boyuanhou/Desktop/project_4/trendfetch/trendfetch/scripts
node trendfetch-runner.js --config ./config.example.json
```

5. Review generated artifacts in the configured output directory:
   - `results.csv`
   - `failures.json`
   - `filtered.json`
   - `query-expansions.json`
   - `run-summary.json`

## Execution Rules

- Prefer the runner script over manual browser orchestration.
- Keep Google search bounded by both `max_pages_per_query` and `top_results_limit_per_query`.
- Respect `page_open_timeout_ms` and `page_load_timeout_ms`. On timeout or navigation error, record the failure and continue.
- Treat the scripts as the source of truth for workflow mechanics. Adjust configuration or reference rules before rewriting logic in the prompt.
- If Playwright is unavailable locally, install dependencies only after user approval. Do not silently switch to a weaker scraping path.
- When Google blocks automated search, switch to `manual_google_auth: true` and `headless: false`. The runner will pause on Google and wait for the user to finish consent or verification before continuing.

## Key Files

- `scripts/trendfetch-runner.js`: end-to-end Playwright workflow
- `scripts/query-expansion.js`: multilingual query expansion catalog and helpers
- `scripts/config.example.json`: runnable config template
- `references/filters.md`: relevance filters and domain heuristics
- `references/extraction.md`: extraction and output rules

## Expected Outputs

The main CSV contains:

- `store_name`
- `website_url`
- `contact_person`
- `country`
- `city`
- `phone`
- `email`
- `query_original`
- `query_translated`
- `query_language`
- `source_query`
- `source_google_page`
- `source_contact_page`
- `confidence_score`
- `notes`

Support artifacts are written alongside the CSV for review and debugging.
