'use strict';

const DEFAULT_TIMEOUT_MS = 20000;

function buildPrompt(row, siteText) {
  const excerpt = String(siteText || '').slice(0, 6000);
  return [
    'You validate whether a website is a relevant online store for adult products or intimate products.',
    'Return strict JSON only.',
    'Schema:',
    '{"is_relevant":boolean,"confidence":number,"store_name":"","contact_person":"","country":"","city":"","phone":"","email":"","notes":""}',
    'Use the extracted row as your starting point and only fill fields supported by the supplied page text.',
    'If the site is not relevant, set is_relevant to false and explain briefly in notes.',
    '',
    'Extracted row:',
    JSON.stringify(row),
    '',
    'Site text excerpt:',
    excerpt
  ].join('\n');
}

async function callLlm(config, prompt) {
  const response = await fetch(`${String(config.base_url).replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.api_key}`
    },
    body: JSON.stringify({
      model: config.model_name,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user', content: prompt }
      ]
    }),
    signal: AbortSignal.timeout(Number(config.llm_timeout_ms || DEFAULT_TIMEOUT_MS))
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM response did not contain message content.');
  }

  let normalizedContent = content;
  if (Array.isArray(content)) {
    normalizedContent = content
      .map((item) => (typeof item === 'string' ? item : item?.text || ''))
      .join('');
  }
  if (typeof normalizedContent !== 'string') {
    throw new Error('LLM response content was not a JSON string.');
  }
  return JSON.parse(normalizedContent);
}

function mergeLlmFields(row, llmResult) {
  return {
    ...row,
    store_name: llmResult.store_name || row.store_name,
    contact_person: llmResult.contact_person || row.contact_person,
    country: llmResult.country || row.country,
    city: llmResult.city || row.city,
    phone: llmResult.phone || row.phone,
    email: llmResult.email || row.email,
    confidence_score: llmResult.confidence != null ? llmResult.confidence : row.confidence_score,
    notes: [row.notes, llmResult.notes].filter(Boolean).join(' | ')
  };
}

async function runLlmReview(config, row, siteText) {
  if (!config.enable_llm_review) {
    return { keep: true, row };
  }
  if (!config.base_url || !config.api_key || !config.model_name) {
    throw new Error('LLM review is enabled but base_url, api_key, or model_name is missing.');
  }

  const prompt = buildPrompt(row, siteText);
  const llmResult = await callLlm(config, prompt);
  if (!llmResult || typeof llmResult !== 'object') {
    throw new Error('LLM review returned an invalid payload.');
  }
  if (llmResult.is_relevant === false) {
    return {
      keep: false,
      row: {
        ...row,
        notes: [row.notes, llmResult.notes || 'Rejected by LLM review'].filter(Boolean).join(' | ')
      }
    };
  }
  return {
    keep: true,
    row: mergeLlmFields(row, llmResult)
  };
}

module.exports = {
  runLlmReview
};
