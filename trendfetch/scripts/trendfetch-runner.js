'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { URL } = require('url');
const { expandQueries, DEFAULT_SEARCH_LANGUAGES } = require('./query-expansion');
const { validateConfig, resolveOutputDir } = require('./validate-config');
const { runLlmReview } = require('./llm-postprocess');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  chromium = null;
}

const DEFAULT_CONFIG = {
  queries: [],
  auto_translate_queries: true,
  search_languages: DEFAULT_SEARCH_LANGUAGES,
  max_pages_per_query: 3,
  top_results_limit_per_query: 50,
  max_results_per_site: 6,
  page_open_timeout_ms: 10000,
  page_load_timeout_ms: 10000,
  max_site_failures_before_skip: 2,
  output_dir: './output',
  country_hint: 'US',
  language_hint: 'en',
  headless: true,
  manual_google_auth: false,
  stop_on_google_block: true,
  enable_llm_review: false,
  base_url: '',
  api_key: '',
  model_name: '',
  llm_timeout_ms: 20000,
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 960 },
  delay_range_ms: { min: 600, max: 1600 }
};

const POSITIVE_PATTERNS = [
  /adult/i,
  /sex toy/i,
  /sextoy/i,
  /intimate/i,
  /pleasure/i,
  /vibrator/i,
  /dildo/i,
  /erotic/i,
  /lingerie/i,
  /adult shop/i,
  /成人用品/u,
  /情趣用品/u,
  /アダルト/u,
  /性玩具/u,
  /성인용품/u
];

const NEGATIVE_PATTERNS = [
  /news/i,
  /blog/i,
  /wiki/i,
  /reddit/i,
  /forum/i,
  /directory/i,
  /review/i,
  /quora/i,
  /facebook/i,
  /instagram/i,
  /linkedin/i,
  /youtube/i
];

const CONTACT_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/about',
  '/about-us',
  '/support',
  '/wholesale',
  '/privacy',
  '/terms'
];

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const PERSON_REGEX = /\b(?:contact|sales manager|account manager|founder|ceo|mr\.|ms\.)[:\s-]*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/i;

function parseArgs(argv) {
  const args = { config: null };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--config') {
      args.config = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function mergeConfig(inputConfig) {
  return {
    ...DEFAULT_CONFIG,
    ...inputConfig,
    viewport: { ...DEFAULT_CONFIG.viewport, ...(inputConfig.viewport || {}) },
    delay_range_ms: { ...DEFAULT_CONFIG.delay_range_ms, ...(inputConfig.delay_range_ms || {}) }
  };
}

function randomDelay(range) {
  const min = Number(range.min || 0);
  const max = Number(range.max || min);
  return Math.max(min, Math.floor(Math.random() * (max - min + 1)) + min);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEnter(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.toString();
  } catch (error) {
    return null;
  }
}

function hostnameFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch (error) {
    return '';
  }
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function scoreText(text) {
  const haystack = normalizeWhitespace(text).toLowerCase();
  let score = 0;
  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(haystack)) {
      score += 1;
    }
  }
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(haystack)) {
      score -= 2;
    }
  }
  return score;
}

function shouldKeepSearchResult(result) {
  const joined = `${result.title} ${result.snippet} ${result.url}`;
  const score = scoreText(joined);
  return {
    keep: score > 0,
    score,
    reason: score > 0 ? 'positive-keyword-match' : 'low-relevance'
  };
}

async function extractGoogleResults(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const selectors = [
      'div.g',
      'div[data-snc]',
      'div.MjjYud',
      'div.N54PNb'
    ];
    const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const results = [];
    for (const node of nodes) {
      const title = node.querySelector('h3');
      const anchor = title ? title.closest('a') || node.querySelector('a[href]') : node.querySelector('a[href]');
      const snippet = node.querySelector('.VwiC3b, .yXK7lf, .lyLwlc, [data-sncf="1"]');
      const item = {
        title: title ? title.textContent : '',
        url: anchor ? anchor.href : '',
        snippet: snippet ? snippet.textContent : ''
      };
      if (!item.title || !item.url) {
        continue;
      }
      if (seen.has(item.url)) {
        continue;
      }
      seen.add(item.url);
      results.push(item);
    }
    return results;
  });
}

async function acceptGoogleConsent(page) {
  const buttonPatterns = [
    /accept all/i,
    /i agree/i,
    /agree/i,
    /reject all/i,
    /接受/i,
    /同意/i
  ];

  for (const pattern of buttonPatterns) {
    const button = page.getByRole('button', { name: pattern }).first();
    try {
      if (await button.isVisible({ timeout: 1000 })) {
        await button.click({ timeout: 1000 });
        await sleep(800);
        return true;
      }
    } catch (error) {
      continue;
    }
  }
  return false;
}

async function captureGoogleDebug(page, outputDir, querySpec, pageIndex, pageResults) {
  const safeQuery = `${querySpec.language}-${querySpec.translatedQuery}`
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .slice(0, 80);
  const debugDir = path.join(outputDir, 'google-debug');
  ensureDir(debugDir);
  const html = await page.content();
  writeJson(path.join(debugDir, `${safeQuery}-page-${pageIndex + 1}.json`), {
    query: querySpec,
    url: page.url(),
    title: await page.title(),
    resultCount: pageResults.length
  });
  fs.writeFileSync(path.join(debugDir, `${safeQuery}-page-${pageIndex + 1}.html`), html, 'utf8');
}

async function detectGoogleBlock(page) {
  const currentUrl = page.url();
  if (/google\.com\/sorry\//i.test(currentUrl)) {
    return {
      blocked: true,
      reason: 'google-sorry-page',
      url: currentUrl
    };
  }

  const title = await page.title().catch(() => '');
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  if (/unusual traffic/i.test(bodyText) || /our systems have detected/i.test(bodyText) || /captcha/i.test(bodyText)) {
    return {
      blocked: true,
      reason: 'google-unusual-traffic-page',
      url: currentUrl,
      title
    };
  }

  return { blocked: false };
}

async function performManualGoogleAuth(searchPage, config, logs) {
  if (!config.manual_google_auth) {
    return;
  }
  const googleHome = new URL('https://www.google.com/');
  if (config.country_hint) {
    googleHome.searchParams.set('gl', config.country_hint);
  }
  if (config.language_hint) {
    googleHome.searchParams.set('hl', config.language_hint);
  }

  await searchPage.goto(googleHome.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: config.page_open_timeout_ms
  });
  await sleep(1000);
  await captureGoogleDebug(
    searchPage,
    config.__resolved_output_dir,
    { originalQuery: 'manual-auth', translatedQuery: 'manual-auth', language: config.language_hint || 'en' },
    0,
    []
  );
  logs.manualAuthRequested = true;
  process.stdout.write('\n[trendfetch] Manual Google auth mode is enabled.\n');
  process.stdout.write('[trendfetch] Finish Google consent or verification in the opened browser window.\n');
  await waitForEnter('[trendfetch] Press Enter here after Google is ready to continue searching: ');
}

async function hasNextGooglePage(page) {
  const nextLink = page.locator('a#pnnext');
  return nextLink.count().then((count) => count > 0).catch(() => false);
}

async function runGoogleSearch(page, querySpec, config, logs) {
  const collected = [];
  let pageIndex = 0;
  let start = 0;

  while (pageIndex < config.max_pages_per_query && collected.length < config.top_results_limit_per_query) {
    const searchUrl = new URL('https://www.google.com/search');
    searchUrl.searchParams.set('q', querySpec.translatedQuery);
    searchUrl.searchParams.set('hl', querySpec.language || config.language_hint);
    searchUrl.searchParams.set('num', '10');
    searchUrl.searchParams.set('start', String(start));
    if (config.country_hint) {
      searchUrl.searchParams.set('gl', config.country_hint);
    }

    await page.goto(searchUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: config.page_open_timeout_ms
    });
    await sleep(randomDelay(config.delay_range_ms));
    await acceptGoogleConsent(page);
    const blockState = await detectGoogleBlock(page);
    if (blockState.blocked) {
      await captureGoogleDebug(page, config.__resolved_output_dir, querySpec, pageIndex, []);
      const error = new Error(blockState.reason);
      error.code = 'GOOGLE_BLOCKED';
      error.details = blockState;
      throw error;
    }

    const pageResults = await extractGoogleResults(page);
    await captureGoogleDebug(page, config.__resolved_output_dir, querySpec, pageIndex, pageResults);
    if (pageResults.length === 0) {
      break;
    }

    for (const result of pageResults) {
      if (collected.length >= config.top_results_limit_per_query) {
        break;
      }
      collected.push({
        ...result,
        originalQuery: querySpec.originalQuery,
        translatedQuery: querySpec.translatedQuery,
        queryLanguage: querySpec.language,
        googlePage: pageIndex + 1
      });
    }

    logs.googlePagesVisited += 1;
    pageIndex += 1;
    start += 10;

    if (!(await hasNextGooglePage(page))) {
      break;
    }
  }

  return collected;
}

function extractCandidateLinks(baseUrl, links, maxResultsPerSite) {
  const candidates = [];
  for (const link of links) {
    if (candidates.length >= maxResultsPerSite) {
      break;
    }
    const href = link.href || '';
    if (!href) {
      continue;
    }
    try {
      const absolute = new URL(href, baseUrl).toString();
      const parsed = new URL(absolute);
      if (!/^https?:$/.test(parsed.protocol)) {
        continue;
      }
      if (hostnameFromUrl(absolute) !== hostnameFromUrl(baseUrl)) {
        continue;
      }
      if (!CONTACT_PATHS.some((pathname) => parsed.pathname === pathname || parsed.pathname.startsWith(`${pathname}/`))) {
        continue;
      }
      if (!candidates.includes(absolute)) {
        candidates.push(absolute);
      }
    } catch (error) {
      continue;
    }
  }
  return candidates;
}

function extractAddressHints(text) {
  const normalized = normalizeWhitespace(text);
  const addressMatch = normalized.match(/(?:address|located at|office)[:\s-]*([^|]+)/i);
  const addressText = addressMatch ? normalizeWhitespace(addressMatch[1]) : '';
  const parts = addressText.split(',').map((part) => normalizeWhitespace(part)).filter(Boolean);
  return {
    country: parts.length > 0 ? parts[parts.length - 1] : '',
    city: parts.length > 1 ? parts[parts.length - 2] : ''
  };
}

function uniqueMatches(regex, text) {
  const matches = new Set();
  const source = String(text || '');
  for (const match of source.match(regex) || []) {
    matches.add(normalizeWhitespace(match));
  }
  return Array.from(matches);
}

function findContactPerson(text) {
  const match = String(text || '').match(PERSON_REGEX);
  return match ? normalizeWhitespace(match[1]) : '';
}

async function extractSiteSignals(page) {
  return page.evaluate(() => {
    const title = document.title || '';
    const bodyText = document.body ? document.body.innerText : '';
    const allLinks = Array.from(document.querySelectorAll('a')).map((anchor) => ({
      href: anchor.href,
      text: anchor.textContent || ''
    }));
    const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((anchor) => anchor.getAttribute('href') || '');
    const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]')).map((anchor) => anchor.getAttribute('href') || '');
    const brandText = document.querySelector('header img[alt], img[alt], .logo, [class*="brand"]')?.getAttribute?.('alt')
      || document.querySelector('.logo, [class*="brand"]')?.textContent
      || '';
    return {
      title,
      bodyText,
      allLinks,
      mailtoLinks,
      telLinks,
      brandText
    };
  });
}

function deriveStoreName(signals, pageUrl) {
  const brand = normalizeWhitespace(signals.brandText);
  if (brand) {
    return brand;
  }
  const title = normalizeWhitespace(signals.title);
  if (title) {
    return title.split('|')[0].split('-')[0].trim();
  }
  return hostnameFromUrl(pageUrl);
}

function deriveConfidence(text, emails, phones, repeatedHits) {
  let score = 0.2 + Math.max(scoreText(text), 0) * 0.1;
  if (emails.length > 0) {
    score += 0.2;
  }
  if (phones.length > 0) {
    score += 0.2;
  }
  if (/cart|checkout|wholesale|catalog|shop|store|supplier|manufacturer/i.test(text)) {
    score += 0.2;
  }
  if (repeatedHits > 1) {
    score += 0.1;
  }
  return Math.min(1, Number(score.toFixed(2)));
}

async function crawlSite(browser, candidate, config, failures) {
  const context = await browser.newContext({
    userAgent: config.user_agent,
    viewport: config.viewport,
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  let failureCount = 0;
  const visitedPages = [];
  const aggregate = {
    text: '',
    emails: new Set(),
    phones: new Set(),
    contactPerson: '',
    storeName: '',
    country: '',
    city: '',
    sourceContactPage: ''
  };

  try {
    await page.goto(candidate.url, {
      waitUntil: 'domcontentloaded',
      timeout: config.page_open_timeout_ms
    });
  } catch (error) {
    failures.push({
      website_url: candidate.url,
      source_query: candidate.originalQuery,
      query_language: candidate.queryLanguage,
      failure_stage: 'homepage',
      failure_reason: error.message,
      attempt_count: 1,
      last_error_at: new Date().toISOString()
    });
    await context.close();
    return null;
  }

  const homepageSignals = await extractSiteSignals(page);
  const candidatePages = extractCandidateLinks(candidate.url, homepageSignals.allLinks, config.max_results_per_site);
  candidatePages.unshift(candidate.url);

  for (const pageUrl of candidatePages) {
    if (visitedPages.includes(pageUrl)) {
      continue;
    }
    visitedPages.push(pageUrl);
    try {
      if (page.url() !== pageUrl) {
        await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.page_load_timeout_ms
        });
      }
      await sleep(randomDelay(config.delay_range_ms));
      const signals = await extractSiteSignals(page);
      const text = normalizeWhitespace(`${signals.title}\n${signals.bodyText}`);
      aggregate.text += ` ${text}`;
      if (!aggregate.storeName) {
        aggregate.storeName = deriveStoreName(signals, pageUrl);
      }
      if (!aggregate.contactPerson) {
        aggregate.contactPerson = findContactPerson(text);
      }
      for (const value of uniqueMatches(EMAIL_REGEX, `${text}\n${signals.mailtoLinks.join('\n')}`)) {
        aggregate.emails.add(value.replace(/\s*\[at\]\s*/i, '@').replace(/\s*\(at\)\s*/i, '@'));
      }
      for (const value of uniqueMatches(PHONE_REGEX, `${text}\n${signals.telLinks.join('\n')}`)) {
        aggregate.phones.add(value);
      }
      const address = extractAddressHints(text);
      if (!aggregate.country && address.country) {
        aggregate.country = address.country;
      }
      if (!aggregate.city && address.city) {
        aggregate.city = address.city;
      }
      if ((!aggregate.sourceContactPage || /contact/i.test(pageUrl)) && (aggregate.emails.size > 0 || aggregate.phones.size > 0)) {
        aggregate.sourceContactPage = pageUrl;
      }
    } catch (error) {
      failureCount += 1;
      failures.push({
        website_url: candidate.url,
        source_query: candidate.originalQuery,
        query_language: candidate.queryLanguage,
        failure_stage: 'subpage',
        failure_reason: `${pageUrl}: ${error.message}`,
        attempt_count: failureCount,
        last_error_at: new Date().toISOString()
      });
      if (failureCount >= config.max_site_failures_before_skip) {
        break;
      }
    }
  }

  await context.close();
  const combinedText = normalizeWhitespace(aggregate.text);
  if (scoreText(combinedText) <= 0) {
    return {
      filtered: true,
      reason: 'site-content-low-relevance',
      candidate
    };
  }

  return {
    filtered: false,
    row: {
      store_name: aggregate.storeName || hostnameFromUrl(candidate.url),
      website_url: candidate.url,
      contact_person: aggregate.contactPerson,
      country: aggregate.country,
      city: aggregate.city,
      phone: Array.from(aggregate.phones).join(' | '),
      email: Array.from(aggregate.emails).join(' | '),
      query_original: candidate.originalQuery,
      query_translated: candidate.translatedQuery,
      query_language: candidate.queryLanguage,
      source_query: candidate.translatedQuery,
      source_google_page: candidate.googlePage,
      source_contact_page: aggregate.sourceContactPage || candidate.url,
      confidence_score: 0,
      notes: ''
    },
    siteText: combinedText
  };
}

function mergeRowsByDomain(rows) {
  const byDomain = new Map();
  for (const item of rows) {
    const domain = hostnameFromUrl(item.row.website_url);
    const existing = byDomain.get(domain);
    if (!existing) {
      byDomain.set(domain, {
        row: { ...item.row },
        siteTexts: [item.siteText],
        hitCount: 1
      });
      continue;
    }
    existing.hitCount += 1;
    existing.siteTexts.push(item.siteText);
    const mergeField = (field) => {
      const values = [existing.row[field], item.row[field]]
        .flatMap((value) => String(value || '').split(' | '))
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean);
      existing.row[field] = Array.from(new Set(values)).join(' | ');
    };
    for (const field of ['phone', 'email', 'query_original', 'query_translated', 'query_language']) {
      mergeField(field);
    }
    for (const field of ['contact_person', 'country', 'city', 'source_contact_page']) {
      if (!existing.row[field] && item.row[field]) {
        existing.row[field] = item.row[field];
      }
    }
  }

  const merged = [];
  for (const value of byDomain.values()) {
    value.row.confidence_score = deriveConfidence(
      value.siteTexts.join(' '),
      value.row.email ? value.row.email.split(' | ') : [],
      value.row.phone ? value.row.phone.split(' | ') : [],
      value.hitCount
    );
    merged.push(value.row);
  }
  return merged;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.config) {
    throw new Error('Missing required argument: --config <path>');
  }
  if (!chromium) {
    throw new Error('Missing dependency: playwright. Run npm install in the scripts directory before executing this runner.');
  }

  const configPath = path.resolve(process.cwd(), args.config);
  const config = mergeConfig(readJson(configPath));
  const validationErrors = validateConfig(config);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid config:\n- ${validationErrors.join('\n- ')}`);
  }

  const outputDir = resolveOutputDir(configPath, config.output_dir);
  ensureDir(outputDir);

  const browser = await chromium.launch({ headless: config.headless });
  const searchContext = await browser.newContext({
    userAgent: config.user_agent,
    viewport: config.viewport,
    ignoreHTTPSErrors: true
  });
  const searchPage = await searchContext.newPage();

  const logs = {
    startedAt: new Date().toISOString(),
    googlePagesVisited: 0,
    googleBlocked: false,
    manualAuthRequested: false
  };
  const failures = [];
  const filtered = [];
  const successfulRows = [];

  const querySpecs = config.auto_translate_queries
    ? expandQueries(config.queries, config.search_languages)
    : config.queries.map((query) => ({
      originalQuery: query,
      translatedQuery: query,
      language: config.language_hint || 'en',
      generated: false
    }));

  config.__resolved_output_dir = outputDir;
  writeJson(path.join(outputDir, 'query-expansions.json'), querySpecs);
  await performManualGoogleAuth(searchPage, config, logs);

  for (const querySpec of querySpecs) {
    let results = [];
    try {
      results = await runGoogleSearch(searchPage, querySpec, config, logs);
    } catch (error) {
      const failureStage = error.code === 'GOOGLE_BLOCKED' ? 'google-blocked' : 'google-search';
      failures.push({
        website_url: '',
        source_query: querySpec.translatedQuery,
        query_language: querySpec.language,
        failure_stage: failureStage,
        failure_reason: error.message,
        attempt_count: 1,
        last_error_at: new Date().toISOString()
      });
      if (error.code === 'GOOGLE_BLOCKED') {
        logs.googleBlocked = true;
        if (config.stop_on_google_block) {
          break;
        }
      }
      continue;
    }

    for (const result of results) {
      const normalized = normalizeUrl(result.url);
      if (!normalized) {
        filtered.push({ ...result, reason: 'invalid-url' });
        continue;
      }
      const decision = shouldKeepSearchResult(result);
      if (!decision.keep) {
        filtered.push({ ...result, reason: decision.reason, score: decision.score });
        continue;
      }

      const candidate = { ...result, url: normalized };
      const crawlOutcome = await crawlSite(browser, candidate, config, failures);
      if (!crawlOutcome) {
        continue;
      }
      if (crawlOutcome.filtered) {
        filtered.push({
          ...candidate,
          reason: crawlOutcome.reason
        });
        continue;
      }
      try {
        const llmDecision = await runLlmReview(config, crawlOutcome.row, crawlOutcome.siteText);
        if (!llmDecision.keep) {
          filtered.push({
            ...candidate,
            reason: 'llm-rejected',
            notes: llmDecision.row.notes || ''
          });
          continue;
        }
        successfulRows.push({
          ...crawlOutcome,
          row: llmDecision.row
        });
      } catch (error) {
        failures.push({
          website_url: candidate.url,
          source_query: candidate.originalQuery,
          query_language: candidate.queryLanguage,
          failure_stage: 'llm-review',
          failure_reason: error.message,
          attempt_count: 1,
          last_error_at: new Date().toISOString()
        });
        successfulRows.push(crawlOutcome);
      }
    }
  }

  await searchContext.close();
  await browser.close();

  const mergedRows = mergeRowsByDomain(successfulRows);
  writeCsv(path.join(outputDir, 'results.csv'), mergedRows, [
    'store_name',
    'website_url',
    'contact_person',
    'country',
    'city',
    'phone',
    'email',
    'query_original',
    'query_translated',
    'query_language',
    'source_query',
    'source_google_page',
    'source_contact_page',
    'confidence_score',
    'notes'
  ]);

  writeJson(path.join(outputDir, 'failures.json'), failures);
  writeJson(path.join(outputDir, 'filtered.json'), filtered);
  writeJson(path.join(outputDir, 'run-summary.json'), {
    startedAt: logs.startedAt,
    completedAt: new Date().toISOString(),
    googlePagesVisited: logs.googlePagesVisited,
    googleBlocked: logs.googleBlocked,
    manualAuthRequested: logs.manualAuthRequested,
    expandedQueries: querySpecs.length,
    successfulDomains: mergedRows.length,
    failureCount: failures.length,
    filteredCount: filtered.length
  });
}

main().catch((error) => {
  console.error(`[trendfetch] ${error.message}`);
  process.exitCode = 1;
});
