import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { addImportedHoldings, createEmptyData } from "../src/investment-domain.mjs";
import { buildHoldingsTemplate, parseHoldingsWorkbook } from "../src/investment-workbook.mjs";

const members = [
  "family.one@example.com",
  "family.two@example.com",
  "family.three@example.com",
  "family.four@example.com"
];
const memberNames = ["Vikram", "Sowmiya", "Jayanthi", "Sudhira"];

function columnFor(sheet, header) {
  let column = 0;
  sheet.getRow(1).eachCell((cell, index) => {
    if (cell.value === header) column = index;
  });
  assert.ok(column, `Expected column "${header}"`);
  return column;
}

function set(sheet, row, header, value) {
  sheet.getCell(row, columnFor(sheet, header)).value = value;
}

function fillRequiredDeposit(sheet, row, name) {
  set(sheet, row, "Investor name *", memberNames[0]);
  set(sheet, row, "Company name *", name);
  set(sheet, row, "Type *", "Cumulative");
  set(sheet, row, "Amount deposited (₹) *", 10000);
  set(sheet, row, "Date of purchase *", new Date("2025-01-31T00:00:00.000Z"));
  set(sheet, row, "Interest rate (%) *", 6);
  set(sheet, row, "Interest frequency *", "Quarterly");
  set(sheet, row, "Bank / NBFC *", "HDFC Bank");
}

test("Excel template mirrors the reference structure and style without sample holdings", async () => {
  const buffer = await buildHoldingsTemplate(members, memberNames);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "_lists", "Read me", "Field guide", "Equity - Stocks", "Equity - Mutual Funds",
    "Debt - Mutual Funds", "Equity - ETFs", "Debt - Fixed Deposits",
    "Debt - Recurring Deposits", "Debt - Bonds", "Debt - PPF", "Debt - EPF",
    "Debt - NPS", "Debt - Small Savings", "Other - Real Estate", "Other - Jewellery",
    "Other - Crypto", "Other - Insurance"
  ]);
  assert.equal(workbook.getWorksheet("_lists").state, "veryHidden");
  assert.deepEqual(workbook.getWorksheet("Equity - Stocks").getRow(1).values.slice(1), [
    "Investor name *", "Record ID", "Investment name *", "Symbol / ticker *",
    "Quantity *", "Purchase / start date *", "Average buy price (₹) *",
    "Current price (₹)", "Demat master account"
  ]);

  const stocks = workbook.getWorksheet("Equity - Stocks");
  assert.equal(stocks.getCell("A1").font.name, "Calibri");
  assert.equal(stocks.getCell("A1").font.bold, true);
  assert.equal(stocks.getCell("A1").font.color.argb, "FFFFFFFF");
  assert.equal(stocks.getCell("A1").fill.fgColor.argb, "FF6366F1");
  assert.equal(stocks.getCell("A1").alignment.wrapText, true);
  assert.equal(stocks.views[0].xSplit, 1);
  assert.equal(stocks.autoFilter, "A1:I1");
  assert.equal(stocks.getCell("A2").dataValidation.type, "list");
  assert.deepEqual(stocks.getCell("A2").dataValidation.formulae, ["FamilyMembers"]);
  assert.equal(workbook.getWorksheet("_lists").getCell("A2").value, memberNames[0]);
  assert.equal(workbook.getWorksheet("_lists").getCell("A2").value.includes("@"), false);
  assert.equal(workbook.getWorksheet("Field guide").getCell("A1").value, "Tab");

  const deposits = workbook.getWorksheet("Debt - Fixed Deposits");
  const manualDate = columnFor(deposits, "Maturity date");
  const calculatedDate = columnFor(deposits, "Calculated maturity date");
  const maturityAmount = columnFor(deposits, "Maturity amount (₹)");
  assert.equal(deposits.sheetProtection.sheet, true);
  assert.equal(deposits.getCell(2, manualDate).protection.locked, false);
  assert.notEqual(deposits.getCell(2, calculatedDate).protection?.locked, false);
  assert.match(deposits.getCell(2, calculatedDate).value.formula, /EDATE/);
  assert.notEqual(deposits.getCell(2, maturityAmount).protection?.locked, false);
  assert.match(deposits.getCell(2, maturityAmount).value.formula, /Cumulative/);
  assert.match(deposits.getCell(2, maturityAmount).value.formula, /SUMPRODUCT/);
  assert.equal(deposits.getCell("D2").dataValidation.type, "list");
  assert.equal(deposits.getCell(2, columnFor(deposits, "Interest frequency *")).dataValidation.type, "list");
  assert.equal(deposits.rowCount, 501);
  assert.equal(deposits.getCell("B2").value, null);
  let amountGuideRow;
  workbook.getWorksheet("Field guide").eachRow((row, rowNumber) => {
    if (rowNumber > 1 && row.getCell(2).value === "Maturity amount (₹)") amountGuideRow = row;
  });
  assert.ok(amountGuideRow);
  assert.equal(amountGuideRow.getCell(4).value, "calculated");
});

test("Excel import maps product-specific fields and keeps maturity server-authoritative", async () => {
  const buffer = await buildHoldingsTemplate(members, memberNames);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const deposits = workbook.getWorksheet("Debt - Fixed Deposits");
  fillRequiredDeposit(deposits, 2, "Tenor deposit");
  set(deposits, 2, "Tenor months", 1);
  set(deposits, 2, "Current value (₹)", 10500);
  set(deposits, 2, "Reference no", "TEST-1");

  fillRequiredDeposit(deposits, 3, "Manual deposit");
  set(deposits, 3, "Type *", "Fixed");
  set(deposits, 3, "Maturity date", new Date("2030-04-15T00:00:00.000Z"));

  const funds = workbook.getWorksheet("Equity - Mutual Funds");
  set(funds, 2, "Investor name *", memberNames[1]);
  set(funds, 2, "Investment name *", "Sample fund");
  set(funds, 2, "AMC *", "SBI Mutual Fund");
  set(funds, 2, "Scheme category *", "Large Cap");
  set(funds, 2, "Plan *", "Direct");
  set(funds, 2, "Option *", "Growth");
  set(funds, 2, "Units held *", 12);
  set(funds, 2, "Purchase / start date *", new Date("2024-06-01T00:00:00.000Z"));
  set(funds, 2, "Average NAV (₹) *", 100);
  set(funds, 2, "Current NAV (₹)", 125);

  const rows = await parseHoldingsWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), members, memberNames);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map(({ productType, name, quantity, purchasePrice, currentPrice }) => ({
      productType, name, quantity, purchasePrice, currentPrice
    })),
    [
      { productType: "Equity mutual fund", name: "Sample fund", quantity: 12, purchasePrice: 100, currentPrice: 125 },
      { productType: "Fixed deposit", name: "Tenor deposit", quantity: 1, purchasePrice: 10000, currentPrice: 10500 },
      { productType: "Fixed deposit", name: "Manual deposit", quantity: 1, purchasePrice: 10000, currentPrice: "" }
    ]
  );
  assert.equal(rows[1].ownerEmail, members[0]);
  assert.equal(rows[1].tenorMonths, 1);
  assert.equal(rows[1].maturityDate, "2025-02-28");
  assert.equal(rows[1].broker, "HDFC Bank");
  assert.equal(rows[1].importDetails["Reference no"], "TEST-1");
  assert.ok(rows[1].importDetails["Maturity amount (₹)"] > 10000);
  assert.equal(rows[2].maturityDate, "2030-04-15");
  assert.equal(rows[2].importDetails["Maturity amount (₹)"], 10000);
  assert.equal(rows[0].broker, "SBI Mutual Fund");
  const data = createEmptyData(members);
  addImportedHoldings(data, rows, members);
  assert.equal(data.holdings.find((holding) => holding.name === "Tenor deposit").maturityDate, "2025-02-28");
  assert.equal(data.holdings.find((holding) => holding.name === "Manual deposit").maturityDate, "2030-04-15");
});

test("Excel import rejects formulas in editable cells and incomplete required columns", async () => {
  const buffer = await buildHoldingsTemplate(members, memberNames);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const stocks = workbook.getWorksheet("Equity - Stocks");
  set(stocks, 2, "Investor name *", memberNames[0]);
  set(stocks, 2, "Investment name *", "Formula row");
  set(stocks, 2, "Symbol / ticker *", "TEST");
  set(stocks, 2, "Purchase / start date *", new Date("2025-01-01T00:00:00.000Z"));
  set(stocks, 2, "Average buy price (₹) *", 100);
  set(stocks, 2, "Quantity *", { formula: "2+3" });

  await assert.rejects(
    async () => parseHoldingsWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), members, memberNames),
    /Formulas are not allowed/
  );

  stocks.getCell(2, columnFor(stocks, "Quantity *")).value = 1;
  stocks.getCell(2, columnFor(stocks, "Symbol / ticker *")).value = "";
  await assert.rejects(
    async () => parseHoldingsWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), members, memberNames),
    /Symbol \/ ticker \* is required/
  );
});

test("older generated holdings workbooks remain importable", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Fixed deposits");
  sheet.addRow([
    "Family member email", "Investment type", "Investment name", "Symbol / scheme code",
    "Broker / institution", "Purchase / start date", "Units / quantity", "Purchase price (INR)",
    "Current price (INR)", "Tenor years", "Tenor months", "Tenor days", "Entered maturity date",
    "Maturity date (calculated)", "Interest rate (%)", "Next interest date", "Interest frequency",
    "Bank IFSC", "Bank name", "Bank branch address"
  ]);
  sheet.addRow([
    members[0], "Fixed deposit", "Legacy FD", "", "", new Date("2025-01-01T00:00:00.000Z"),
    1, 1000, 1100, "", "", "", "", "", 6, "", "Annual", "", "", ""
  ]);
  const rows = await parseHoldingsWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), members, memberNames);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productType, "Fixed deposit");
  assert.equal(rows[0].name, "Legacy FD");
  assert.equal(rows[0].currentPrice, 1100);
});
