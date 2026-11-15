import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addHolding,
  addImportedHoldings,
  addTransaction,
  buildDashboard,
  calculateMaturityAmount,
  calculateMaturityDate,
  createEmptyData,
  exportRows,
  updateHolding
} from "../src/investment-domain.mjs";
import { createEncryptionKey, EncryptedStore } from "../src/encrypted-store.mjs";

const members = ["family.one@example.com", "family.two@example.com"];

function openingHolding(overrides = {}) {
  return {
    ownerEmail: members[0],
    productType: "Listed equity",
    name: "Example Industries",
    symbol: "EXAMPLE",
    broker: "Broker One",
    purchaseDate: "2025-01-01",
    quantity: 10,
    purchasePrice: 100,
    currentPrice: 110,
    ...overrides
  };
}

test("household ledger calculates FIFO realized and unrealized return with income", () => {
  const data = createEmptyData(members);
  const holding = addHolding(data, openingHolding(), members);
  addTransaction(data, {
    holdingId: holding.id, type: "SELL", date: "2025-02-01", quantity: 4, price: 120
  }, members);
  addTransaction(data, {
    holdingId: holding.id, type: "DIVIDEND", date: "2025-03-01", amount: 12
  }, members);

  const dashboard = buildDashboard(data, new Date("2025-04-01T00:00:00Z"));
  assert.equal(dashboard.holdings[0].units, 6);
  assert.equal(dashboard.holdings[0].costBasis, 600);
  assert.equal(dashboard.holdings[0].currentValue, 660);
  assert.equal(dashboard.holdings[0].realized, 80);
  assert.equal(dashboard.holdings[0].unrealized, 60);
  assert.equal(dashboard.summary.realizedPct, 20);
  assert.equal(dashboard.summary.dividends, 12);
  assert.equal(dashboard.summary.netReturn, 152);
});

test("holdings with matching descriptions remain separate and invalid sales do not mutate the ledger", () => {
  const data = createEmptyData(members);
  const holding = addHolding(data, openingHolding(), members);
  const second = addHolding(data, openingHolding(), members);
  assert.notEqual(holding.id, second.id);
  assert.equal(data.holdings.length, 2);
  assert.throws(() => addTransaction(data, {
    holdingId: holding.id, type: "SELL", date: "2025-02-01", quantity: 11, price: 120
  }, members), /cannot exceed/);
  assert.equal(data.transactions.length, 2);
});

test("reference numbers identify duplicates without conflating same-name investments", () => {
  const data = createEmptyData(members);
  const deposit = openingHolding({
    productType: "Fixed deposit",
    name: "Term deposit",
    symbol: "",
    broker: "Example Bank"
  });
  const first = addHolding(data, { ...deposit, referenceNo: "FD-100" }, members);
  const second = addHolding(data, { ...deposit, referenceNo: "FD-101" }, members);
  assert.equal(first.importDetails["Reference no"], "FD-100");
  assert.equal(data.holdings.length, 2);
  assert.throws(() => addHolding(data, { ...deposit, referenceNo: " fd-100 " }, members), /reference number/);

  assert.deepEqual(addImportedHoldings(data, [{
    ...deposit,
    importDetails: { "Reference no": "FD-100" }
  }], members), { added: 0, duplicates: 1 });
  assert.deepEqual(addImportedHoldings(data, [{
    ...deposit,
    importDetails: { "Reference no": "FD-102" }
  }], members), { added: 1, duplicates: 0 });
  assert.equal(data.holdings.length, 3);
  assert.equal(second.name, first.name);
});

test("bonus units, holding terms, debt reminders, and projections are included", () => {
  const data = createEmptyData(members);
  const holding = addHolding(data, openingHolding({
    productType: "Bond / NCD",
    name: "Example bond",
    symbol: "",
    maturityDate: "2025-04-20",
    nextInterestDate: "2025-04-10",
    interestRate: 7.25,
    frequency: "Annual"
  }), members);
  addTransaction(data, { holdingId: holding.id, type: "BONUS", date: "2021-01-01", quantity: 2 }, members);
  const dashboard = buildDashboard(data, new Date("2025-04-01T00:00:00Z"));
  assert.equal(dashboard.holdings[0].units, 12);
  assert.equal(dashboard.holdings[0].longTermUnits, 2);
  assert.equal(dashboard.holdings[0].shortTermUnits, 10);
  assert.equal(dashboard.reminders.length, 2);
  assert.equal(dashboard.projections.length, 4);
  assert.ok(dashboard.projections[3].value > dashboard.summary.totalValue);
});

test("maturity tenor clamps month ends and overrides a directly entered date", () => {
  assert.equal(calculateMaturityDate("2024-01-31", 0, 1, 0), "2024-02-29");
  assert.equal(calculateMaturityDate("2025-01-31", 0, 1, 0), "2025-02-28");
  assert.equal(calculateMaturityDate("2024-12-31", 1, 2, 1), "2026-03-01");

  const data = createEmptyData(members);
  const calculated = addHolding(data, openingHolding({
    purchaseDate: "2024-01-31",
    productType: "Fixed deposit",
    name: "Monthly tenor deposit",
    symbol: "",
    tenorMonths: 1,
    maturityDate: "2030-01-01",
    bankIfsc: "hdfc0001234",
    bankName: "Example Bank",
    bankAddress: "Example branch address"
  }), members);
  assert.equal(calculated.maturityDate, "2024-02-29");
  assert.equal(calculated.tenorMonths, 1);
  assert.equal(calculated.bankIfsc, "HDFC0001234");
  assert.equal(calculated.bankName, "Example Bank");
  assert.equal(exportRows(data).holdings[0].purchaseDate, "2024-01-31");

  const updated = updateHolding(data, calculated.id, {
    tenorMonths: "",
    maturityDate: "2030-01-01"
  }, members);
  assert.equal(updated.maturityDate, "2030-01-01");
  assert.equal(updated.tenorMonths, null);

  const manual = addHolding(data, openingHolding({
    productType: "PPF / EPF",
    name: "Manual maturity account",
    symbol: "",
    maturityDate: "2035-04-15"
  }), members);
  assert.equal(manual.maturityDate, "2035-04-15");
  assert.equal(manual.tenorYears, null);
});

test("fixed deposit maturity amount handles fixed, simple-interest, and compounding terms", () => {
  assert.equal(calculateMaturityAmount(10000, 6, "2025-01-31", "2026-01-31", "Fixed", "Annual"), 10000);
  assert.equal(calculateMaturityAmount(10000, 6, "2025-01-31", "2026-01-31", "Cumulative", "Simple"), 10600);
  assert.ok(calculateMaturityAmount(10000, 6, "2025-01-31", "2026-01-31", "Cumulative", "Quarterly") > 10600);
  assert.equal(calculateMaturityAmount(10000, 6, "2024-02-28", "2025-02-28", "Cumulative", "Simple"), 10600);
  assert.throws(() => calculateMaturityAmount(10000, 6, "2025-01-31", "2026-01-31", "Other", "Annual"), /Deposit type/);
  assert.throws(() => calculateMaturityAmount(10000, 6, "2025-01-31", "2026-01-31", "Cumulative", "At maturity"), /frequency/);
});

test("tenor and IFSC inputs are validated before saving a holding", () => {
  const data = createEmptyData(members);
  assert.throws(() => addHolding(data, openingHolding({ tenorDays: 1.5 }), members), /whole number/);
  assert.throws(() => addHolding(data, openingHolding({ bankIfsc: "not-an-ifsc" }), members), /IFSC/);
  assert.equal(data.holdings.length, 0);
});

test("holding updates keep transaction history when descriptions match other holdings", () => {
  const data = createEmptyData(members);
  const first = addHolding(data, openingHolding(), members);
  const second = addHolding(data, openingHolding({
    ownerEmail: members[1],
    productType: "Gold",
    name: "Gold holding",
    symbol: ""
  }), members);
  updateHolding(data, second.id, {
    ownerEmail: members[1],
    productType: "Bond / NCD",
    name: "New bond",
    symbol: "",
    broker: "Broker Two"
  }, members);
  assert.equal(data.holdings[1].ownerEmail, members[1]);
  assert.equal(data.transactions.length, 2);
  const updated = updateHolding(data, second.id, {
    ownerEmail: first.ownerEmail,
    productType: first.productType,
    name: first.name,
    symbol: first.symbol,
    broker: first.broker
  }, members);
  assert.equal(updated.name, first.name);
  assert.equal(data.holdings.length, 2);
  assert.equal(data.transactions.length, 2);
});

test("CSV import preserves distinct matching holdings and skips the same exported record ID", () => {
  const data = createEmptyData(members);
  const row = openingHolding();
  const first = addImportedHoldings(data, [row], members);
  const second = addImportedHoldings(data, [row], members);
  assert.deepEqual(first, { added: 1, duplicates: 0 });
  assert.deepEqual(second, { added: 1, duplicates: 0 });
  assert.equal(data.holdings.length, 2);
  const exported = exportRows(data).holdings[0];
  assert.deepEqual(addImportedHoldings(data, [exported], members), { added: 0, duplicates: 1 });
  assert.equal(data.holdings.length, 2);
});

test("imported detail fields are retained and included in holdings exports", () => {
  const data = createEmptyData(members);
  const row = {
    ...openingHolding(),
    importDetails: { "Policy number": "POLICY-123", "Record ID": "source-7" }
  };
  addImportedHoldings(data, [row], members);
  assert.deepEqual({ ...data.holdings[0].importDetails }, row.importDetails);
  assert.deepEqual({ ...exportRows(data).holdings[0].importDetails }, row.importDetails);
  assert.throws(() => addImportedHoldings(createEmptyData(members), [{
    ...openingHolding(),
    importDetails: { privateField: { nested: true } }
  }], members), /must be text, a number, or yes\/no/);
});

test("holdings and transaction CSV exports restore the full FIFO ledger", () => {
  const original = createEmptyData(members);
  const holding = addHolding(original, openingHolding(), members);
  addTransaction(original, {
    holdingId: holding.id, type: "SELL", date: "2025-02-01", quantity: 4, price: 120
  }, members);
  addTransaction(original, {
    holdingId: holding.id, type: "BONUS", date: "2025-02-02", quantity: 1
  }, members);

  const rows = exportRows(original);
  const restored = createEmptyData(members);
  addImportedHoldings(restored, rows.holdings, members);
  for (const transaction of rows.transactions) addTransaction(restored, transaction, members);
  assert.deepEqual(buildDashboard(restored).summary, buildDashboard(original).summary);
  assert.equal(restored.holdings[0].id, holding.id);
});

test("encrypted store persists authenticated ciphertext and rejects tampering", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "investment-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "family.enc");
  const key = createEncryptionKey();
  const store = new EncryptedStore(file, key, members);
  await store.mutate((data) => addHolding(data, openingHolding(), members));
  const encrypted = await readFile(file, "utf8");
  assert.ok(!encrypted.includes("Example Industries"));
  assert.equal((await store.read()).holdings[0].name, "Example Industries");

  await store.mutate((data) => { data.settings.monthlyContribution = 5000; });
  assert.equal((await store.read()).settings.monthlyContribution, 5000);
  const envelope = JSON.parse(encrypted);
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString("base64");
  await writeFile(file, JSON.stringify(envelope), "utf8");
  await assert.rejects(() => store.read());
});
