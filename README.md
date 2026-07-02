# Walkman Restoration Scout

Dashboard and Railway workers for finding broken Walkmans that can be restored and resold.

## Data Flow

1. `npm run catalog:prod` reads `https://walkman.land/catalog` and stores the current model names.
2. `npm run ebay:market:prod` searches current eBay Browse listings for active, non-broken devices and stores them as market-value comparables.
3. `npm run walkman-land:market:prod` reads the eBay offer cards on each Walkman.land model page and stores them as a separate market source.
4. `npm run ebay:damaged:prod` searches current eBay Browse listings for broken or parts-only devices.
5. `npm run monthly:prod` runs catalog, market, Walkman.land market, and damaged scans in order.

The sold-data endpoint is eBay Marketplace Insights and is restricted for the current eBay app. The dashboard therefore uses active, non-broken listings for automated market-value estimates and links each model to eBay Seller Hub sold research for manual review.

## Local

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Without `DATABASE_URL`, the dashboard opens with an empty state.

## Railway

Recommended services:

- Postgres
- `walkman-restoration-api`
  - start command: `npm start`
  - variables: `DATABASE_URL`, `API_READ_TOKEN`, eBay credentials
  - public domain enabled
- `walkman-restoration-cron`
  - start command: `npm run catalog:prod`
  - cron schedule: `0 4 1 * *`
  - variables: `DATABASE_URL`, scan limits
- `walkman-ebay-market-cron`
  - start command: `npm run ebay:market:prod`
  - variables: `DATABASE_URL`, eBay credentials, scan limits
- `walkman-land-market-cron`
  - start command: `npm run walkman-land:market:prod`
  - cron schedule: `15 4 1 * *`
  - variables: `DATABASE_URL`, Walkman.land scan limits
- `walkman-ebay-damaged-cron`
  - start command: `npm run ebay:damaged:prod`
  - variables: `DATABASE_URL`, eBay credentials, scan limits

## Vercel

Use Vercel for the dashboard. Set:

```text
DATA_API_BASE_URL=https://<railway-api-domain>
API_READ_TOKEN=<same-token-as-railway-api>
```
