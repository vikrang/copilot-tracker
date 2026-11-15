const NAV_LIST_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const NAV_CACHE_MS = 15 * 60 * 1000;
const MAX_NAV_BYTES = 15 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = new Map([
  ["JAN", "01"], ["FEB", "02"], ["MAR", "03"], ["APR", "04"],
  ["MAY", "05"], ["JUN", "06"], ["JUL", "07"], ["AUG", "08"],
  ["SEP", "09"], ["OCT", "10"], ["NOV", "11"], ["DEC", "12"]
]);

function serviceError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

function parseAmfiDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const [, dayText, monthText, year] = match;
  const month = MONTHS.get(monthText.toUpperCase());
  if (!month) return null;
  const day = Number(dayText);
  const iso = `${year}-${month}-${String(day).padStart(2, "0")}`;
  const timestamp = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso ? iso : null;
}

export function parseAmfiNavList(text) {
  const schemes = new Map();
  for (const line of String(text).replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const fields = line.split(";").map((field) => field.trim());
    if (fields.length < 8) continue;
    const [schemeCode, , , schemeName, plan, option, navText, dateText] = fields;
    if (!/^\d{1,10}$/.test(schemeCode) || !schemeName || !plan || !option) continue;
    const normalizedNav = navText.replace(/,/g, "");
    if (!/^\d+(?:\.\d+)?$/.test(normalizedNav)) continue;
    const nav = Number(normalizedNav);
    const asOf = parseAmfiDate(dateText);
    if (!Number.isFinite(nav) || nav < 0 || nav > 10_000_000 || !asOf) continue;
    const existing = schemes.get(schemeCode);
    if (!existing || asOf > existing.asOf) {
      schemes.set(schemeCode, { schemeCode, schemeName, plan, option, nav, asOf });
    }
  }
  if (!schemes.size) throw serviceError("AMFI NAV list contained no valid mutual-fund schemes.");
  return [...schemes.values()];
}

export class AmfiMarketData {
  constructor({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.schemes = null;
    this.fetchedAt = 0;
  }

  async loadSchemes() {
    if (this.schemes && this.now().getTime() - this.fetchedAt < NAV_CACHE_MS) return this.schemes;
    let response;
    try {
      response = await this.fetchImpl(NAV_LIST_URL, {
        headers: { accept: "text/plain,*/*", "user-agent": "HouseholdInvestmentTracker/1.0" },
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw serviceError(`Could not download AMFI NAV data: ${error.message}`);
    }
    if (!response.ok) throw serviceError(`AMFI NAV download returned HTTP ${response.status}.`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_NAV_BYTES) {
      throw serviceError("AMFI NAV data exceeded the allowed download size.");
    }
    const schemes = parseAmfiNavList(text);
    this.schemes = schemes;
    this.fetchedAt = this.now().getTime();
    return schemes;
  }

  async searchSchemes(query, limit = 20) {
    const search = String(query || "").trim().toUpperCase();
    if (search.length < 3) return [];
    const schemes = await this.loadSchemes();
    return schemes
      .filter(({ schemeCode, schemeName, plan, option }) =>
        schemeCode.includes(search) ||
        `${schemeName} ${plan} ${option}`.toUpperCase().includes(search)
      )
      .sort((a, b) => {
        const rank = ({ schemeCode, schemeName }) =>
          schemeCode.startsWith(search) ? 0 : schemeName.toUpperCase().startsWith(search) ? 1 : 2;
        return rank(a) - rank(b) || a.schemeName.localeCompare(b.schemeName) || a.schemeCode.localeCompare(b.schemeCode);
      })
      .slice(0, Math.max(1, Math.min(50, limit)));
  }

  async latestNavs(schemeCodes) {
    const requested = new Set(
      schemeCodes.map((code) => String(code || "").trim()).filter((code) => /^\d{1,10}$/.test(code))
    );
    if (!requested.size) return new Map();
    return new Map((await this.loadSchemes())
      .filter(({ schemeCode }) => requested.has(schemeCode))
      .map((scheme) => [scheme.schemeCode, scheme]));
  }
}
