import { randomUUID } from "node:crypto";

export const PRODUCT_TYPES = [
  "Listed equity",
  "Equity mutual fund",
  "Debt mutual fund",
  "Fixed deposit",
  "Bond / NCD",
  "PPF / EPF",
  "NPS",
  "Gold",
  "Other"
];

export const TRANSACTION_TYPES = ["BUY", "SELL", "DIVIDEND", "BONUS"];
export const INTEREST_FREQUENCIES = ["Monthly", "Quarterly", "Half-yearly", "Annual", "At maturity", "Other"];

const DAY_MS = 24 * 60 * 60 * 1000;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function requiredText(value, label, max = 100) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw invalid(`${label} is required (maximum ${max} characters).`);
  return text;
}

function optionalText(value, label, max = 100) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw invalid(`${label} must be ${max} characters or fewer.`);
  return text || null;
}

function importDetailsValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw invalid("Imported detail fields must be a plain object.");
  }
  const entries = Object.entries(value);
  if (entries.length > 80) throw invalid("An investment can contain at most 80 imported detail fields.");
  const details = Object.create(null);
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey).trim();
    if (!key || key.length > 100) throw invalid("An imported detail field name is invalid.");
    if (typeof rawValue === "string") {
      if (rawValue.length > 2000) throw invalid(`Imported detail "${key}" is too long.`);
      details[key] = rawValue;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      details[key] = rawValue;
    } else if (typeof rawValue === "boolean") {
      details[key] = rawValue;
    } else {
      throw invalid(`Imported detail "${key}" must be text, a number, or yes/no.`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(details), "utf8") > 20_000) {
    throw invalid("Imported investment details exceed the allowed size.");
  }
  return Object.keys(details).length ? details : null;
}

const REFERENCE_DETAIL_KEYS = new Set(["recordid", "referenceno", "referencenumber", "policynumber"]);

function holdingReferences(holding) {
  return Object.entries(holding.importDetails || {})
    .map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), String(value ?? "").trim().toUpperCase()])
    .filter(([key, value]) => REFERENCE_DETAIL_KEYS.has(key) && value);
}

function hasDuplicateReference(existing, candidate) {
  const references = holdingReferences(candidate);
  if (!references.length) return false;
  return existing.some((holding) =>
    holding.ownerEmail === candidate.ownerEmail &&
    holding.productType === candidate.productType &&
    (holding.broker || "").trim().toLowerCase() === (candidate.broker || "").trim().toLowerCase() &&
    holdingReferences(holding).some(([key, value]) =>
      references.some(([candidateKey, candidateValue]) => candidateKey === key && candidateValue === value)
    )
  );
}

function numberValue(value, label, { min = 0, max = 1_000_000_000, allowNull = false } = {}) {
  if ((value === null || value === undefined || value === "") && allowNull) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw invalid(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function dateValue(value, label, optional = false) {
  if (!value && optional) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid(`${label} must use YYYY-MM-DD format.`);
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw invalid(`${label} is not a valid date.`);
  }
  return value;
}

function tenorValue(value, label, max) {
  const result = numberValue(value, label, { max, allowNull: true });
  if (result !== null && !Number.isInteger(result)) throw invalid(`${label} must be a whole number.`);
  return result ?? 0;
}

export function calculateMaturityDate(startDate, years, months, days) {
  const start = dateValue(startDate, "Purchase date");
  const tenorYears = tenorValue(years, "Tenor years", 100);
  const tenorMonths = tenorValue(months, "Tenor months", 1200);
  const tenorDays = tenorValue(days, "Tenor days", 36_525);
  if (!tenorYears && !tenorMonths && !tenorDays) return null;

  const [year, month, day] = start.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 + tenorYears * 12 + tenorMonths;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12;
  if (targetYear > 9999) throw invalid("Calculated maturity date is outside the supported date range.");
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const maturity = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay) + tenorDays));
  if (!Number.isFinite(maturity.getTime()) || maturity.getUTCFullYear() > 9999) {
    throw invalid("Calculated maturity date is outside the supported date range.");
  }
  return maturity.toISOString().slice(0, 10);
}

export function calculateMaturityAmount(principalInput, annualRateInput, startDateInput, maturityDateInput, depositType, frequency) {
  const principal = numberValue(principalInput, "Deposit amount", { allowNull: true });
  const annualRate = numberValue(annualRateInput, "Interest rate (%)", { max: 100, allowNull: true });
  if (principal === null || annualRate === null || !startDateInput || !maturityDateInput) return null;
  if (!["Fixed", "Cumulative"].includes(depositType)) throw invalid("Deposit type must be Fixed or Cumulative.");
  if (!["Simple", "Annual", "Half-yearly", "Quarterly", "Monthly"].includes(frequency)) {
    throw invalid("Choose a supported fixed deposit interest frequency.");
  }
  const startDate = dateValue(startDateInput, "Purchase date");
  const maturityDate = dateValue(maturityDateInput, "Maturity date");
  if (maturityDate < startDate) throw invalid("Maturity date cannot be before the purchase date.");
  if (depositType !== "Cumulative") return principal;

  const startTime = Date.parse(`${startDate}T00:00:00Z`);
  const maturityTime = Date.parse(`${maturityDate}T00:00:00Z`);
  let elapsedDays = Math.round((maturityTime - startTime) / DAY_MS);
  const startYear = Number(startDate.slice(0, 4));
  const maturityYear = Number(maturityDate.slice(0, 4));
  for (let year = startYear; year <= maturityYear; year += 1) {
    const leapDay = Date.UTC(year, 1, 29);
    if (new Date(leapDay).getUTCMonth() === 1 && leapDay > startTime && leapDay <= maturityTime) elapsedDays -= 1;
  }
  if (frequency === "Simple") return principal * (1 + annualRate / 100 * elapsedDays / 365);

  const periods = frequency === "Annual" ? 1 : frequency === "Half-yearly" ? 2 : frequency === "Monthly" ? 12 : 4;
  return principal * Math.pow(1 + annualRate / 100 / periods, periods * elapsedDays / 365);
}

function cleanEmail(value, allowedEmails) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!allowedEmails.includes(email)) throw invalid("Choose a family member with authorized Google access.");
  return email;
}

export function createEmptyData(allowedEmails) {
  return {
    schemaVersion: 1,
    members: [...allowedEmails],
    holdings: [],
    transactions: [],
    settings: { annualReturnPct: 8, monthlyContribution: 0 }
  };
}

export function normalizeHolding(input, allowedEmails, existing = []) {
  const productType = requiredText(input.productType, "Product type", 40);
  if (!PRODUCT_TYPES.includes(productType)) throw invalid("Choose a supported investment product type.");
  const ownerEmail = cleanEmail(input.ownerEmail, allowedEmails);
  const name = requiredText(input.name, "Investment name", 100);
  const symbol = optionalText(input.symbol, "Symbol", 20)?.toUpperCase() || null;
  if (symbol && !/^[A-Z0-9.-]+$/.test(symbol)) throw invalid("Symbol may contain letters, numbers, dots, and hyphens.");
  const broker = optionalText(input.broker, "Broker / institution", 80);
  const purchaseDate = dateValue(input.purchaseDate, "Purchase date", true);
  const tenorYears = tenorValue(input.tenorYears, "Tenor years", 100);
  const tenorMonths = tenorValue(input.tenorMonths, "Tenor months", 1200);
  const tenorDays = tenorValue(input.tenorDays, "Tenor days", 36_525);
  const hasTenor = Boolean(tenorYears || tenorMonths || tenorDays);
  if (hasTenor && !purchaseDate) throw invalid("Purchase date is required to calculate maturity from tenor.");
  const maturityDate = hasTenor
    ? calculateMaturityDate(purchaseDate, tenorYears, tenorMonths, tenorDays)
    : dateValue(input.maturityDate, "Maturity date", true);
  const nextInterestDate = dateValue(input.nextInterestDate, "Next interest date", true);
  const interestRate = numberValue(input.interestRate, "Interest rate (%)", { max: 100, allowNull: true });
  const frequency = optionalText(input.frequency, "Interest frequency", 30);
  const bankIfsc = optionalText(input.bankIfsc, "Bank IFSC", 11)?.toUpperCase() || null;
  if (bankIfsc && !IFSC_PATTERN.test(bankIfsc)) throw invalid("Bank IFSC must be an 11-character Indian IFSC code.");
  const bankName = optionalText(input.bankName, "Bank name", 100);
  const bankAddress = optionalText(input.bankAddress, "Bank branch address", 300);
  const importDetails = { ...(importDetailsValue(input.importDetails) || {}) };
  const referenceNo = optionalText(input.referenceNo, "Reference number", 100);
  if (referenceNo) importDetails["Reference no"] = referenceNo;
  else if (Object.hasOwn(input, "referenceNo")) delete importDetails["Reference no"];
  const normalizedImportDetails = importDetailsValue(importDetails);
  if (hasDuplicateReference(existing, { ownerEmail, productType, broker, importDetails: normalizedImportDetails })) {
    throw Object.assign(
      invalid("This reference number is already used by this family member for this product and institution."),
      { code: "DUPLICATE_HOLDING_REFERENCE" }
    );
  }

  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ownerEmail,
    productType,
    name,
    symbol,
    broker,
    purchaseDate,
    currentPrice: numberValue(input.currentPrice, "Current price", { max: 10_000_000, allowNull: true }),
    priceSource: input.currentPrice === null || input.currentPrice === undefined || input.currentPrice === "" ? null : "manual",
    priceUpdatedAt: input.currentPrice === null || input.currentPrice === undefined || input.currentPrice === "" ? null : now,
    maturityDate,
    tenorYears: hasTenor ? tenorYears : null,
    tenorMonths: hasTenor ? tenorMonths : null,
    tenorDays: hasTenor ? tenorDays : null,
    interestRate,
    nextInterestDate,
    frequency,
    bankIfsc,
    bankName,
    bankAddress,
    importDetails: normalizedImportDetails,
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeTransaction(input, holdingId, existing = []) {
  const type = requiredText(input.type, "Transaction type", 20).toUpperCase();
  if (!TRANSACTION_TYPES.includes(type)) throw invalid("Transaction type must be BUY, SELL, DIVIDEND, or BONUS.");
  const date = dateValue(input.date, "Transaction date");
  const notes = optionalText(input.notes, "Notes", 240);
  const quantity = type === "DIVIDEND" ? null : numberValue(input.quantity, "Units", { min: 0.000001, max: 100_000_000 });
  const price = type === "DIVIDEND"
    ? null
    : type === "BONUS"
      ? 0
      : numberValue(input.price, "Price per unit", { max: 10_000_000 });
  const amount = type === "DIVIDEND"
    ? numberValue(input.amount, "Dividend / interest amount", { min: 0.01, max: 1_000_000_000 })
    : quantity * price;
  const duplicate = existing.find((transaction) =>
    transaction.holdingId === holdingId &&
    transaction.type === type &&
    transaction.date === date &&
    transaction.quantity === quantity &&
    transaction.price === price &&
    transaction.amount === amount
  );
  if (duplicate) throw invalid("This transaction is already recorded.");
  return { id: randomUUID(), holdingId, type, date, quantity, price, amount, notes, createdAt: new Date().toISOString() };
}

function fifoLedger(transactions) {
  const lots = [];
  let realized = 0;
  let realizedCostBasis = 0;
  let dividends = 0;
  for (const transaction of [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))) {
    if (transaction.type === "BUY" || transaction.type === "BONUS") {
      lots.push({ date: transaction.date, quantity: transaction.quantity, price: transaction.price, remaining: transaction.quantity });
    } else if (transaction.type === "DIVIDEND") {
      dividends += transaction.amount;
    } else {
      let remaining = transaction.quantity;
      while (remaining > 0) {
        const lot = lots.find((candidate) => candidate.remaining > 0);
        if (!lot) throw invalid("A sale exceeds the available units.");
        const sold = Math.min(remaining, lot.remaining);
        realized += sold * (transaction.price - lot.price);
        realizedCostBasis += sold * lot.price;
        lot.remaining -= sold;
        remaining -= sold;
      }
    }
  }
  return { lots: lots.filter((lot) => lot.remaining > 0), realized, realizedCostBasis, dividends };
}

export function addHolding(data, input, allowedEmails, { preserveId = false, includeOpeningTransaction = true } = {}) {
  const holding = normalizeHolding(input, allowedEmails, data.holdings);
  if (preserveId && input.id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) {
      throw invalid("Imported holding ID is invalid.");
    }
    if (data.holdings.some((item) => item.id === input.id)) throw invalid("Imported holding ID already exists.");
    holding.id = input.id;
    const source = ["manual", "market-data adapter", "import"].includes(input.priceSource)
      ? input.priceSource
      : "import";
    const importedTimestamp = input.priceUpdatedAt ? Date.parse(input.priceUpdatedAt) : NaN;
    holding.priceSource = source;
    holding.priceUpdatedAt = Number.isFinite(importedTimestamp) ? new Date(importedTimestamp).toISOString() : null;
  }
  const transaction = includeOpeningTransaction
    ? normalizeTransaction({
      type: "BUY",
      date: input.purchaseDate,
      quantity: input.quantity,
      price: input.purchasePrice,
      notes: "Opening balance"
    }, holding.id)
    : null;
  data.holdings.push(holding);
  if (transaction) data.transactions.push(transaction);
  return holding;
}

export function addTransaction(data, input, allowedEmails) {
  const holding = data.holdings.find((item) => item.id === input.holdingId);
  if (!holding) throw invalid("Investment not found.");
  cleanEmail(holding.ownerEmail, allowedEmails);
  const transaction = normalizeTransaction(input, holding.id, data.transactions);
  const ledger = fifoLedger(data.transactions.filter((item) => item.holdingId === holding.id));
  if (transaction.type === "SELL") {
    const available = ledger.lots.reduce((sum, lot) => sum + lot.remaining, 0);
    if (transaction.quantity > available + 1e-8) throw invalid("Sale units cannot exceed the currently held quantity.");
  }
  data.transactions.push(transaction);
  return transaction;
}

export function updateHolding(data, holdingId, input, allowedEmails) {
  const holding = data.holdings.find((item) => item.id === holdingId);
  if (!holding) throw invalid("Investment not found.");
  const otherHoldings = data.holdings.filter((item) => item.id !== holdingId);
  const purchaseDate = holding.purchaseDate || data.transactions
    .filter((transaction) => transaction.holdingId === holdingId && transaction.type === "BUY")
    .map((transaction) => transaction.date)
    .sort()[0] || null;
  const updated = normalizeHolding({ ...holding, purchaseDate, ...input }, allowedEmails, otherHoldings);
  const unchangedPrice = updated.currentPrice === holding.currentPrice;
  Object.assign(holding, updated, {
    id: holding.id,
    createdAt: holding.createdAt,
    updatedAt: new Date().toISOString(),
    ...(unchangedPrice ? { priceSource: holding.priceSource, priceUpdatedAt: holding.priceUpdatedAt } : {})
  });
  return holding;
}

export function updateHoldingPrice(data, holdingId, price, source = "manual", asOf = new Date().toISOString()) {
  const holding = data.holdings.find((item) => item.id === holdingId);
  if (!holding) throw invalid("Investment not found.");
  holding.currentPrice = numberValue(price, "Current price", { max: 10_000_000 });
  holding.priceSource = source;
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) throw invalid("Price update timestamp is invalid.");
  holding.priceUpdatedAt = new Date(timestamp).toISOString();
  holding.updatedAt = holding.priceUpdatedAt;
}

export function updateSettings(data, input) {
  data.settings = {
    annualReturnPct: numberValue(input.annualReturnPct, "Annual return assumption (%)", { max: 30 }),
    monthlyContribution: numberValue(input.monthlyContribution, "Monthly contribution", { max: 100_000_000 })
  };
}

function holdingTerm(productType) {
  if (productType === "Listed equity" || productType === "Equity mutual fund") return 365;
  if (productType === "Debt mutual fund" || productType === "Bond / NCD" || productType === "Fixed deposit") return 1095;
  return 730;
}

export function buildDashboard(data, today = new Date()) {
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const holdingSummaries = data.holdings.map((holding) => {
    const ledger = fifoLedger(data.transactions.filter((transaction) => transaction.holdingId === holding.id));
    const purchaseDate = holding.purchaseDate || data.transactions
      .filter((transaction) => transaction.holdingId === holding.id && transaction.type === "BUY")
      .map((transaction) => transaction.date)
      .sort()[0] || null;
    const units = ledger.lots.reduce((sum, lot) => sum + lot.remaining, 0);
    const costBasis = ledger.lots.reduce((sum, lot) => sum + lot.remaining * lot.price, 0);
    const currentValue = holding.currentPrice === null ? null : units * holding.currentPrice;
    const oldestDays = ledger.lots.length
      ? Math.max(0, Math.floor((day - Date.parse(`${ledger.lots[0].date}T00:00:00Z`)) / DAY_MS))
      : null;
    const term = holdingTerm(holding.productType);
    const longTermUnits = ledger.lots
      .filter((lot) => Math.floor((day - Date.parse(`${lot.date}T00:00:00Z`)) / DAY_MS) >= term)
      .reduce((sum, lot) => sum + lot.remaining, 0);
    return {
      ...holding,
      purchaseDate,
      units,
      averageCost: units ? costBasis / units : null,
      costBasis,
      currentValue,
      unrealized: currentValue === null ? null : currentValue - costBasis,
      realized: ledger.realized,
      realizedCostBasis: ledger.realizedCostBasis,
      dividends: ledger.dividends,
      oldestDays,
      holdingTermDays: term,
      longTermUnits,
      shortTermUnits: units - longTermUnits,
      lastTransactionDate: data.transactions
        .filter((transaction) => transaction.holdingId === holding.id)
        .map((transaction) => transaction.date)
        .sort()
        .at(-1) || null
    };
  });

  const activeHoldings = holdingSummaries.filter((holding) => holding.units > 1e-8);
  const valuedHoldings = activeHoldings.filter((holding) => holding.currentValue !== null);
  const totalValue = valuedHoldings.reduce((sum, holding) => sum + holding.currentValue, 0);
  const totalCost = holdingSummaries.reduce((sum, holding) => sum + holding.costBasis, 0);
  const realized = holdingSummaries.reduce((sum, holding) => sum + holding.realized, 0);
  const realizedCostBasis = holdingSummaries.reduce((sum, holding) => sum + holding.realizedCostBasis, 0);
  const dividends = holdingSummaries.reduce((sum, holding) => sum + holding.dividends, 0);
  const unrealized = valuedHoldings.reduce((sum, holding) => sum + holding.unrealized, 0);
  const grossInvested = data.transactions
    .filter((transaction) => transaction.type === "BUY")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const netReturn = realized + dividends + unrealized;
  const annualReturn = data.settings.annualReturnPct / 100;
  const monthlyRate = Math.pow(1 + annualReturn, 1 / 12) - 1;
  const projections = [1, 3, 5, 10].map((years) => {
    const months = years * 12;
    const futureValue = totalValue * Math.pow(1 + annualReturn, years) +
      (monthlyRate ? data.settings.monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) : data.settings.monthlyContribution * months);
    return { years, value: Math.round(futureValue) };
  });
  const todayText = today.toISOString().slice(0, 10);
  const reminders = data.holdings.flatMap((holding) => {
    const items = [];
    if (holding.maturityDate) {
      const days = Math.ceil((Date.parse(`${holding.maturityDate}T00:00:00Z`) - day) / DAY_MS);
      if (days <= 90) items.push({ id: `${holding.id}-maturity`, kind: "maturity", holdingId: holding.id, name: holding.name, date: holding.maturityDate, days, overdue: days < 0, message: days < 0 ? `Maturity passed ${Math.abs(days)} day(s) ago` : `Matures in ${days} day(s)` });
    }
    if (holding.nextInterestDate) {
      const days = Math.ceil((Date.parse(`${holding.nextInterestDate}T00:00:00Z`) - day) / DAY_MS);
      if (days <= 30) items.push({ id: `${holding.id}-interest`, kind: "interest", holdingId: holding.id, name: holding.name, date: holding.nextInterestDate, days, overdue: days < 0, message: days < 0 ? `Interest date passed ${Math.abs(days)} day(s) ago` : `Interest due in ${days} day(s)` });
    }
    return items;
  }).sort((a, b) => a.days - b.days);

  const allocation = Object.entries(valuedHoldings.reduce((map, holding) => {
    map[holding.productType] = (map[holding.productType] || 0) + holding.currentValue;
    return map;
  }, {})).map(([productType, value]) => ({ productType, value, percentage: totalValue ? value / totalValue * 100 : 0 }));
  const recentTransactions = [...data.transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
    .map((transaction) => ({
      ...transaction,
      holdingName: data.holdings.find((holding) => holding.id === transaction.holdingId)?.name || "Investment"
    }));

  return {
    summary: {
      totalValue, totalCost, grossInvested, unrealized, realized, dividends, netReturn,
      returnPct: grossInvested ? netReturn / grossInvested * 100 : null,
      realizedCostBasis,
      realizedPct: realizedCostBasis ? realized / realizedCostBasis * 100 : null,
      valuedCount: valuedHoldings.length, holdingCount: activeHoldings.length
    },
    holdings: holdingSummaries,
    allocation,
    projections,
    reminders,
    recentTransactions,
    settings: data.settings,
    members: data.members,
    asOf: todayText
  };
}

export function addImportedHoldings(data, rows, allowedEmails) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw invalid("Import 1 to 500 investment rows at a time.");
  const added = [];
  let duplicates = 0;
  for (const row of rows) {
    const sameId = row.id && data.holdings.find((holding) => holding.id === row.id);
    if (sameId) {
      if (sameId.name !== row.name || sameId.ownerEmail !== row.ownerEmail) throw invalid("An imported holding ID conflicts with an existing investment.");
      duplicates += 1;
      continue;
    }
    const restoreLedger = Boolean(row.id);
    try {
      const holding = addHolding(data, row, allowedEmails, { preserveId: restoreLedger, includeOpeningTransaction: !restoreLedger });
      added.push(holding.id);
    } catch (error) {
      if (error.code === "DUPLICATE_HOLDING_REFERENCE") duplicates += 1;
      else throw error;
    }
  }
  return { added: added.length, duplicates };
}

export function exportRows(data) {
  const dashboard = buildDashboard(data);
  return {
    holdings: dashboard.holdings.map((holding) => {
      const purchase = data.transactions
        .filter((transaction) => transaction.holdingId === holding.id && (transaction.type === "BUY" || transaction.type === "BONUS"))
        .map((transaction) => transaction.date)
        .sort()[0];
      return {
        id: holding.id,
        ownerEmail: holding.ownerEmail,
        productType: holding.productType,
        name: holding.name,
        symbol: holding.symbol,
        broker: holding.broker,
        purchaseDate: holding.purchaseDate || purchase,
        quantity: holding.units,
        purchasePrice: holding.averageCost,
        currentPrice: holding.currentPrice,
        priceSource: holding.priceSource,
        priceUpdatedAt: holding.priceUpdatedAt,
        maturityDate: holding.maturityDate,
        tenorYears: holding.tenorYears,
        tenorMonths: holding.tenorMonths,
        tenorDays: holding.tenorDays,
        interestRate: holding.interestRate,
        nextInterestDate: holding.nextInterestDate,
        frequency: holding.frequency,
        bankIfsc: holding.bankIfsc,
        bankName: holding.bankName,
        bankAddress: holding.bankAddress,
        importDetails: holding.importDetails
      };
    }),
    transactions: [...data.transactions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map(({ id, holdingId, type, date, quantity, price, amount, notes }) => ({
        id, holdingId, type, date, quantity, price, amount, notes
      }))
  };
}
