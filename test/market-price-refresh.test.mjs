import test from "node:test";
import assert from "node:assert/strict";
import { refreshMarketPrices } from "../src/market-price-refresh.mjs";

function holding(id, productType, symbol) {
  return {
    id,
    name: id,
    productType,
    symbol,
    currentPrice: null,
    priceSource: null,
    priceUpdatedAt: null
  };
}

test("refresh combines NSE equity closes and AMFI NAVs and explains unpriced bonds", async () => {
  const data = {
    holdings: [
      holding("stock", "Listed equity", "HDFCBANK"),
      holding("stock-without-symbol", "Listed equity", null),
      holding("fund", "Equity mutual fund", "135762"),
      holding("fund-without-code", "Debt mutual fund", null),
      holding("bond", "Bond / NCD", "INE123A01011")
    ]
  };
  const result = await refreshMarketPrices(data, {
    nseMarketData: {
      latestBhavcopy: async () => ({
        asOf: "2026-11-13",
        prices: [{ symbol: "HDFCBANK", price: 1800, asOf: "2026-11-13" }]
      })
    },
    amfiMarketData: {
      latestNavs: async () => new Map([
        ["135762", { nav: 31.0814, asOf: "2026-11-13" }]
      ])
    }
  });

  assert.equal(result.updated, 2);
  assert.equal(result.source, "NSE bhavcopy + AMFI NAV");
  assert.equal(data.holdings[0].currentPrice, 1800);
  assert.equal(data.holdings[0].priceSource, "NSE bhavcopy");
  assert.equal(data.holdings[2].currentPrice, 31.0814);
  assert.equal(data.holdings[2].priceSource, "AMFI NAV");
  assert.deepEqual(result.missingSchemeCodes, ["fund-without-code"]);
  assert.deepEqual(result.missingSymbols, ["stock-without-symbol"]);
  assert.match(result.bondNote, /configured market-data adapter keyed by ISIN/);
});

test("configured adapter can update bond prices by ISIN", async () => {
  const data = { holdings: [holding("bond", "Bond / NCD", "INE123A01011")] };
  let request;
  const result = await refreshMarketPrices(data, {
    marketDataUrl: "https://quotes.example.test/prices",
    fetchImpl: async (url, options) => {
      request = { url: String(url), body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          prices: [{ symbol: "INE123A01011", price: 1025.5, asOf: "2026-11-13T10:00:00Z" }]
        })
      };
    }
  });

  assert.equal(request.url, "https://quotes.example.test/prices");
  assert.deepEqual(request.body.symbols, ["INE123A01011"]);
  assert.deepEqual(Object.keys(request.body), ["symbols"]);
  assert.equal(result.updated, 1);
  assert.equal(result.source, "market-data adapter");
  assert.equal(result.bondNote, "");
  assert.equal(data.holdings[0].currentPrice, 1025.5);
  assert.equal(data.holdings[0].priceSource, "market-data adapter");
});

test("refresh reports a failed NAV source without discarding successful equity updates", async () => {
  const data = {
    holdings: [
      holding("stock", "Listed equity", "HDFCBANK"),
      holding("fund", "Debt mutual fund", "135762")
    ]
  };
  const result = await refreshMarketPrices(data, {
    nseMarketData: {
      latestBhavcopy: async () => ({
        asOf: "2026-11-13",
        prices: [{ symbol: "HDFCBANK", price: 1800, asOf: "2026-11-13" }]
      })
    },
    amfiMarketData: {
      latestNavs: async () => { throw new Error("AMFI returned HTTP 503."); }
    }
  });

  assert.equal(result.updated, 1);
  assert.equal(data.holdings[0].currentPrice, 1800);
  assert.equal(data.holdings[1].currentPrice, null);
  assert.deepEqual(result.failures, ["AMFI NAV: AMFI returned HTTP 503."]);
});
