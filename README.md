# PricePulse

**Current version: 1.0.5.** Release history is in [docs/CHANGELOG.md](docs/CHANGELOG.md).

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

### Google and Microsoft sign-in

Social sign-in is optional. Create OAuth/OIDC web application registrations with Google Cloud and Microsoft Entra ID, then add the client IDs and secrets to `server/.env`. Register the callback URLs listed in `server/.env.example`; use your deployed HTTPS origin in production. For Microsoft, choose the account audience that matches your users (organizational accounts, personal Microsoft accounts, or both). Google sign-in requires verified email; Microsoft accounts without a verified email claim are asked to verify their email before signing in.

### Memberships and Cashfree (local testing)

The app sells one-time credit packs: $1 for 100 checks, $10 for 1,000 checks, and $1,000 for 10,000 checks. Set Cashfree sandbox credentials in `server/.env` (`CASHFREE_ENV=sandbox`, `CASHFREE_CLIENT_ID`, and `CASHFREE_CLIENT_SECRET`). Configure the Cashfree webhook URL as `/api/payments/webhook` and subscribe to payment success events. The endpoint verifies Cashfree's timestamped signature using the client secret. Local webhook delivery requires a public HTTPS tunnel. Set `ADMIN_EMAILS` to a comma-separated list of account emails; create and verify those accounts to grant admin console access.

The catalog remains in USD. Cashfree must enable international/USD payments for the merchant account; set `CASHFREE_ENV=production` only with production credentials and after that capability is active. Checkout asks for the customer's phone number as required by Cashfree.

New accounts receive 20 free checks after email verification if the signup network has not already claimed the starter offer. The server limits this to one grant per IPv4 `/24` or IPv6 `/64` network.

## Production deployment

See [docs/production.md](docs/production.md) before deployment. At minimum, configure HTTPS, a same-site client/API origin, a strong `JWT_SECRET`, authenticated and backed-up MongoDB, SMTP, and outbound network restrictions. Build the client with `npm run build --prefix client` and serve `client/dist` through your HTTPS web server or reverse proxy.

For search indexing, set `VITE_SITE_URL` to the canonical HTTPS origin in the client build environment. The build then writes a matching canonical URL, `robots.txt`, and `sitemap.xml` into `client/dist`. After deployment, verify those files and submit the sitemap in Google Search Console and Bing Webmaster Tools.

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
