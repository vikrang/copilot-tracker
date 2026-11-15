import test from "node:test";
import assert from "node:assert/strict";
import { AmfiMarketData, parseAmfiNavList } from "../src/amfi-market-data.mjs";

const navList = [
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
  "Open Ended Schemes",
  "135762;INF846K01WO1;-;Axis Children's Fund;Direct Plan;Growth Option;31.0814;13-Nov-2026",
  "135765;INF846K01WP8;-;Axis Children's Fund;Direct Plan;IDCW Option;28.6316;13-Nov-2026",
  "135762;INF846K01WO1;-;Axis Children's Fund;Direct Plan;Growth Option;30.9981;12-Nov-2026"
].join("\n");

test("AMFI parser extracts published scheme NAVs and keeps the newest date per code", () => {
  assert.deepEqual(parseAmfiNavList(navList), [
    {
      schemeCode: "135762",
      schemeName: "Axis Children's Fund",
      plan: "Direct Plan",
      option: "Growth Option",
      nav: 31.0814,
      asOf: "2026-11-13"
    },
    {
      schemeCode: "135765",
      schemeName: "Axis Children's Fund",
      plan: "Direct Plan",
      option: "IDCW Option",
      nav: 28.6316,
      asOf: "2026-11-13"
    }
  ]);
});

test("AMFI search and NAV lookup share a short-lived official data cache", async () => {
  const requests = [];
  const marketData = new AmfiMarketData({
    fetchImpl: async (url) => {
      requests.push(String(url));
      return { ok: true, status: 200, text: async () => navList };
    },
    now: () => new Date("2026-11-14T00:00:00.000Z")
  });

  assert.deepEqual(await marketData.searchSchemes("axis children"), [
    {
      schemeCode: "135762",
      schemeName: "Axis Children's Fund",
      plan: "Direct Plan",
      option: "Growth Option",
      nav: 31.0814,
      asOf: "2026-11-13"
    },
    {
      schemeCode: "135765",
      schemeName: "Axis Children's Fund",
      plan: "Direct Plan",
      option: "IDCW Option",
      nav: 28.6316,
      asOf: "2026-11-13"
    }
  ]);
  assert.deepEqual(await marketData.searchSchemes("13"), []);
  assert.equal((await marketData.latestNavs(["135762", "999999"])).get("135762").nav, 31.0814);
  assert.equal(requests.length, 1);
});

test("AMFI parser rejects an empty or malformed NAV file", () => {
  assert.throws(() => parseAmfiNavList("Scheme Code;Scheme Name"), /no valid mutual-fund schemes/);
});
