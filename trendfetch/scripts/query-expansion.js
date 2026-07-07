'use strict';

const DEFAULT_SEARCH_LANGUAGES = [
  'en', 'ja', 'zh', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar',
  'ko', 'tr', 'nl', 'pl', 'hi', 'vi', 'th', 'id', 'ms', 'uk'
];

const DOMAIN_QUERY_CATALOG = {
  adult: {
    en: ['adult products', 'sex toys', 'adult shop'],
    ja: ['アダルトグッズ', '大人のおもちゃ', 'アダルトショップ'],
    zh: ['成人用品', '情趣用品', '成人用品店'],
    es: ['productos para adultos', 'juguetes sexuales', 'tienda erotica'],
    pt: ['produtos adultos', 'brinquedos sexuais', 'sex shop'],
    fr: ['produits pour adultes', 'jouets sexuels', 'boutique erotique'],
    de: ['erwachsenenprodukte', 'sextoys', 'erotik shop'],
    it: ['prodotti per adulti', 'giocattoli sessuali', 'sex shop'],
    ru: ['товары для взрослых', 'секс игрушки', 'магазин для взрослых'],
    ar: ['منتجات للبالغين', 'العاب جنسية', 'متجر للبالغين'],
    ko: ['성인용품', '섹스토이', '성인용품 쇼핑몰'],
    tr: ['yetişkin ürünleri', 'seks oyuncaklari', 'erotik magaza'],
    nl: ['producten voor volwassenen', 'seksspeeltjes', 'erotische winkel'],
    pl: ['produkty dla doroslych', 'zabawki erotyczne', 'sklep erotyczny'],
    hi: ['वयस्क उत्पाद', 'सेक्स टॉय', 'एडल्ट स्टोर'],
    vi: ['san pham nguoi lon', 'do choi tinh duc', 'cua hang nguoi lon'],
    th: ['สินค้า สำหรับ ผู้ใหญ่', 'เซ็กซ์ทอย', 'ร้าน ของเล่น ผู้ใหญ่'],
    id: ['produk dewasa', 'mainan seks', 'toko dewasa'],
    ms: ['produk dewasa', 'alat mainan seks', 'kedai dewasa'],
    uk: ['товари для дорослих', 'секс іграшки', 'магазин для дорослих']
  }
};

const ADULT_PATTERNS = [
  /成人用品/u,
  /情趣用品/u,
  /adult/i,
  /sex toy/i,
  /sextoy/i,
  /erotic/i,
  /intimate/i,
  /vibrator/i
];

function detectDomain(query) {
  const raw = String(query || '').trim();
  if (!raw) {
    return 'generic';
  }
  if (ADULT_PATTERNS.some((pattern) => pattern.test(raw))) {
    return 'adult';
  }
  return 'generic';
}

function uniqueTrimmed(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const value = String(item || '').trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  }
  return output;
}

function expandSingleQuery(query, languages) {
  const original = String(query || '').trim();
  const domain = detectDomain(original);
  const expanded = [];

  for (const language of languages) {
    const languageCatalog = DOMAIN_QUERY_CATALOG[domain] && DOMAIN_QUERY_CATALOG[domain][language];
    const phrases = languageCatalog && languageCatalog.length > 0
      ? languageCatalog
      : [original];

    for (const phrase of uniqueTrimmed(phrases)) {
      expanded.push({
        originalQuery: original,
        translatedQuery: phrase,
        language,
        domain,
        generated: phrase.toLowerCase() !== original.toLowerCase()
      });
    }
  }

  return expanded;
}

function expandQueries(queries, searchLanguages) {
  const languages = Array.isArray(searchLanguages) && searchLanguages.length > 0
    ? uniqueTrimmed(searchLanguages)
    : DEFAULT_SEARCH_LANGUAGES;

  const items = [];
  for (const query of queries || []) {
    items.push(...expandSingleQuery(query, languages));
  }
  return items;
}

module.exports = {
  DEFAULT_SEARCH_LANGUAGES,
  expandQueries
};
