const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '../dist');
const indexPath = path.join(dist, 'index.html');
const robotsPath = path.join(dist, 'robots.txt');
const sitemapPath = path.join(dist, 'sitemap.xml');
let html = fs.readFileSync(indexPath, 'utf8');
const siteValue = process.env.VITE_SITE_URL;

if (!siteValue) {
  html = html.replace('<meta name="seo-canonical-placeholder" content="" />', '');
  fs.writeFileSync(indexPath, html);
  fs.writeFileSync(robotsPath, 'User-agent: *\nAllow: /\nDisallow: /api/\n');
  if (fs.existsSync(sitemapPath)) fs.unlinkSync(sitemapPath);
  process.exit(0);
}

let site;
try { site = new URL(siteValue); }
catch { throw new Error('VITE_SITE_URL must be a valid site origin, such as https://example.com'); }
if (!['http:', 'https:'].includes(site.protocol) || site.pathname !== '/' || site.search || site.hash)
  throw new Error('VITE_SITE_URL must be an origin only, with no path, query, or fragment');

const origin = site.origin;
const canonical = `${origin}/`;
const escapedOrigin = origin.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
html = html.replace('<meta name="seo-canonical-placeholder" content="" />', `<link rel="canonical" href="${escapedOrigin}/" />\n    <meta property="og:url" content="${escapedOrigin}/" />`);
fs.writeFileSync(indexPath, html);
fs.writeFileSync(robotsPath, `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${canonical}sitemap.xml\n`);
fs.writeFileSync(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${canonical}</loc></url>\n</urlset>\n`);
