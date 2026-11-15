import { updateHoldingPrice } from "./investment-domain.mjs";

const MUTUAL_FUND_TYPES = new Set(["Equity mutual fund", "Debt mutual fund"]);
const ADAPTER_TYPES = new Set(["Listed equity", ...MUTUAL_FUND_TYPES, "Bond / NCD"]);

function normalizedIdentifier(value) {
  return String(value || "").trim().toUpperCase();
}

function validQuote(value) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 && price <= 10_000_000;
}

function sourceError(error) {
  return error instanceof Error ? error.message : "Price source returned an unknown error.";
}

function unique(values) {
  return [...new Set(values)];
}

export async function refreshMarketPrices(data, {
  nseMarketData,
  amfiMarketData,
  marketDataUrl = "",
  marketDataToken = "",
  fetchImpl = globalThis.fetch
}) {
  const holdings = data.holdings;
  const updatedIds = new Set();
  const sources = new Set();
  const failures = [];

  const eligibleHoldings = holdings.filter((holding) =>
    ADAPTER_TYPES.has(holding.productType) && normalizedIdentifier(holding.symbol)
  );
  if (marketDataUrl && eligibleHoldings.length) {
    try {
      const endpoint = new URL(marketDataUrl);
      if (endpoint.protocol !== "https:" &&
          !["localhost", "127.0.0.1"].includes(endpoint.hostname)) {
        throw new Error("The configured market-data adapter must use HTTPS.");
      }
      const headers = { "content-type": "application/json" };
      if (marketDataToken) headers.authorization = `Bearer ${marketDataToken}`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          symbols: unique(eligibleHoldings.map((holding) => normalizedIdentifier(holding.symbol)))
        }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`Market-data adapter returned HTTP ${response.status}.`);
      const payload = await response.json();
      if (!Array.isArray(payload.prices)) {
        throw new Error("Market-data adapter must return a prices array.");
      }
      const requested = new Set(eligibleHoldings.map((holding) => normalizedIdentifier(holding.symbol)));
      const prices = new Map();
      for (const item of payload.prices) {
        const symbol = normalizedIdentifier(item.symbol);
        if (requested.has(symbol) && validQuote(item.price)) {
          prices.set(symbol, {
            price: Number(item.price),
            asOf: item.asOf && Number.isFinite(Date.parse(item.asOf))
              ? item.asOf
              : new Date().toISOString()
          });
        }
      }
      for (const holding of eligibleHoldings) {
        const quote = prices.get(normalizedIdentifier(holding.symbol));
        if (!quote) continue;
        updateHoldingPrice(data, holding.id, quote.price, "market-data adapter", quote.asOf);
        updatedIds.add(holding.id);
      }
      if (updatedIds.size) sources.add("market-data adapter");
    } catch (error) {
      failures.push(`Market-data adapter: ${sourceError(error)}`);
    }
  }

  const equities = holdings.filter((holding) => holding.productType === "Listed equity");
  const identifiedEquities = equities.filter((holding) => normalizedIdentifier(holding.symbol));
  if (!marketDataUrl && identifiedEquities.length) {
    try {
      const snapshot = await nseMarketData.latestBhavcopy();
      const prices = new Map(snapshot.prices.map((quote) => [normalizedIdentifier(quote.symbol), quote]));
      for (const holding of identifiedEquities) {
        const quote = prices.get(normalizedIdentifier(holding.symbol));
        if (!quote) continue;
        updateHoldingPrice(data, holding.id, quote.price, "NSE bhavcopy", quote.asOf || snapshot.asOf);
        updatedIds.add(holding.id);
      }
      if (identifiedEquities.some((holding) => updatedIds.has(holding.id))) sources.add("NSE bhavcopy");
    } catch (error) {
      failures.push(`NSE bhavcopy: ${sourceError(error)}`);
    }
  }

  const mutualFunds = holdings.filter((holding) => MUTUAL_FUND_TYPES.has(holding.productType));
  const identifiedFunds = mutualFunds.filter((holding) =>
    !updatedIds.has(holding.id) && /^\d{1,10}$/.test(normalizedIdentifier(holding.symbol))
  );
  if (identifiedFunds.length) {
    try {
      const navs = await amfiMarketData.latestNavs(identifiedFunds.map((holding) => holding.symbol));
      for (const holding of identifiedFunds) {
        const nav = navs.get(normalizedIdentifier(holding.symbol));
        if (!nav) continue;
        updateHoldingPrice(data, holding.id, nav.nav, "AMFI NAV", nav.asOf);
        updatedIds.add(holding.id);
      }
      if (identifiedFunds.some((holding) => updatedIds.has(holding.id))) sources.add("AMFI NAV");
    } catch (error) {
      failures.push(`AMFI NAV: ${sourceError(error)}`);
    }
  }

  const bonds = holdings.filter((holding) => holding.productType === "Bond / NCD");
  const missingBonds = bonds.filter((holding) => !updatedIds.has(holding.id));
  const bondNote = missingBonds.length && !marketDataUrl
    ? `${missingBonds.length} bond/NCD price(s) need a configured market-data adapter keyed by ISIN; otherwise enter prices manually.`
    : missingBonds.length
      ? `${missingBonds.length} bond/NCD price(s) were not returned by the configured adapter; check their ISIN identifiers.`
      : "";
  const missingSymbols = unique(equities
    .filter((holding) => !updatedIds.has(holding.id))
    .map((holding) => normalizedIdentifier(holding.symbol) || holding.name));
  const missingSchemeCodes = unique(mutualFunds
    .filter((holding) => !updatedIds.has(holding.id))
    .map((holding) => normalizedIdentifier(holding.symbol) || holding.name));
  const message = holdings.some((holding) => ADAPTER_TYPES.has(holding.productType))
    ? null
    : "Add a supported equity, mutual-fund, or bond holding before refreshing prices.";

  return {
    updated: updatedIds.size,
    source: [...sources].join(" + "),
    failures,
    missingSymbols,
    missingSchemeCodes,
    bondNote,
    message
  };
}
