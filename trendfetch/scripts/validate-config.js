'use strict';

const path = require('path');
const { DEFAULT_SEARCH_LANGUAGES } = require('./query-expansion');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return ['Config must be a JSON object.'];
  }

  if (!Array.isArray(config.queries) || config.queries.length === 0) {
    errors.push('queries must be a non-empty array.');
  }

  const numericFields = [
    'max_pages_per_query',
    'top_results_limit_per_query',
    'max_results_per_site',
    'page_open_timeout_ms',
    'page_load_timeout_ms',
    'max_site_failures_before_skip'
  ];

  for (const field of numericFields) {
    if (!isPositiveInteger(config[field])) {
      errors.push(`${field} must be a positive integer.`);
    }
  }

  if (!Array.isArray(config.search_languages) || config.search_languages.length === 0) {
    errors.push('search_languages must be a non-empty array.');
  }

  if (!config.output_dir || typeof config.output_dir !== 'string') {
    errors.push('output_dir must be a non-empty string.');
  }

  if (typeof config.manual_google_auth !== 'boolean') {
    errors.push('manual_google_auth must be a boolean.');
  }

  if (typeof config.stop_on_google_block !== 'boolean') {
    errors.push('stop_on_google_block must be a boolean.');
  }

  if (typeof config.enable_llm_review !== 'boolean') {
    errors.push('enable_llm_review must be a boolean.');
  }

  if (!isPositiveInteger(config.llm_timeout_ms)) {
    errors.push('llm_timeout_ms must be a positive integer.');
  }

  if (config.enable_llm_review) {
    if (!config.base_url || typeof config.base_url !== 'string') {
      errors.push('base_url must be set when enable_llm_review is true.');
    }
    if (!config.api_key || typeof config.api_key !== 'string') {
      errors.push('api_key must be set when enable_llm_review is true.');
    }
    if (!config.model_name || typeof config.model_name !== 'string') {
      errors.push('model_name must be set when enable_llm_review is true.');
    }
  }

  if (config.search_languages) {
    const allowed = new Set(DEFAULT_SEARCH_LANGUAGES);
    for (const language of config.search_languages) {
      if (!allowed.has(language)) {
        errors.push(`Unsupported search language: ${language}`);
      }
    }
  }

  if (config.viewport) {
    if (!isPositiveInteger(config.viewport.width) || !isPositiveInteger(config.viewport.height)) {
      errors.push('viewport.width and viewport.height must be positive integers.');
    }
  }

  if (config.delay_range_ms) {
    const min = config.delay_range_ms.min;
    const max = config.delay_range_ms.max;
    if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < min) {
      errors.push('delay_range_ms must contain integer min/max and max must be >= min.');
    }
  }

  return errors;
}

function resolveOutputDir(configPath, outputDir) {
  return path.resolve(path.dirname(configPath), outputDir);
}

module.exports = {
  validateConfig,
  resolveOutputDir
};
