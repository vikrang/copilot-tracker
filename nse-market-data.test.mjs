import test from "node:test";
import assert from "node:assert/strict";
import { NseMarketData, parseNseBhavcopy, parseNseEquityList } from "../src/nse-market-data.mjs";

const equityListCsv = [
  "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING",
  '20MICRONS,"20 Microns, Limited",EQ,06-OCT-2008',
  "20MICRONS,20 Microns Limited,BE,06-OCT-2008",
  "ABC,Alpha Beta Company,EQ,01-JAN-2020"
].join("\n");

const bhavcopyCsv = [
  "SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE",
  "20MICRONS, EQ, 13-Nov-2026, 186.95, 185.60, 186.72, 182.26, 184.75, 184.09, 184.85",
  "20MICRONS, BE, 13-Nov-2026, 186.95, 185.60, 186.72, 182.26, 184.75, 999.00, 184.85",
  "ABC, EQ, 13-Nov-2026, 10.00, 10.00, 11.00, 9.00, 10.50, 10.25, 10.25"
].join("\n");

test("NSE equity list parser keeps EQ shares and supports quoted company names", () => {
  assert.deepEqual(parseNseEquityList(equityListCsv), [
    { symbol: "20MICRONS", name: "20 Microns, Limited" },
    { symbol: "ABC", name: "Alpha Beta Company" }
  ]);
});

test("NSE bhavcopy parser returns EQ closing prices only", () => {
  assert.deepEqual(parseNseBhavcopy(bhavcopyCsv, "2026-11-13"), [
    { symbol: "20MICRONS", price: 184.09, asOf: "2026-11-13" },
    { symbol: "ABC", price: 10.25, asOf: "2026-11-13" }
  ]);
});

test("NSE search and latest bhavcopy use official files and cache results", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith("/EQUITY_L.csv")) {
      return { status: 200, ok: true, text: async () => equityListCsv };
    }
    if (String(url).endsWith("16112026.csv")) {
      return { status: 404, ok: false, text: async () => "" };
    }
    if (String(url).endsWith("13112026.csv")) {
      return { status: 200, ok: true, text: async () => bhavcopyCsv };
    }
    throw new Error(`Unexpected NSE URL: ${url}`);
  };
  const marketData = new NseMarketData({
    fetchImpl,
    now: () => new Date("2026-11-16T08:00:00.000Z")
  });

  assert.deepEqual(await marketData.searchEquities("20m"), [
    { symbol: "20MICRONS", name: "20 Microns, Limited" }
  ]);
  assert.deepEqual(await marketData.searchEquities("20"), []);
  const firstSnapshot = await marketData.latestBhavcopy();
  const secondSnapshot = await marketData.latestBhavcopy();
  assert.equal(firstSnapshot.asOf, "2026-11-13");
  assert.equal(firstSnapshot.prices[0].price, 184.09);
  assert.equal(secondSnapshot, firstSnapshot);
  assert.deepEqual(requests.map((url) => url.split("/").pop()), [
    "EQUITY_L.csv", "sec_bhavdata_full_16112026.csv", "sec_bhavdata_full_13112026.csv"
  ]);
});
