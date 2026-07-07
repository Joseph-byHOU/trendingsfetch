# Extraction Reference

## Purpose

This file defines how TrendFetch should extract and normalize lead data from candidate sites.

## Field Priorities

### Store Name

Use the first reliable source in this order:

1. visible brand or logo text
2. document title
3. company name in about/contact sections
4. footer copyright owner

### Contact Person

Look for labels or nearby text such as:

- `Contact`
- `Sales manager`
- `Account manager`
- `Founder`
- `CEO`
- `Mr.`
- `Ms.`

This field may be empty when the site publishes only generic contact channels.

### Country And City

Prefer:

1. contact page address block
2. footer address
3. about page company profile
4. structured data blocks

### Phone

Sources:

- `tel:` links
- visible text that matches phone patterns
- WhatsApp-style phone references

### Email

Sources:

- `mailto:` links
- visible email text
- lightly obfuscated forms such as `[at]` and `(at)`

## Auxiliary Pages

The runner attempts likely pages such as:

- `contact`
- `about`
- `support`
- `wholesale`
- `privacy`
- `terms`

Single auxiliary page failures are non-fatal. Keep any data already collected.

## Output Files

Each run should emit:

- `results.csv`: final deduplicated leads
- `failures.json`: skipped or failed pages with reason and stage
- `filtered.json`: candidates rejected before or during site review
- `query-expansions.json`: original-to-expanded query mapping
- `run-summary.json`: aggregate metrics

## Confidence Guidance

Raise confidence when:

- multiple positive keywords match
- the site has commerce signals
- public phone or email is found
- multiple language queries hit the same domain

Lower confidence when:

- only weak keyword matches exist
- the site appears informational
- no contact path is reachable
