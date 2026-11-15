# Household investment tracker

A private, shared portfolio dashboard for four family members. The app uses Google OAuth for identity, an administrator-maintained email allowlist for access, and AES-256-GCM encryption for the local data file. It never asks for Google passwords or collects PAN, Aadhaar, or broker login credentials. Account, policy and wallet identifiers in imports are encrypted at rest and visible to authorized family members.

## Run locally

Requires Node.js 18 or newer. No third-party runtime packages are required.

```powershell
npm.cmd start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Configure the environment variables below before signing in or saving household records. The app intentionally does not store portfolio data when its encryption key is missing.

Generate a 32-byte encryption key without installing extra tools:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set the returned value as `DATA_ENCRYPTION_KEY`. For local development, copy `.env.example` to `.env` and add the settings there:

```powershell
Copy-Item .env.example .env
```

The local server loads `.env` automatically outside production; variables already set in the process environment take precedence. Restart `npm.cmd start` after editing it. The `.env` file is git-ignored—never commit or share it. Production deployments should inject secrets from a secret manager; `.env` is intentionally not loaded when `NODE_ENV=production`. Keep the encryption key separate from the encrypted data file: losing the key makes that file unrecoverable.

## Google sign-in and family access

1. In Google Cloud Console, create an OAuth 2.0 **Web application** client and configure the OAuth consent screen. If the consent screen is in Testing, add all four family accounts as test users.
2. Add the exact redirect URI to the client's authorized redirect URIs. For local development use `http://127.0.0.1:3000/auth/google/callback`; for deployment use `https://YOUR_HOST/auth/google/callback`.
3. Paste your client ID, client secret, and the four family Google account emails into `.env`. For a local app the settings should look like:

```text
APP_ORIGIN=http://127.0.0.1:3000
GOOGLE_CLIENT_ID=your-oauth-client-id
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:3000/auth/google/callback
GOOGLE_ALLOWED_EMAILS=member1@gmail.com,member2@gmail.com,member3@gmail.com,member4@gmail.com
FAMILY_MEMBER_NAMES=Member One,Member Two,Member Three,Member Four
DATA_ENCRYPTION_KEY=64-hexadecimal-characters
DATA_FILE=./data/family-investments.enc
```

`FAMILY_MEMBER_NAMES` is optional and lists display names in the same order as `GOOGLE_ALLOWED_EMAILS`; when omitted, names are derived from each email's part before `@`. Generate and set `DATA_ENCRYPTION_KEY` using the PowerShell command above. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` come from the Google Cloud OAuth client; the app cannot create those credentials for you. Save `.env`, restart the server, and reload the page. The sign-in screen lists any missing setting names without showing their values.

The allowlist must contain four distinct email addresses. Access is checked against the verified email returned by Google. OAuth uses a one-time state value and PKCE; session cookies are HTTP-only, SameSite=Lax, and Secure when `NODE_ENV=production`. Sessions live in process memory for 12 hours and are cleared when the server restarts. The default listener is local-only (`127.0.0.1`); on deployment, bind only behind a trusted HTTPS reverse proxy and configure `HOST`, `APP_ORIGIN` and the Google redirect URI accordingly. Set `NODE_ENV=production` only behind HTTPS.

Every authorized family member can view and edit the shared household portfolio. Adding or removing a family member requires an administrator to update `GOOGLE_ALLOWED_EMAILS` and restart the app. No account is created from an unverified or non-allowlisted Google identity.

## Features

- Household overview with portfolio value, active cost basis, realized and unrealized return, dividend/interest income, product allocation, reminders and illustrative projections.
- Listed equity, equity/debt mutual funds, fixed deposits, bonds/NCDs, PPF/EPF, NPS, gold and other holdings, with per-member ownership.
- Transaction ledger for buys, sales, dividends/interest and bonus units. Sales use FIFO purchase lots to calculate realized return; bonus units are added at zero cost.
- Fixed-income maturity and next-interest reminders (up to 90 and 30 days ahead, respectively). Dates are entered by a family member; reminders appear in the dashboard and are not sent as email or push notifications.
- Editable investment details, manual price updates and a multi-sheet Excel import template with dropdowns and maturity formulas. The export contains private portfolio data.
- Same-name holdings remain separate. A matching reference number is treated as a duplicate only for the same family member, product type and institution; exported holding IDs also prevent duplicate re-imports. Rows without a reference remain separate. Duplicate transaction events are rejected, and a sale cannot exceed the recorded available units.
- Return projections for 1, 3, 5 and 10 years, with editable annual-growth and monthly-contribution assumptions.

### Prices and broker integrations

For listed equities, the app searches NSE's official `EQUITY_L.csv` after at least three search characters and refreshes prices from the latest available official `sec_bhavdata_full_DDMMYYYY.csv` bhavcopy. These are end-of-day closes, not live quotes. For equity and debt mutual funds, search and price refresh use AMFI's published `NAVAll.txt` data; both the scheme name and numeric AMFI scheme code are required, and the NAV date is shown per holding. NAVs are published periodically, not intraday. Both sources are fetched on demand and cached briefly; download failures are reported rather than shown as fresh prices.

Bond/NCD prices require a trusted market-data adapter that can return a price per unit for the holding's ISIN. There is no single built-in public feed for all government and corporate bonds, so bonds remain manually priced unless that adapter is configured. The app does not connect directly to broker accounts. Configure:

```text
MARKET_DATA_URL=https://YOUR_TRUSTED_ADAPTER/prices
MARKET_DATA_TOKEN=optional-server-side-bearer-token
```

The adapter receives a JSON `POST` body `{ "symbols": ["INE123A01011"] }` with an optional bearer token. The identifiers can be NSE tickers, AMFI scheme codes, or bond ISINs. It must return `{ "prices": [{ "symbol": "INE123A01011", "price": 1025.5, "asOf": "2026-11-15T10:00:00Z" }] }`; `price` must be the value per holding unit in INR. A configured adapter replaces NSE pricing for listed equities and takes precedence for any identifiers it returns; AMFI fills mutual-fund prices not returned by the adapter. When no adapter is configured, NSE prices listed equities and AMFI prices matching mutual-fund schemes. The app records each source and provider date; verify freshness and units with the provider. The adapter must be HTTPS except for localhost development.

## Publish on Render

The root `render.yaml` defines a single-instance Node web service and a 1 GB persistent disk mounted at `/var/data`. It uses Render's Singapore region as the closest listed region for India; Render does not list an India region. This stores the household file outside India, so confirm that is acceptable for your family before entering real financial data. A persistent disk requires a paid Render web-service plan; check Render's current pricing before creating it. Do not remove the disk or change `DATA_FILE` to an ephemeral path.

1. Push this repository, including `render.yaml`, to GitHub. In Render, choose **New → Blueprint**, connect the repository, and approve the service and disk in the blueprint. The first deployment can start without OAuth or storage configured; it will show the setup screen.
2. Copy the deployed `https://<service>.onrender.com` URL. In Google Cloud Console, add `https://<service>.onrender.com/auth/google/callback` as an authorized redirect URI for the OAuth web client.
3. In the Render service's **Environment** settings, add `APP_ORIGIN` (the service URL), `GOOGLE_REDIRECT_URI` (the exact callback above), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_EMAILS` (four distinct authorized family addresses), optional `FAMILY_MEMBER_NAMES` (display names in the same order), and `DATA_ENCRYPTION_KEY` (64 hex characters). Generate the encryption key locally with the command in the setup section; enter it directly in Render's secret environment settings, never commit it or paste it into a public issue or chat. Save and redeploy.

If configuring a Web Service manually instead of using the Blueprint, set its root directory to this repository's root, start command to `npm start`, and `HOST` environment variable to `0.0.0.0`. Render provides `PORT`; do not bind the server to `127.0.0.1`.

Render provides HTTPS and the public site URL, but the investment API remains restricted to the four Google-verified allowlisted accounts. The blueprint runs one instance because both file storage and login sessions are process-local. A Render deployment starts with an empty data file: local records are not automatically copied or uploaded.

## Excel and CSV imports

The Import & export screen generates a styled, sheet-protected `.xlsx` template with `Read me` and `Field guide` tabs plus separate equity, debt and other-investment tabs (including stocks, mutual funds, ETFs, deposits, bonds, PPF/EPF, NPS, real estate, jewellery, crypto and insurance). The template uses one `Investor name` column and displays family member names—not email addresses—in its dropdowns; imports map those names to the authorized Google accounts. Dropdowns are also provided for common product fields. On fixed-income and insurance entries, enter tenor to calculate maturity from the purchase/start date; the calculated date is locked. Fixed-deposit maturity amount is also calculated and locked from the principal, rate, deposit type, interest frequency and maturity date. This is an estimate based on simple or periodic compounding and may differ from actual bank terms. If no tenor is entered, use the separate entered-maturity-date cell. Worksheet protection prevents accidental formula edits; it is not a security feature. The importer recalculates maturity dates and fixed-deposit amounts server-side rather than trusting workbook formulas. The template includes an `AMFI scheme code` field for mutual funds, an ISIN for bonds, and IFSC, bank name and branch address fields; IFSC lookups in the app form and in bulk imports populate missing bank/branch details automatically.

Excel workbook input is limited to 2 MB; CSV input remains supported up to 1 MB. Up to 500 holdings or 1,000 transactions can be imported in one request. Equity and debt mutual-fund rows require both `Scheme name *` and `AMFI scheme code *`; choose a scheme from the AMFI search or enter its official numeric code. Existing mutual-fund holdings without a code must be updated with one before they can be edited. A holdings row without an `id` is treated as a separate opening position and creates one BUY transaction, even if its description matches another holding. Supplied `Record ID`, `Reference no`, or `Policy number` values are used to detect repeated records for the same owner, product type and institution; rows without these values remain distinct. The new workbook stores non-core template fields as encrypted per-holding import details; these fields are included in holdings CSV exports as a JSON column so they can be retained during data transfer. The template is blank and does not include records from any uploaded workbook. For a full data transfer, import the exported holdings CSV (which preserves holding IDs but does not create opening buys), then import the exported transaction CSV. Re-imports with the same holding ID or reference number are skipped; duplicate transaction events are rejected. Keep exported files private.

The app's IFSC lookup uses the public Razorpay IFSC directory from the server and needs outbound internet access. Bulk imports look up at most 20 distinct IFSC codes per import; unavailable lookups are reported while the entered code is retained. The lookup does not connect to a bank account or verify an investment.

Legacy/CSV holdings columns: `id, ownerEmail, productType, name, symbol, broker, purchaseDate, quantity, purchasePrice, currentPrice, priceSource, priceUpdatedAt, maturityDate, tenorYears, tenorMonths, tenorDays, interestRate, nextInterestDate, frequency, bankIfsc, bankName, bankAddress`.

Transaction columns: `holdingId, type, date, quantity, price, amount, notes`. Use `BUY`, `SELL`, `DIVIDEND` or `BONUS`. For dividends/interest, provide `amount`; for other types, provide quantity and price (bonus price is zero). A transaction import must refer to an existing holding ID.

## Data, calculation and deployment notes

- The only persistent household record is an authenticated-encrypted file (`DATA_FILE`, default `data/family-investments.enc` in the local project; `/var/data/family-investments.enc` on Render). It is written atomically. Back up the encrypted file and its encryption key separately. Backups cannot be decrypted without the key. Render preserves this file on the attached persistent disk; without that disk, restarts or redeploys can erase it.
- Use a private HTTPS deployment, a protected host and a managed secret store. The app currently uses one Node process and in-memory sessions; multi-instance deployments need shared session management and coordinated storage before scaling horizontally.
- Do not enter passwords, PINs, PAN or Aadhaar. Optional account, policy and wallet identifiers imported from the workbook are encrypted at rest but visible to all authorized household members; leave them blank unless needed.
- ROI is calculated from recorded transactions and entered prices. Open-position return uses remaining FIFO cost basis; realized sales and recorded dividends/interest are included separately. Unpriced holdings are excluded from the current portfolio value.
- Holding-period badges are indicative age buckets, not tax determinations. Tax treatment depends on the security, acquisition date, investor and current Indian tax law; consult a qualified tax professional.
- Projections assume constant monthly compounding and month-end contributions. They exclude taxes, fees, inflation and volatility and are not forecasts or investment advice.
- This is a household recordkeeping dashboard; it does not place orders or independently reconcile broker statements.

Run the unit checks with:

```powershell
npm.cmd test
```
