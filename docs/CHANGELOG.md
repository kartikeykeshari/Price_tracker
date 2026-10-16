# Changelog

## 1.0.4 — One-time starter credits

- Grant 20 free price checks after a new account verifies its email address.
- Limit the welcome grant to one claim per IPv4 `/24` or IPv6 `/64` signup network. Store only a keyed HMAC of the network prefix, not the raw IP address.
- Record the free grant in the credit ledger and commit the account balance, claim, and ledger entry in one MongoDB transaction.
- Add the stable `FREE_TRIAL_SECRET` setting and document shared-network limits and remaining abuse risks.
- Existing accounts do not receive retroactive starter credits.

### Deployment requirements and known limits

- Set `FREE_TRIAL_SECRET` to a separate random secret of at least 32 bytes in production and keep it stable. Rotating it resets the network matching for future signup claims.
- People behind the same network share one starter grant, and people who change networks may still claim again. Use CAPTCHA or phone verification if stronger abuse controls are needed.

## 1.0.3 — Admin console and prepaid hit packs

- Add server-defined one-time packs at $1/100, $10/1,000, and $1,000/10,000 price checks. Checkout amounts are built on the server and payments use Stripe-hosted Checkout.
- Verify Stripe webhook signatures and validate the paid Checkout Session against its account, plan, currency, and expected amount before granting credits. Persist unique event/session records and update the account balance and ledger in MongoDB transactions.
- Charge one hit for each initiated scrape attempt. Pause products when a user's balance runs out, and expose the available balance and pack purchase controls in the app.
- Add an admin console to search users, inspect credit history, grant an audited pack, and disable or enable accounts. Admin access is bootstrapped from `ADMIN_EMAILS` and is never user-selectable.
- Require Stripe credentials and a configured admin email in production; document webhook setup, MongoDB replica-set transactions, and refund/chargeback operations.
- The top plan is priced at ten times the per-hit cost of the first two, following the requested prices. Confirm before enabling live payments.

### Deployment requirements and known limits

- Configure a Stripe webhook endpoint and keep its signing secret and Stripe API key on the server. Checkout success redirects do not activate credits.
- Use a MongoDB replica set or Atlas cluster for atomic balance and ledger transactions. The local Docker Compose MongoDB starts as a single-node replica set.
- Refunds and disputes need manual review; this version does not reverse unused credits automatically.
- Existing accounts start with zero credits. Configure the admin address, then use the admin console to grant a pack or let users buy one.

## 1.0.2 — Production hardening

- Reject product URLs that use credentials, unsupported ports, private or reserved IP addresses, or DNS names resolving to non-public addresses. Validate every HTTP redirect and pin address validation to the actual outbound DNS lookup.
- Replace browser-stored bearer tokens with HttpOnly, SameSite session cookies. Restrict CORS and reject requests from unconfigured browser origins.
- Require email verification for new accounts; existing accounts remain usable. Add request size limits, security headers, MongoDB-backed API and account rate limits, and stricter input validation.
- Limit each user to 100 tracked products and 20 URLs per add request.
- Coordinate scheduled and manual checks across server instances with database check locks. Queue price-drop email alerts in MongoDB and retry failed delivery with backoff.
- Validate required configuration at startup, improve health reporting, and close the HTTP server and MongoDB connection on shutdown.
- Add deployment guidance and an example environment file.

### Deployment requirements and known limits

- Terminate TLS at the application host or a trusted reverse proxy. Serve the client and API from the same site, and set `CLIENT_URL` to the exact browser origin.
- Use an authenticated MongoDB deployment with network restrictions, backups, and monitoring. The application relies on MongoDB TTL and schema indexes; ensure indexes are created before accepting traffic.
- Set SMTP credentials and verify deliverability. Email delivery retries are at least once, so a process failure after the mail provider accepts a message but before MongoDB records success can produce a duplicate alert.
- Apply outbound network egress rules at the host or cloud firewall as another SSRF control. The application blocks private and reserved destinations but should not be the only network boundary.
- Scraping remains best-effort: sites can block requests, change markup, or require JavaScript. Review each target site's terms and use a suitable scraping provider when needed.
- Back up and rotate credentials outside the application. This code release does not configure cloud hosting, a firewall, TLS certificates, MongoDB operations, or SMTP reputation.

## 1.0.1 — Published baseline

- Baseline price tracking application with React/Vite, Express, MongoDB, scheduled scraping, and SMTP price-drop alerts.
- Added the product price-history popup and graph.
