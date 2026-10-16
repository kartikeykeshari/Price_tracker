# Price Tracker

**Current version: 1.0.4.** Release history is in [docs/CHANGELOG.md](docs/CHANGELOG.md).

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

### Memberships and Stripe (local testing)

The app sells one-time credit packs: $1 for 100 checks, $10 for 1,000 checks, and $1,000 for 10,000 checks. Set Stripe test credentials in `server/.env`. Create a Stripe webhook endpoint for `/api/payments/webhook` listening to `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then put its signing secret in `STRIPE_WEBHOOK_SECRET`. For local webhook forwarding, use Stripe CLI: `stripe listen --forward-to localhost:5000/api/payments/webhook`. Set `ADMIN_EMAILS` to a comma-separated list of account emails; create and verify those accounts to grant admin console access.

New accounts receive 20 free checks after email verification if the signup network has not already claimed the starter offer. The server limits this to one grant per IPv4 `/24` or IPv6 `/64` network.

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
