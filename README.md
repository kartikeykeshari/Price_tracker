# Price Tracker (MERN)

Add product URLs, choose how many times per day / week / month to check, and get a formatted
email whenever a price falls below the previous price.

## Run locally
Requirements: Node 18+, MongoDB (local, Atlas, or `docker compose up -d`).

```bash
npm run install:all
cp server/.env.example server/.env     # then edit values
npm run server        # terminal 1 -> http://localhost:5000
npm run client        # terminal 2 -> http://localhost:5173
```

### Email setup
Fill the SMTP_* values in `server/.env`. For Gmail turn on 2-step verification and create an
App Password. If SMTP is not set, emails are only logged to the console (dev mode).

### Using it
1. Register (this email receives alerts) and sign in.
2. Paste one or more product URLs, set e.g. "3 times per day", click **Start tracking**.
3. The first price is read immediately. After that each product is checked on its own schedule.
4. If a new price < the previous price, an HTML email is sent.

### Notes
- Price detection order: your CSS selector → JSON-LD → meta tags → common price selectors.
  Sites that render prices with JavaScript only, or block bots (Amazon/Flipkart often do), may fail;
  the error shows on the product. For those, swap `axios+cheerio` in `server/src/services/scraper.js`
  for Puppeteer/Playwright or a scraping API.
- Minimum interval between checks is 5 minutes. Check each site's terms of service.
- To test an email quickly: add a product, then in MongoDB set its `currentPrice` higher than
  the real price and click **Check now**.
- Production: set a strong `JWT_SECRET`, run `npm run build --prefix client` and serve `client/dist`.

## Structure
```
server/src  models/ routes/ services/(scraper, mailer, scheduler) middleware/
client/src  App.jsx api.js styles.css
docs/       architecture.svg, architecture.md
```
