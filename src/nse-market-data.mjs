const EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const BHAVCOPY_URL = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_";
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const CACHE_MS = 6 * 60 * 60 * 1000;
const BHAVCOPY_CACHE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const NSE_HEADERS = {
  accept: "text/csv,text/plain,*/*",
  referer: "https://www.nseindia.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
};

function serviceError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n") {
      row.push(cell.trim().replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw serviceError("NSE CSV contains an unclosed quoted field.");
  if (cell.length || row.length) {
    row.push(cell.trim().replace(/\r$/, ""));
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function normalizedHeader(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function headerIndex(headers, name) {
  return headers.findIndex((header) => normalizedHeader(header) === normalizedHeader(name));
}

function parseNseDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseNseEquityList(text) {
  const rows = parseCsv(String(text).replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw serviceError("NSE equity list is empty or invalid.");
  const headers = rows[0];
  const symbolColumn = headerIndex(headers, "SYMBOL");
  const nameColumn = headerIndex(headers, "NAME OF COMPANY");
  const seriesColumn = headerIndex(headers, "SERIES");
  if ([symbolColumn, nameColumn, seriesColumn].some((column) => column < 0)) {
    throw serviceError("NSE equity list is missing its expected SYMBOL, NAME OF COMPANY, or SERIES columns.");
  }
  const equities = new Map();
  for (const row of rows.slice(1)) {
    const symbol = String(row[symbolColumn] || "").trim().toUpperCase();
    const name = String(row[nameColumn] || "").trim();
    const series = String(row[seriesColumn] || "").trim().toUpperCase();
    if (series === "EQ" && /^[A-Z0-9&.-]{1,30}$/.test(symbol) && name) {
      equities.set(symbol, { symbol, name });
    }
  }
  if (!equities.size) throw serviceError("NSE equity list contained no EQ-series shares.");
  return [...equities.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function parseNseBhavcopy(text, asOf) {
  const rows = parseCsv(String(text).replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw serviceError("NSE bhavcopy is empty or invalid.");
  const headers = rows[0];
  const symbolColumn = headerIndex(headers, "SYMBOL");
  const seriesColumn = headerIndex(headers, "SERIES");
  const closeColumn = headerIndex(headers, "CLOSE_PRICE");
  if ([symbolColumn, seriesColumn, closeColumn].some((column) => column < 0)) {
    throw serviceError("NSE bhavcopy is missing its expected SYMBOL, SERIES, or CLOSE_PRICE columns.");
  }
  const prices = new Map();
  for (const row of rows.slice(1)) {
    const symbol = String(row[symbolColumn] || "").trim().toUpperCase();
    const series = String(row[seriesColumn] || "").trim().toUpperCase();
    const price = Number(String(row[closeColumn] || "").replace(/,/g, ""));
    if (series === "EQ" && /^[A-Z0-9&.-]{1,30}$/.test(symbol) && Number.isFinite(price) && price >= 0 && price <= 10_000_000) {
      prices.set(symbol, { symbol, price, asOf });
    }
  }
  if (!prices.size) throw serviceError("NSE bhavcopy contained no valid EQ-series closing prices.");
  return [...prices.values()];
}

function indiaDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function dateOffset({ year, month, day }, offset) {
  const date = new Date(Date.UTC(year, month - 1, day) - offset * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function isWeekend({ year, month, day }) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function formatBhavcopyDate({ year, month, day }) {
  return `${String(day).padStart(2, "0")}${String(month).padStart(2, "0")}${year}`;
}

async function fetchCsv(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: NSE_HEADERS,
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    throw serviceError(`Could not download NSE data: ${error.message}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw serviceError(`NSE data download returned HTTP ${response.status}.`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) throw serviceError("NSE CSV exceeded the allowed download size.");
  if (!text.trim()) throw serviceError("NSE returned an empty CSV file.");
  return text;
}

export class NseMarketData {
  constructor({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.equityList = null;
    this.equityListFetchedAt = 0;
    this.bhavcopy = null;
    this.bhavcopyFetchedAt = 0;
  }

  async searchEquities(query, limit = 20) {
    const search = String(query || "").trim().toUpperCase();
    if (search.length < 3) return [];
    if (!this.equityList || this.now().getTime() - this.equityListFetchedAt >= CACHE_MS) {
      const csv = await fetchCsv(this.fetchImpl, EQUITY_LIST_URL);
      if (!csv) throw serviceError("NSE equity list was not found.");
      this.equityList = parseNseEquityList(csv);
      this.equityListFetchedAt = this.now().getTime();
    }
    const matches = this.equityList
      .filter(({ symbol, name }) => symbol.includes(search) || name.toUpperCase().includes(search))
      .sort((a, b) => {
        const rank = ({ symbol, name }) =>
          symbol.startsWith(search) ? 0 : name.toUpperCase().startsWith(search) ? 1 : 2;
        return rank(a) - rank(b) || a.symbol.localeCompare(b.symbol);
      });
    return matches.slice(0, Math.max(1, Math.min(50, limit)));
  }

  async latestBhavcopy() {
    if (this.bhavcopy && this.now().getTime() - this.bhavcopyFetchedAt < BHAVCOPY_CACHE_MS) return this.bhavcopy;
    const today = indiaDate(this.now());
    for (let offset = 0; offset < 16; offset += 1) {
      const date = dateOffset(today, offset);
      if (isWeekend(date)) continue;
      const fileDate = formatBhavcopyDate(date);
      const csv = await fetchCsv(this.fetchImpl, `${BHAVCOPY_URL}${fileDate}.csv`);
      if (!csv) continue;
      const asOf = parseNseDate(date.year, date.month, date.day);
      this.bhavcopy = { asOf, prices: parseNseBhavcopy(csv, asOf) };
      this.bhavcopyFetchedAt = this.now().getTime();
      return this.bhavcopy;
    }
    throw serviceError("No NSE bhavcopy was found for the last 16 calendar days. Try again later.", 503);
  }
}
