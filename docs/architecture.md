# Architecture

![diagram](architecture.svg)

## System overview
```mermaid
flowchart LR
  U[User browser<br/>React + Vite] -- REST/JSON + JWT --> A[Express API]
  A --> M[(MongoDB<br/>users, products)]
  S[node-cron scheduler<br/>every minute] --> M
  S --> SC[Scraper<br/>axios + cheerio]
  SC -- HTTP GET --> W[(Shopping websites)]
  S --> ML[Mailer<br/>nodemailer]
  ML -- SMTP --> E[(User's inbox)]
  A --- S
```

## Price-check sequence
```mermaid
sequenceDiagram
  participant C as Cron (1 min)
  participant DB as MongoDB
  participant SC as Scraper
  participant ML as Mailer
  C->>DB: find active products with nextCheckAt <= now
  loop each due product
    C->>SC: scrape(url, selector)
    SC-->>C: price, currency, title
    C->>DB: save history, lastPrice, currentPrice, nextCheckAt
    alt new price < previous price
      C->>ML: sendPriceDrop(user, product)
      ML-->>User: formatted HTML email
    end
  end
```

## Data model
- **User**: name, email (unique), password (bcrypt hash)
- **Product**: user, url, title, selector, currency, currentPrice, lastPrice, lowestPrice,
  frequency{count, period}, active, nextCheckAt, lastCheckedAt, lastError, history[{price, at}]

## API
| Method | Path | Purpose |
|---|---|---|
| POST | /api/auth/register, /login | create account / sign in |
| GET | /api/auth/me | current user |
| GET | /api/products | list my products |
| POST | /api/products | add many URLs {urls[], frequency{count,period}, selector?} |
| PATCH | /api/products/:id | change frequency, pause/resume, selector |
| POST | /api/products/:id/check | check right now |
| DELETE | /api/products/:id | stop tracking |
