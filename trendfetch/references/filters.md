# Filters Reference

## Purpose

This file defines the relevance and exclusion heuristics for TrendFetch runs. Read it when adjusting store qualification or tuning false positives.

## Positive Store Signals

A candidate is stronger when search results or site pages contain terms such as:

- `adult`
- `adult shop`
- `adult toys`
- `sex toys`
- `intimate`
- `pleasure`
- `vibrator`
- `dildo`
- `erotic`
- `lingerie`
- `wholesale`
- `catalog`
- `shop`
- `store`
- `supplier`
- `manufacturer`

Multi-language examples used by the scripts include common equivalents for English, Japanese, Chinese, Spanish, Portuguese, French, German, Italian, Russian, Arabic, Korean, Turkish, Dutch, Polish, Hindi, Vietnamese, Thai, Indonesian, Malay, and Ukrainian.

## Exclusion Signals

Exclude or down-rank results when the title, snippet, domain, or page body strongly indicate:

- news coverage
- reviews only
- wiki or encyclopedia pages
- forums and communities
- general directories and yellow pages
- social media profiles
- marketplace category pages without a clear merchant identity

Default negative patterns:

- `news`
- `blog`
- `wiki`
- `reddit`
- `forum`
- `directory`
- `review`
- `quora`
- `facebook`
- `instagram`
- `linkedin`
- `youtube`

## Store Qualification

Treat a site as an online store candidate when one or more of these are present:

- product grids or category pages
- cart, checkout, add-to-cart, buy-now signals
- wholesale, MOQ, inquiry, quote, catalog signals
- about or contact pages describing adult or intimate products as the main business

## Search Limits

- Stop a language query when either `max_pages_per_query` or `top_results_limit_per_query` is hit.
- The result cap is mandatory. Do not keep scrolling or paginating after the cap.

## Skip Policy

Record and continue on:

- navigation timeouts
- DNS failures
- TLS or certificate failures
- Playwright navigation errors
- robot blocks after the configured retry limit

Do not stop the full run because a single site fails.

## Google Verification Mode

If Google returns a consent page, unusual-traffic page, or `google.com/sorry` flow, use manual verification mode:

- set `manual_google_auth` to `true`
- set `headless` to `false`
- let the browser open Google
- finish the verification or consent step manually
- return to the terminal and press Enter so the scripted run can resume

This is the preferred recovery path before changing the store filters.
