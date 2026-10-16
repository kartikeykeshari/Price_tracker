# Changelog

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
