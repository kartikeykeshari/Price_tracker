const axios = require('axios');
const cheerio = require('cheerio');
const http = require('node:http');
const https = require('node:https');
const { validatePublicUrl, publicLookup } = require('./safeUrl');

const httpAgent = new http.Agent({ lookup: publicLookup });
const httpsAgent = new https.Agent({ lookup: publicLookup });

const SYMBOLS = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };

// "₹1,299.00" -> 1299 | "1.299,50 €" -> 1299.5
function parsePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw > 0 ? raw : null;
  const m = String(raw).replace(/\s/g, '').match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0].replace(/[.,]+$/, '');
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > d) s = s.length - c - 1 <= 2 ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const currencyFrom = (txt = '') => {
  for (const [sym, code] of Object.entries(SYMBOLS)) if (txt.includes(sym)) return code;
  const m = txt.match(/\b(INR|USD|EUR|GBP|JPY|Rs)\b/i);
  return m ? (m[1].toLowerCase() === 'rs' ? 'INR' : m[1].toUpperCase()) : '';
};

// Walk JSON-LD blocks looking for schema.org offers
function fromJsonLd($) {
  let found = null;
  const walk = (node) => {
    if (!node || found) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    if (node.offers) {
      const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
      for (const o of offers) {
        const p = parsePrice(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
        if (p) { found = { price: p, currency: o.priceCurrency || '', title: node.name || '' }; return; }
      }
    }
    Object.values(node).forEach(walk);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try { walk(JSON.parse($(el).contents().text())); } catch { /* ignore bad JSON */ }
  });
  return found;
}

const KNOWN_SELECTORS = [
  '.a-price .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice',   // Amazon
  '._30jeq3', '.Nx9bqj', '.CxhGGd',                                           // Flipkart
  '[itemprop="price"]', '.price-item--sale', '.price__current', '.product-price',
  '.price', '[class*="price"]',
];

async function scrape(url, customSelector) {
  let currentUrl = url, response;
  const deadline = Date.now() + 45000;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const timeout = Math.min(20000, deadline - Date.now());
    if (timeout <= 0) throw new Error('Product page timed out');
    const safe = await validatePublicUrl(currentUrl);
    response = await axios.get(safe.href, {
      timeout,
      maxRedirects: 0,
      maxContentLength: 5 * 1024 * 1024,
      responseType: 'text',
      validateStatus: () => true,
      proxy: false,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      if (redirects === 5) throw new Error('Product page redirected too many times');
      currentUrl = new URL(response.headers.location, safe).href;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Product page returned HTTP ${response.status}`);
    break;
  }
  const html = response.data;
  const $ = cheerio.load(html);
  const title = ($('meta[property="og:title"]').attr('content') || $('title').text() || '').trim().slice(0, 200);
  let price = null, currency = '';

  if (customSelector) {
    const txt = $(customSelector).first().text();
    price = parsePrice(txt); currency = currencyFrom(txt);
  }
  if (!price) {
    const ld = fromJsonLd($);
    if (ld) return { price: ld.price, currency: ld.currency, title: ld.title || title };
  }
  if (!price) {
    const meta = $('meta[property="product:price:amount"], meta[property="og:price:amount"], meta[itemprop="price"]').first().attr('content');
    price = parsePrice(meta);
    currency = $('meta[property="product:price:currency"], meta[property="og:price:currency"]').first().attr('content') || '';
  }
  if (!price) {
    for (const sel of KNOWN_SELECTORS) {
      const el = $(sel).filter((_, e) => parsePrice($(e).attr('content') || $(e).text())).first();
      if (el.length) {
        const txt = el.attr('content') || el.text();
        price = parsePrice(txt); currency = currencyFrom(txt); break;
      }
    }
  }
  if (!price) throw new Error('Could not find a price on this page. Try adding a CSS selector for the price.');
  return { price, currency, title };
}

module.exports = { scrape, parsePrice };
