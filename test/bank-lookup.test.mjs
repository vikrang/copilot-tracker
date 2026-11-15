import test from "node:test";
import assert from "node:assert/strict";
import { enrichBankDetails, lookupBankByIfsc } from "../src/bank-lookup.mjs";

test("IFSC lookup validates the code and returns only bank name and address", async () => {
  let calledUrl;
  const details = await lookupBankByIfsc(" hdfc0001234 ", async (url, options) => {
    calledUrl = url;
    assert.equal(options.headers.accept, "application/json");
    assert.ok(options.signal);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        BANK: "Example Bank",
        ADDRESS: "Example branch address",
        CONTACT: "private and unused field"
      })
    };
  });
  assert.equal(calledUrl, "https://ifsc.razorpay.com/HDFC0001234");
  assert.deepEqual(details, {
    ifsc: "HDFC0001234",
    bankName: "Example Bank",
    bankAddress: "Example branch address"
  });
});

test("IFSC lookup rejects malformed codes before contacting the provider", async () => {
  let called = false;
  await assert.rejects(() => lookupBankByIfsc("BAD", async () => { called = true; }), {
    status: 400,
    message: /11-character/
  });
  assert.equal(called, false);
});

test("IFSC lookup reports missing and unavailable provider results", async () => {
  await assert.rejects(() => lookupBankByIfsc("HDFC0001234", async () => ({
    ok: false,
    status: 404
  })), { status: 404, message: /No bank branch/ });

  await assert.rejects(() => lookupBankByIfsc("HDFC0001234", async () => {
    throw new Error("provider details");
  }), { status: 502, message: /temporarily unavailable/ });
});

test("bulk imports resolve each distinct IFSC once and refresh existing details", async () => {
  let lookups = 0;
  const result = await enrichBankDetails([
    { bankIfsc: "hdfc0001234" },
    { bankIfsc: "HDFC0001234", bankName: "User-supplied bank name" }
  ], async (ifsc) => {
    lookups += 1;
    assert.equal(ifsc, "HDFC0001234");
    return { bankName: "Example Bank", bankAddress: "Example branch address" };
  });

  assert.equal(lookups, 1);
  assert.deepEqual(result.lookup, { matched: 1, failed: 0, skipped: 0 });
  assert.equal(result.rows[0].bankName, "Example Bank");
  assert.equal(result.rows[1].bankName, "Example Bank");
  assert.equal(result.rows[1].bankAddress, "Example branch address");
});

test("bulk import lookup failures are reported without discarding the IFSC", async () => {
  const result = await enrichBankDetails([{ bankIfsc: "HDFC0001234" }], async () => {
    throw new Error("offline");
  });
  assert.deepEqual(result.lookup, { matched: 0, failed: 1, skipped: 0 });
  assert.equal(result.rows[0].bankIfsc, "HDFC0001234");
  assert.equal(result.rows[0].bankName, "");
});

test("bulk import caps external IFSC lookups at 20 distinct codes", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    bankIfsc: `TEST0${String(index).padStart(6, "0")}`
  }));
  let lookups = 0;
  const result = await enrichBankDetails(rows, async () => {
    lookups += 1;
    return { bankName: "Example Bank", bankAddress: "Example branch address" };
  });
  assert.equal(lookups, 20);
  assert.deepEqual(result.lookup, { matched: 20, failed: 0, skipped: 1 });
});
