# Price Tracker

**Current version: 1.0.2.** Release history is in [docs/CHANGELOG.md](docs/CHANGELOG.md).

Add product URLs, choose how often to check them, and receive an email when a price drops below its previous recorded price. New accounts verify their email before they can sign in.

## Run locally

Requirements: Node.js 18 or later and MongoDB (local, Atlas, or `docker compose up -d`).

```bash
npm run install:all
cp server/.env.example server/.env
# Edit server/.env and set a random JWT_SECRET of at least 32 bytes.
npm run server
npm run client
```

The API runs at `http://localhost:5000`; Vite serves the client at `http://localhost:5173` and proxies `/api` requests.

### Email setup

SMTP is optional in development; without it, the app logs a preview instead of sending. Production startup requires `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`. For Gmail, use an app password.

## Production deployment

See [docs/production.md](docs/production.md) before deployment. At minimum, configure HTTPS, a same-site client/API origin, a strong `JWT_SECRET`, authenticated and backed-up MongoDB, SMTP, and outbound network restrictions. Build the client with `npm run build --prefix client` and serve `client/dist` through your HTTPS web server or reverse proxy.

## Application behavior

- The first successful price check is started after a product is added. Scheduled checks run once a minute and respect each product's chosen interval, with a five-minute minimum.
- The price-history chart records the first successful check and later price changes, up to 500 points per product.
- Price detection tries the custom CSS selector, JSON-LD, metadata, then common selectors. JavaScript-rendered pages and bot-protected stores may need a browser-based scraper or scraping provider.
- The server rejects private and reserved network destinations when fetching product pages, including destinations reached through redirects. Configure host-level egress restrictions as an additional boundary.
- Each site has its own terms and access rules; check them before tracking.

## Project structure

```text
server/src  models/ routes/ services/ middleware/
client/src  App.jsx api.js styles.css
docs/       architecture.md production.md CHANGELOG.md
```
