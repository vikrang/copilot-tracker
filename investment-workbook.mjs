import ExcelJS from "exceljs";
import { calculateMaturityAmount, calculateMaturityDate } from "./investment-domain.mjs";
import {
  IMPORT_LISTS,
  IMPORT_SHEETS,
  LEGACY_IMPORT_SHEETS,
  resolveImportSchemaValue
} from "./investment-template-schema.mjs";

const TEMPLATE_ROWS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const GUIDE_SHEETS = new Set(["Read me", "Field guide"]);
const WORKSHEET_PASSWORD = "holdings-template";

const COLUMNS = [
  ["ownerEmail", "Family member email", 32],
  ["productType", "Investment type", 24],
  ["name", "Investment name", 30],
  ["symbol", "Symbol / scheme code", 20],
  ["broker", "Broker / institution", 24],
  ["purchaseDate", "Purchase / start date", 20],
  ["quantity", "Units / quantity", 18],
  ["purchasePrice", "Purchase price (INR)", 20],
  ["currentPrice", "Current price (INR)", 20],
  ["tenorYears", "Tenor years", 14],
  ["tenorMonths", "Tenor months", 14],
  ["tenorDays", "Tenor days", 14],
  ["manualMaturityDate", "Entered maturity date", 22],
  ["calculatedMaturityDate", "Maturity date (calculated)", 26],
  ["interestRate", "Interest rate (%)", 18],
  ["nextInterestDate", "Next interest date", 20],
  ["frequency", "Interest frequency", 20],
  ["bankIfsc", "Bank IFSC", 16],
  ["bankName", "Bank name", 28],
  ["bankAddress", "Bank branch address", 42]
];

const HEADER_KEYS = new Map();
for (const [key, title] of COLUMNS) {
  HEADER_KEYS.set(normalizeHeader(title), key);
  HEADER_KEYS.set(normalizeHeader(key), key);
}
HEADER_KEYS.set("maturitydate", "manualMaturityDate");

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function defaultMemberName(email) {
  const localPart = String(email).split("@")[0] || "";
  return localPart.replace(/[._-]+/g, " ").trim().replace(/(^|[\s'-])([a-z])/g, (_, separator, letter) =>
    `${separator}${letter.toUpperCase()}`
  );
}

function resolveMemberNames(allowedEmails, configuredNames = []) {
  if (!Array.isArray(allowedEmails) || allowedEmails.length === 0) {
    throw invalid("Configure the authorized family emails before generating or importing the workbook.");
  }
  const names = configuredNames.length ? configuredNames : allowedEmails.map(defaultMemberName);
  if (names.length !== allowedEmails.length || names.some((name) => typeof name !== "string" || !name.trim())) {
    throw invalid("FAMILY_MEMBER_NAMES must contain one name per authorized family email, in the same order.");
  }
  const normalized = names.map((name) => name.trim());
  if (new Set(normalized.map((name) => name.toLowerCase())).size !== normalized.length) {
    throw invalid("Family member names must be unique so each investor can be identified.");
  }
  return normalized;
}

function resolveMemberEmail(value, allowedEmails, memberNames) {
  const member = String(value ?? "").trim();
  const emailIndex = allowedEmails.findIndex((email) => email.toLowerCase() === member.toLowerCase());
  if (emailIndex >= 0) return allowedEmails[emailIndex];
  const nameIndex = memberNames.findIndex((name) => name.toLowerCase() === member.toLowerCase());
  if (nameIndex >= 0) return allowedEmails[nameIndex];
  throw invalid("Investor name must match a configured family member.");
}

function spreadsheetDate(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * DAY_MS);
    if (!Number.isFinite(date.getTime())) throw invalid("A workbook date is invalid.");
    return date.toISOString().slice(0, 10);
  }
  if (typeof value === "string") return value.trim();
  throw invalid("Workbook date cells must contain dates, not formulas.");
}

function inputCellValue(cell, field) {
  const key = typeof field === "string" ? field : field.key;
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if ((typeof field === "object" && field.type === "date") ||
    ["purchaseDate", "manualMaturityDate", "maturityDate", "nextInterestDate"].includes(key)) {
    return spreadsheetDate(value);
  }
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      throw invalid("Formulas are not allowed in workbook input cells. Enter plain values instead.");
    }
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || "").join("");
    if ("text" in value) return value.text;
    throw invalid("A workbook cell contains an unsupported value.");
  }
  return typeof value === "string" ? value.trim() : value;
}

export async function buildHoldingsTemplate(allowedEmails, configuredNames = []) {
  const memberNames = resolveMemberNames(allowedEmails, configuredNames);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Household Investment Tracker";
  workbook.subject = "Household investment import template";
  workbook.title = "Household investment import template";
  workbook.calcProperties.fullCalcOnLoad = true;

  buildListSheet(workbook, memberNames);
  buildReadMeSheet(workbook);
  buildFieldGuideSheet(workbook);
  for (const schema of IMPORT_SHEETS) await buildInvestmentSheet(workbook, schema);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function buildListSheet(workbook, memberNames) {
  const lists = workbook.addWorksheet("_lists", { state: "veryHidden" });
  const allLists = [["FamilyMembers", "Authorized family members", memberNames], ...Object.entries(IMPORT_LISTS).map(([name, values]) => [name, name, values])];
  for (const [column, [name, label, values]] of allLists.entries()) {
    const columnNumber = column + 1;
    lists.getCell(1, columnNumber).value = label;
    values.forEach((value, index) => { lists.getCell(index + 2, columnNumber).value = value; });
    workbook.definedNames.add(`_lists!$${columnName(columnNumber)}$2:$${columnName(columnNumber)}$${values.length + 1}`, name);
  }
}

function buildReadMeSheet(workbook) {
  const sheet = workbook.addWorksheet("Read me");
  sheet.properties.tabColor = { argb: "FF4F46E5" };
  sheet.views = [{ showGridLines: false }];
  sheet.columns = [{ width: 4 }, { width: 42 }, { width: 100 }];
  sheet.mergeCells("B2:C2");
  sheet.mergeCells("B3:C3");
  sheet.getCell("B2").value = "Household investment import template";
  sheet.getCell("B3").value = "One row per investment. Use the tab that matches the investment type and pick values from the dropdowns.";
  sheet.getRow(2).height = 30;
  sheet.getRow(3).height = 32;
  sheet.getCell("B2").font = { name: "Calibri", size: 20, bold: true, color: { argb: "FF0F172A" } };
  sheet.getCell("B2").alignment = { vertical: "middle" };
  sheet.getCell("B3").font = { name: "Calibri", size: 11, color: { argb: "FF64748B" } };
  sheet.getCell("B3").alignment = { vertical: "middle", wrapText: true };

  const instructions = [
    ["1. Pick the right tab", "There is a separate tab for each supported instrument type, colour-coded by asset class. Only fill the tabs you need."],
    ["2. Fill one row per holding", "Columns marked * are required. Dates and units are required for the portfolio ledger; choose the investor's name from the dropdown."],
    ["3. Use dropdowns", "Where a dropdown is provided, choose a listed value. You can type institution names and other free-form details where no dropdown is shown."],
    ["4. Enter raw values", "The calculated maturity date and fixed-deposit maturity amount are locked and calculated from your inputs. Enter tenor or a maturity date. Amounts are estimates; actual bank terms may differ. The importer recalculates them server-side."],
    ["5. Protect private details", "Some tabs include account, policy, nominee and wallet identifiers. Imported details are encrypted at rest but shared with authorized family members. Avoid optional details unless needed; do not enter passwords, PINs, PAN or Aadhaar."]
  ];
  instructions.forEach(([heading, description], index) => {
    const row = index + 5;
    sheet.getCell(row, 2).value = heading;
    sheet.getCell(row, 3).value = description;
    sheet.getRow(row).height = 34;
    sheet.getCell(row, 2).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF334155" } };
    sheet.getCell(row, 2).alignment = { vertical: "top", wrapText: true };
    sheet.getCell(row, 3).font = { name: "Calibri", size: 10, color: { argb: "FF475569" } };
    sheet.getCell(row, 3).alignment = { vertical: "top", wrapText: true };
  });
}

function buildFieldGuideSheet(workbook) {
  const sheet = workbook.addWorksheet("Field guide");
  sheet.properties.tabColor = { argb: "FF94A3B8" };
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.columns = [
    { header: "Tab", width: 28 }, { header: "Field", width: 34 },
    { header: "Required", width: 12 }, { header: "Input", width: 14 },
    { header: "Options / notes", width: 76 }
  ];
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });
  for (const schema of IMPORT_SHEETS) {
    for (const field of schema.fields) {
      sheet.addRow([
        schema.name,
        field.header,
        field.header.includes("*") ? "Yes" : "",
        field.computed ? "calculated" : field.type,
        field.options ? `Dropdown: ${field.options}` : field.key === "ownerEmail"
          ? "Select the investor's name from the family list."
          : field.computed ? "Calculated by the workbook and server." : ""
      ]);
    }
  }
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 20;
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 9, color: { argb: "FF334155" } };
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }
}

function buildInvestmentSheet(workbook, schema) {
  const sheet = workbook.addWorksheet(schema.name);
  sheet.properties.tabColor = { argb: schema.asset === "equity" ? "FF6366F1" : schema.asset === "debt" ? "FF0EA5E9" : "FFF59E0B" };
  sheet.properties.defaultRowHeight = 16;
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1, showGridLines: true }];
  sheet.columns = schema.fields.map((field) => ({ key: field.key, header: field.header, width: field.width }));
  sheet.autoFilter = { from: "A1", to: `${columnName(schema.fields.length)}1` };
  sheet.getRow(1).height = 32;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sheet.properties.tabColor.argb } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
    cell.protection = { locked: true };
  });

  const fieldColumns = new Map(schema.fields.map((field, index) => [field.key, index + 1]));
  for (const field of schema.fields) {
    const columnNumber = fieldColumns.get(field.key);
    for (let rowNumber = 2; rowNumber <= TEMPLATE_ROWS + 1; rowNumber += 1) {
      sheet.getCell(rowNumber, columnNumber).protection = { locked: Boolean(field.computed) };
    }
    if (field.type === "date" || field.type === "calculated") {
      for (let rowNumber = 2; rowNumber <= TEMPLATE_ROWS + 1; rowNumber += 1) {
        sheet.getCell(rowNumber, columnNumber).numFmt = "dd-mmm-yyyy";
      }
    } else if (field.type === "number") {
      const format = field.header.includes("%") ? "0.00" : field.header.includes("₹") ? "₹#,##0.00" : "#,##0.####";
      for (let rowNumber = 2; rowNumber <= TEMPLATE_ROWS + 1; rowNumber += 1) {
        sheet.getCell(rowNumber, columnNumber).numFmt = format;
      }
    }
    if (!field.computed) addFieldValidation(sheet, field, columnNumber);
  }

  for (const field of schema.fields.filter((candidate) => candidate.computed)) {
    const columnNumber = fieldColumns.get(field.key);
    for (let rowNumber = 2; rowNumber <= TEMPLATE_ROWS + 1; rowNumber += 1) {
      const cell = sheet.getCell(rowNumber, columnNumber);
      if (field.key === "calculatedMaturityDate" && schema.maturity) {
        cell.value = { formula: maturityFormula(schema, fieldColumns, rowNumber) };
      } else if (field.calculation === "fixedDepositMaturityAmount") {
        cell.value = { formula: fixedDepositMaturityAmountFormula(fieldColumns, rowNumber) };
      }
      cell.protection = { locked: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    }
  }
  return sheet.protect(WORKSHEET_PASSWORD, {
    selectLockedCells: false,
    selectUnlockedCells: true,
    autoFilter: true,
    sort: true
  });
}

function addFieldValidation(sheet, field, columnNumber) {
  const range = `${columnName(columnNumber)}2:${columnName(columnNumber)}${TEMPLATE_ROWS + 1}`;
  if (field.type === "select") {
    sheet.dataValidations.add(range, {
      type: "list", allowBlank: true, formulae: [field.options],
      showErrorMessage: true, errorTitle: "Choose a listed value", error: "Select a value from the dropdown or leave the field blank."
    });
  } else if (field.type === "date") {
    sheet.dataValidations.add(range, {
      type: "date", operator: "between",
      formulae: [new Date(Date.UTC(1900, 0, 1)), new Date(Date.UTC(9999, 11, 31))],
      allowBlank: true, showErrorMessage: true, errorTitle: "Enter a date", error: "Use a valid date."
    });
  } else if (field.type === "number") {
    const maximum = field.max || 1_000_000_000;
    sheet.dataValidations.add(range, {
      type: field.integer ? "whole" : "decimal", operator: "between", formulae: [0, maximum],
      allowBlank: true, showErrorMessage: true, errorTitle: "Enter a valid number",
      error: `Enter a ${field.integer ? "whole " : ""}number between 0 and ${maximum}.`
    });
  }
}

function maturityFormula(schema, fieldColumns, rowNumber) {
  const cell = (key) => `${columnName(fieldColumns.get(key))}${rowNumber}`;
  const start = cell(schema.maturity.start);
  const manual = cell(schema.maturity.manual);
  const years = schema.maturity.years ? `IF(${cell(schema.maturity.years)}="",0,${cell(schema.maturity.years)})` : "0";
  const months = schema.maturity.months ? `IF(${cell(schema.maturity.months)}="",0,${cell(schema.maturity.months)})` : "0";
  const days = schema.maturity.days ? `IF(${cell(schema.maturity.days)}="",0,${cell(schema.maturity.days)})` : "0";
  const tenorCells = [schema.maturity.years, schema.maturity.months, schema.maturity.days].filter(Boolean).map(cell);
  const hasTenor = `COUNTIF(${tenorCells[0]}:${tenorCells.at(-1)},">0")>0`;
  return `IF(${hasTenor},IF(${start}="","",EDATE(${start},12*${years}+${months})+${days}),IF(${manual}="","",${manual}))`;
}

function fixedDepositMaturityAmountFormula(fieldColumns, rowNumber) {
  const cell = (key) => `${columnName(fieldColumns.get(key))}${rowNumber}`;
  const principal = cell("amountDeposited");
  const start = cell("purchaseDate");
  const maturity = cell("calculatedMaturityDate");
  const rate = cell("interestRate");
  const type = cell("depositType");
  const frequency = cell("frequency");
  const years = `ROW(INDIRECT(YEAR(${start})&":"&YEAR(${maturity})))`;
  const februaryEnd = `DATE(${years},3,0)`;
  const leapDays = `SUMPRODUCT((DAY(${februaryEnd})=29)*(${februaryEnd}>${start})*(${februaryEnd}<=${maturity}))`;
  const elapsedDays = `((${maturity}-${start})-${leapDays})`;
  const periods = `IF(${frequency}="Annual",1,IF(${frequency}="Half-yearly",2,IF(${frequency}="Monthly",12,4)))`;
  const simple = `${principal}*(1+${rate}/100*${elapsedDays}/365)`;
  const compound = `${principal}*(1+${rate}/100/${periods})^(${periods}*${elapsedDays}/365)`;
  return `IF(OR(${principal}="",${rate}="",${start}="",${maturity}="",${maturity}<${start}),"",IF(${type}<>"Cumulative",${principal},IF(${frequency}="Simple",${simple},${compound})))`;
}

export async function parseHoldingsWorkbook(buffer, allowedEmails = [], configuredNames = []) {
  const memberNames = resolveMemberNames(allowedEmails, configuredNames);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw invalid("Could not read the Excel workbook. Download a fresh template and try again.");
  }

  const rows = [];
  const importSchemas = new Map(IMPORT_SHEETS.map((schema) => [schema.name, schema]));
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible" || GUIDE_SHEETS.has(sheet.name)) continue;
    const schema = importSchemas.get(sheet.name);
    if (schema) parseInvestmentSheet(sheet, schema, rows, allowedEmails, memberNames);
    else if (LEGACY_IMPORT_SHEETS.has(sheet.name)) parseLegacySheet(sheet, LEGACY_IMPORT_SHEETS.get(sheet.name), rows, allowedEmails, memberNames);
    else throw invalid(`The workbook contains an unsupported sheet: ${sheet.name}. Use the downloaded template.`);
    if (rows.length > 500) throw invalid("Import up to 500 investment rows at a time.");
  }
  if (!rows.length) throw invalid("Add at least one investment row before importing the workbook.");
  return rows;
}

function parseInvestmentSheet(sheet, schema, rows, allowedEmails, memberNames) {
  const columns = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const normalized = normalizeHeader(cell.value);
    const field = schema.fields.find((candidate) => normalizeHeader(candidate.header) === normalized) ||
      (normalized === normalizeHeader("Family member email") ? schema.fields.find((candidate) => candidate.key === "ownerEmail") : null);
    if (field) columns.set(field.key, columnNumber);
  });
  for (const field of schema.fields) {
    if (!columns.has(field.key)) throw invalid(`The ${sheet.name} sheet is missing the ${field.header} column.`);
  }

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = {};
    const details = {};
    let hasValues = false;
    for (const field of schema.fields) {
      if (field.computed) continue;
      const cell = sheet.getCell(rowNumber, columns.get(field.key));
      if (field.key === "manualMaturityDate" && cell.value && typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value)) {
        continue;
      }
      const value = inputCellValue(cell, field);
      values[field.key] = value;
      if (value !== "") {
        hasValues = true;
        if (field.key !== "ownerEmail") details[field.header.replace(/\s*\*$/, "")] = value;
      }
    }
    if (!hasValues) continue;
    for (const field of schema.fields) {
      if (field.header.includes("*") && (values[field.key] === "" || values[field.key] === null || values[field.key] === undefined)) {
        throw invalid(`The ${sheet.name} sheet row ${rowNumber}: ${field.header} is required.`);
      }
    }

    const mapped = Object.fromEntries(Object.entries(schema.mapping).map(([key, rule]) => [key, resolveImportSchemaValue(rule, values)]));
    let maturityDate = mapped.maturityDate || values.manualMaturityDate || "";
    if (schema.maturity) {
      const hasTenor = [mapped.tenorYears, mapped.tenorMonths, mapped.tenorDays].some((value) => Number(value) > 0);
      if (hasTenor) {
        maturityDate = calculateMaturityDate(values.purchaseDate, mapped.tenorYears, mapped.tenorMonths, mapped.tenorDays);
      }
    }
    if (schema.name === "Debt - Fixed Deposits") {
      const maturityAmount = calculateMaturityAmount(
        values.amountDeposited,
        values.interestRate,
        values.purchaseDate,
        maturityDate,
        values.depositType,
        values.frequency
      );
      if (maturityAmount !== null) details["Maturity amount (₹)"] = maturityAmount;
    }
    if (!mapped.name || !values.purchaseDate || mapped.quantity === null || mapped.quantity === undefined ||
      mapped.purchasePrice === null || mapped.purchasePrice === undefined || mapped.purchasePrice === "") {
      throw invalid(`The ${sheet.name} sheet row ${rowNumber} needs an investment name, purchase date, quantity and purchase cost.`);
    }
    const ownerEmail = resolveMemberEmail(values.ownerEmail, allowedEmails, memberNames);
    rows.push({
      ownerEmail,
      productType: schema.productType,
      name: mapped.name || values.name || values.companyName || values.issuer || values.scheme || values.coinToken || values.insurer || "",
      symbol: mapped.symbol || null,
      broker: mapped.broker || null,
      purchaseDate: values.purchaseDate || "",
      quantity: mapped.quantity ?? "",
      purchasePrice: mapped.purchasePrice ?? "",
      currentPrice: mapped.currentPrice ?? "",
      maturityDate,
      tenorYears: mapped.tenorYears ?? "",
      tenorMonths: mapped.tenorMonths ?? "",
      tenorDays: mapped.tenorDays ?? "",
      interestRate: mapped.interestRate ?? "",
      nextInterestDate: mapped.nextInterestDate ?? "",
      frequency: mapped.frequency ?? "",
      bankIfsc: mapped.bankIfsc ?? "",
      bankName: mapped.bankName ?? "",
      bankAddress: mapped.bankAddress ?? "",
      importDetails: Object.keys(details).length ? details : null
    });
    if (rows.length > 500) throw invalid("Import up to 500 investment rows at a time.");
  }
}

function parseLegacySheet(sheet, productType, rows, allowedEmails, memberNames) {
  const columns = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const key = HEADER_KEYS.get(normalizeHeader(cell.value));
    if (key) columns.set(key, columnNumber);
  });
  for (const required of ["ownerEmail", "name", "purchaseDate", "quantity", "purchasePrice"]) {
    if (!columns.has(required)) throw invalid(`The ${sheet.name} sheet is missing the ${required} column.`);
  }

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const input = {};
    let hasValues = false;
    for (const [key, columnNumber] of columns) {
      if (key === "calculatedMaturityDate") continue;
      const value = inputCellValue(row.getCell(columnNumber), {
        key,
        type: ["purchaseDate", "manualMaturityDate", "maturityDate", "nextInterestDate"].includes(key) ? "date" : "text"
      });
      input[key] = value;
      if (value !== "") hasValues = true;
    }
    if (!hasValues) continue;
    rows.push({
      ...input,
      ownerEmail: resolveMemberEmail(input.ownerEmail, allowedEmails, memberNames),
      productType,
      maturityDate: input.manualMaturityDate || ""
    });
    if (rows.length > 500) throw invalid("Import up to 500 investment rows at a time.");
  }
}

function columnName(columnNumber) {
  let number = columnNumber;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}
