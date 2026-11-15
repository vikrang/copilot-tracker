const text = (key, header, width = 20, options = null) => ({ key, header, width, type: options ? "select" : "text", options });
const number = (key, header, width = 18, options = {}) => ({ key, header, width, type: "number", ...options });
const date = (key, header, width = 20, options = {}) => ({ key, header, width, type: "date", ...options });
const select = (key, header, width, options) => ({ key, header, width, type: "select", options });

const owner = () => select("ownerEmail", "Investor name *", 28, "FamilyMembers");
const recordId = () => text("recordId", "Record ID", 18);
const purchaseDate = (header = "Purchase / start date *") => date("purchaseDate", header, 25);
const tenor = () => [
  number("tenorYears", "Tenor years", 15, { integer: true, max: 100 }),
  number("tenorMonths", "Tenor months", 16, { integer: true, max: 1200 }),
  number("tenorDays", "Tenor days", 14, { integer: true, max: 36525 })
];
const depositorFields = () => [
  select("primaryDepositor", "Primary depositor", 25, "FamilyMembers"),
  select("jointDepositor1", "Joint depositor 1", 25, "FamilyMembers"),
  select("jointDepositor2", "Joint depositor 2", 25, "FamilyMembers"),
  select("nominee", "Nominee", 32, "FamilyMembers")
];
const bankFields = () => [
  text("bankIfsc", "Bank IFSC", 18),
  text("bankName", "Bank name", 28),
  text("bankAddress", "Bank branch address", 40)
];
const simpleMaturity = () => [
  date("manualMaturityDate", "Maturity date", 20),
  { key: "calculatedMaturityDate", header: "Calculated maturity date", width: 24, type: "calculated", computed: true }
];
const mutualFundFields = () => [
  text("name", "Investment name *", 24),
  select("amc", "AMC *", 28, "AMCs"),
  select("schemeCategory", "Scheme category *", 26, "SchemeCategories"),
  select("plan", "Plan *", 14, "Plans"),
  select("option", "Option *", 24, "FundOptions"),
  text("folioNumber", "Folio number", 18),
  number("quantity", "Units held *", 17),
  purchaseDate(),
  number("purchasePrice", "Average NAV (₹) *", 22),
  number("currentPrice", "Current NAV (₹)", 20),
  number("sipAmount", "SIP amount per month (₹)", 28),
  number("sipDebitDay", "SIP debit day", 16, { integer: true, max: 31 }),
  select("registrar", "Registrar", 28, "Registrars")
];

export const IMPORT_LISTS = {
  Exchanges: ["NSE", "BSE"],
  AMCs: [
    "SBI Mutual Fund", "HDFC Mutual Fund", "ICICI Prudential MF", "Nippon India MF", "Axis Mutual Fund",
    "Kotak Mahindra MF", "UTI Mutual Fund", "Aditya Birla Sun Life MF", "Mirae Asset MF", "Parag Parikh MF",
    "Quant MF", "DSP MF", "Franklin Templeton MF", "Tata MF", "Motilal Oswal MF", "Edelweiss MF",
    "Invesco MF", "HSBC MF", "Bandhan MF", "Sundaram MF", "Navi MF", "WhiteOak MF", "Other"
  ],
  SchemeCategories: [
    "Large Cap", "Mid Cap", "Small Cap", "Flexi Cap", "Multi Cap", "Focused Fund", "ELSS (Tax Saving)",
    "Index Fund", "Sectoral / Thematic", "Balanced Advantage", "Aggressive Hybrid", "Conservative Hybrid",
    "Arbitrage", "Liquid", "Overnight", "Ultra Short Duration", "Corporate Bond", "Gilt", "Credit Risk",
    "Gold", "International / Fund of Funds", "Other"
  ],
  Plans: ["Direct", "Regular"],
  FundOptions: ["Growth", "IDCW - Payout", "IDCW - Reinvestment"],
  DepositFrequencies: ["Quarterly", "Monthly", "Half-yearly", "Annual", "Simple"],
  Registrars: ["CAMS", "KFintech", "Franklin Templeton (in-house)", "Other"],
  ExchangesTracked: ["Nifty 50", "Nifty Next 50", "Bank Nifty", "Nifty Midcap 150", "Gold", "Silver", "International", "Other"],
  Banks: [
    "India Post", "State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank",
    "Punjab National Bank", "Bank of Baroda", "Canara Bank", "Union Bank of India", "IDFC FIRST Bank",
    "Yes Bank", "IndusInd Bank", "Federal Bank", "South Indian Bank", "Indian Bank", "Central Bank of India",
    "Bank of Maharashtra", "AU Small Finance Bank", "Ujjivan Small Finance Bank", "Equitas Small Finance Bank",
    "Jana Small Finance Bank", "ESAF Small Finance Bank", "Suryoday Small Finance Bank",
    "Utkarsh Small Finance Bank", "Capital Small Finance Bank", "North East Small Finance Bank",
    "Bandhan Bank", "India Post Payments Bank", "Other"
  ],
  DepositTypes: ["Fixed", "Cumulative"],
  BondTypes: [
    "Government Security (G-Sec)", "Treasury Bill", "State Development Loan", "Corporate Bond", "Tax-Free Bond",
    "Sovereign Gold Bond", "Debenture", "Other"
  ],
  CreditRatings: ["Sovereign", "AAA", "AA+", "AA", "AA-", "A+", "A", "BBB+", "BBB", "Unrated"],
  BondFrequencies: ["Annual", "Semi-annual", "Quarterly", "Cumulative"],
  YesNo: ["Yes", "No"],
  NPSTiers: ["Tier I", "Tier II"],
  NPSPreferences: ["Active", "Auto", "Aggressive (LC75)", "Moderate (LC50)", "Conservative (LC25)"],
  PensionManagers: [
    "SBI Pension Funds", "LIC Pension Fund", "UTI Retirement Solutions", "HDFC Pension",
    "ICICI Prudential Pension", "Kotak Mahindra Pension", "Aditya Birla Pension", "Tata Pension",
    "Max Life Pension", "DSP Pension"
  ],
  SmallSavingsSchemes: [
    "National Savings Certificate (NSC)", "Kisan Vikas Patra (KVP)", "Post Office MIS",
    "Sukanya Samriddhi Yojana (SSY)", "Senior Citizens' Savings Scheme (SCSS)",
    "Post Office Time Deposit", "Other"
  ],
  PropertyTypes: [
    "Residential Apartment", "Independent House / Villa", "Plot / Land", "Commercial Office",
    "Shop / Retail", "Industrial / Warehouse", "Agricultural Land"
  ],
  Metals: ["Gold", "Silver", "Platinum", "Diamond", "Other"],
  Purities: ["24K", "22K", "18K", "14K", "925 Silver", "Other"],
  Hallmarking: ["BIS Hallmarked", "Certified (IGI / GIA)", "Non-hallmarked", "Not sure"],
  Storage: ["Bank locker", "Home safe", "With family", "Other"],
  CryptoAssets: [
    "Bitcoin (BTC)", "Ethereum (ETH)", "Tether (USDT)", "BNB", "Solana (SOL)", "XRP",
    "Cardano (ADA)", "Dogecoin (DOGE)", "Polygon (MATIC)", "Avalanche (AVAX)", "Chainlink (LINK)", "Other"
  ],
  CryptoPlatforms: [
    "WazirX", "CoinDCX", "CoinSwitch", "Binance", "ZebPay", "Giottus", "Mudrex",
    "Ledger (self-custody)", "MetaMask (self-custody)", "Other"
  ],
  Insurers: [
    "LIC of India", "HDFC Life", "ICICI Prudential Life", "SBI Life", "Max Life", "Bajaj Allianz Life",
    "Tata AIA Life", "Kotak Life", "Aditya Birla Sun Life Insurance", "Axis Max Life", "PNB MetLife",
    "Star Health", "Niva Bupa", "Care Health", "New India Assurance", "ICICI Lombard", "HDFC ERGO",
    "Bajaj Allianz General", "United India Insurance", "Other"
  ],
  PolicyTypes: [
    "Term Life", "Endowment", "ULIP", "Money Back", "Whole Life", "Health", "Critical Illness", "Personal Accident"
  ],
  PremiumFrequencies: ["Monthly", "Quarterly", "Half-yearly", "Annual", "Single premium"],
  InterestFrequencies: ["Monthly", "Quarterly", "Half-yearly", "Annual", "At maturity", "Other"]
};

const makeSheet = (name, productType, asset, fields, mapping, maturity = null) => ({
  name, productType, asset, fields, mapping, maturity
});

export const IMPORT_SHEETS = [
  makeSheet("Equity - Stocks", "Listed equity", "equity", [
    owner(), recordId(), text("name", "Investment name *", 26),
    text("symbol", "Symbol / ticker *", 21), number("quantity", "Quantity *", 16),
    purchaseDate(), number("purchasePrice", "Average buy price (₹) *", 27),
    number("currentPrice", "Current price (₹)", 22),
    text("dematMasterAccount", "Demat master account", 24)
  ], { name: "name", symbol: "symbol", quantity: "quantity", purchasePrice: "purchasePrice", currentPrice: "currentPrice" }),

  makeSheet("Equity - Mutual Funds", "Equity mutual fund", "equity", [
    owner(), recordId(), ...mutualFundFields()
  ], { name: "name", broker: "amc", quantity: "quantity", purchasePrice: "purchasePrice", currentPrice: "currentPrice" }),

  makeSheet("Debt - Mutual Funds", "Debt mutual fund", "debt", [
    owner(), recordId(), ...mutualFundFields()
  ], { name: "name", broker: "amc", quantity: "quantity", purchasePrice: "purchasePrice", currentPrice: "currentPrice" }),

  makeSheet("Equity - ETFs", "Listed equity", "equity", [
    owner(), recordId(), text("name", "Investment name *", 24),
    text("symbol", "Symbol / ticker *", 21), number("quantity", "Units held *", 16),
    purchaseDate(), number("purchasePrice", "Average buy price (₹) *", 27),
    number("currentPrice", "Current price (₹)", 22),
    select("tracks", "Tracks", 22, "ExchangesTracked"),
    text("dematMasterAccount", "Demat master account", 24)
  ], { name: "name", symbol: "symbol", quantity: "quantity", purchasePrice: "purchasePrice", currentPrice: "currentPrice" }),

  makeSheet("Debt - Fixed Deposits", "Fixed deposit", "debt", [
    owner(), recordId(), text("companyName", "Company name *", 22),
    select("depositType", "Type *", 16, "DepositTypes"), text("referenceNo", "Reference no", 20),
    number("amountDeposited", "Amount deposited (₹) *", 26),
    purchaseDate("Date of purchase *"), number("interestRate", "Interest rate (%) *", 22),
    ...tenor(), select("frequency", "Interest frequency *", 22, "DepositFrequencies"),
    ...simpleMaturity(), { key: "maturityAmount", header: "Maturity amount (₹)", width: 24, type: "number", computed: true, calculation: "fixedDepositMaturityAmount" },
    select("bankNbfc", "Bank / NBFC *", 30, "Banks"), ...bankFields(), ...depositorFields(),
    number("currentValue", "Current value (₹)", 22), date("nextInterestDate", "Next interest date", 21)
  ], {
    name: "companyName", broker: "bankNbfc", quantity: () => 1, purchasePrice: "amountDeposited",
    currentPrice: (v) => firstNumber(v.currentValue, v.maturityAmount), maturityDate: "manualMaturityDate",
    interestRate: "interestRate", tenorYears: "tenorYears", tenorMonths: "tenorMonths", tenorDays: "tenorDays",
    frequency: "frequency", nextInterestDate: "nextInterestDate", bankIfsc: "bankIfsc", bankName: "bankName",
    bankAddress: "bankAddress"
  }, { start: "purchaseDate", years: "tenorYears", months: "tenorMonths", days: "tenorDays", manual: "manualMaturityDate" }),

  makeSheet("Debt - Recurring Deposits", "Fixed deposit", "debt", [
    owner(), recordId(), text("name", "Investment name *", 24),
    number("monthlyDeposit", "Monthly deposit (₹) *", 25),
    number("totalContributed", "Total contributed to date (₹) *", 30),
    text("referenceNo", "Reference no", 18), purchaseDate("Date of deposit *"),
    ...tenor(), number("interestRate", "Interest rate (%) *", 22),
    ...simpleMaturity(), select("bankPostOffice", "Bank / post office *", 30, "Banks"),
    ...bankFields(), ...depositorFields(), number("currentValue", "Current value (₹)", 22),
    date("nextInterestDate", "Next interest date", 21)
  ], {
    name: "name", broker: "bankPostOffice", quantity: () => 1, purchasePrice: "totalContributed",
    currentPrice: "currentValue", maturityDate: "manualMaturityDate", interestRate: "interestRate",
    tenorYears: "tenorYears", tenorMonths: "tenorMonths", tenorDays: "tenorDays", nextInterestDate: "nextInterestDate",
    bankIfsc: "bankIfsc", bankName: "bankName", bankAddress: "bankAddress"
  }, { start: "purchaseDate", years: "tenorYears", months: "tenorMonths", days: "tenorDays", manual: "manualMaturityDate" }),

  makeSheet("Debt - Bonds", "Bond / NCD", "debt", [
    owner(), recordId(), text("name", "Investment name *", 24), text("issuer", "Issuer *", 28),
    select("bondType", "Bond type *", 26, "BondTypes"), text("isin", "ISIN", 18),
    number("quantity", "Units / quantity *", 20), purchaseDate(),
    number("purchasePrice", "Purchase price per unit (₹) *", 31),
    number("faceValue", "Face value per unit (₹)", 27), number("couponRate", "Coupon rate (%)", 20),
    date("maturityDate", "Maturity date", 20), select("creditRating", "Credit rating", 18, "CreditRatings"),
    select("bondFrequency", "Interest frequency", 24, "BondFrequencies"),
    select("interestTaxable", "Interest is taxable", 23, "YesNo"),
    number("currentValue", "Current value (₹)", 22), date("nextInterestDate", "Next interest date", 21)
  ], {
    name: "name", symbol: "isin", broker: "issuer", quantity: "quantity", purchasePrice: "purchasePrice",
    currentPrice: (v) => divide(v.currentValue, v.quantity), maturityDate: "maturityDate",
    interestRate: "couponRate", frequency: "bondFrequency", nextInterestDate: "nextInterestDate"
  }),

  makeSheet("Debt - PPF", "PPF / EPF", "debt", [
    owner(), recordId(), text("name", "Investment name *", 24),
    select("bankPostOffice", "Bank / post office *", 30, "Banks"),
    text("ppfAccountNumber", "PPF account number *", 28), purchaseDate(),
    number("yearlyContribution", "Yearly contribution (₹)", 27),
    number("interestRate", "Interest rate (%)", 21), number("totalContributed", "Total contributed (₹) *", 27),
    number("currentBalance", "Current balance (₹)", 24), ...bankFields()
  ], {
    name: "name", broker: "bankPostOffice", quantity: () => 1, purchasePrice: "totalContributed",
    currentPrice: "currentBalance", interestRate: "interestRate", bankIfsc: "bankIfsc", bankName: "bankName",
    bankAddress: "bankAddress"
  }),

  makeSheet("Debt - EPF", "PPF / EPF", "debt", [
    owner(), recordId(), text("name", "Investment name *", 24), text("uan", "UAN *", 20),
    text("employer", "Employer / establishment", 30), purchaseDate(),
    number("employeeContribution", "Employee contribution (₹)", 29),
    number("employerContribution", "Employer contribution (₹)", 29),
    number("totalContributed", "Total contributed to date (₹) *", 30),
    number("interestRate", "Interest rate (%)", 21), number("currentBalance", "Current balance (₹)", 24)
  ], {
    name: "name", broker: "employer", quantity: () => 1,
    purchasePrice: "totalContributed",
    currentPrice: "currentBalance", interestRate: "interestRate"
  }),

  makeSheet("Debt - NPS", "NPS", "debt", [
    owner(), recordId(), text("name", "Investment name *", 24), text("pran", "PRAN *", 20),
    select("tier", "Tier *", 16, "NPSTiers"), select("schemePreference", "Scheme preference", 26, "NPSPreferences"),
    select("pensionFundManager", "Pension fund manager", 30, "PensionManagers"),
    number("employerContribution", "Employer contribution (₹)", 30),
    number("annuityAllocation", "Annuity allocation (%)", 28),
    date("retirementDate", "Retirement date", 20), purchaseDate(),
    number("totalContributed", "Total contributed (₹) *", 27), number("currentCorpus", "Current corpus (₹)", 24)
  ], {
    name: "name", broker: "pensionFundManager", quantity: () => 1, purchasePrice: "totalContributed",
    currentPrice: "currentCorpus"
  }),

  makeSheet("Debt - Small Savings", "Fixed deposit", "debt", [
    owner(), recordId(), number("amountDeposited", "Amount deposited (₹) *", 25),
    text("referenceNo", "Reference no", 18), purchaseDate("Date of deposit *"), ...tenor(),
    number("interestRate", "Interest rate (%)", 21), ...simpleMaturity(),
    select("scheme", "Scheme *", 36, "SmallSavingsSchemes"),
    select("institution", "Institution *", 30, "Banks"), ...depositorFields(),
    number("currentValue", "Current value (₹)", 22), date("nextInterestDate", "Next interest date", 21)
  ], {
    name: ["scheme", "institution", "referenceNo"], broker: "institution", quantity: () => 1,
    purchasePrice: "amountDeposited", currentPrice: "currentValue", maturityDate: "manualMaturityDate",
    interestRate: "interestRate", tenorYears: "tenorYears", tenorMonths: "tenorMonths", tenorDays: "tenorDays",
    nextInterestDate: "nextInterestDate"
  }, { start: "purchaseDate", years: "tenorYears", months: "tenorMonths", days: "tenorDays", manual: "manualMaturityDate" }),

  makeSheet("Other - Real Estate", "Other", "other", [
    owner(), recordId(), text("name", "Investment name *", 24),
    select("propertyType", "Property type *", 30, "PropertyTypes"), text("address", "Address", 40),
    text("city", "City", 20), number("areaSqFt", "Area (sq ft)", 18), purchaseDate(),
    number("stampDuty", "Stamp duty & registration (₹)", 33),
    number("ownershipShare", "Ownership share (%)", 24), select("coOwner", "Co-owner", 32, "FamilyMembers"),
    number("homeLoanOutstanding", "Home loan outstanding (₹)", 32),
    number("monthlyRent", "Monthly rent received (₹)", 30), text("khataSurveyNumber", "Khata / survey number", 25),
    select("currentlyRented", "Currently rented", 20, "YesNo"),
    number("purchasePrice", "Purchase price (₹) *", 24),
    number("currentValue", "Current valuation (₹)", 26)
  ], {
    name: "name", quantity: () => 1, purchasePrice: "purchasePrice", currentPrice: "currentValue"
  }),

  makeSheet("Other - Jewellery", "Gold", "other", [
    owner(), recordId(), text("name", "Investment name *", 24),
    select("metal", "Metal *", 18, "Metals"), select("purity", "Purity *", 18, "Purities"),
    number("weightGrams", "Weight (grams) *", 20), purchaseDate(),
    text("jewellerSource", "Jeweller / source", 24), text("invoiceNumber", "Bill / invoice number", 26),
    select("hallmarking", "Hallmarking", 24, "Hallmarking"), select("storedAt", "Stored at", 22, "Storage"),
    number("purchaseCost", "Purchase cost (₹) *", 24),
    number("currentValue", "Current valuation (₹)", 26)
  ], {
    name: "name", quantity: "weightGrams", purchasePrice: (v) => divide(v.purchaseCost, v.weightGrams),
    currentPrice: (v) => divide(v.currentValue, v.weightGrams)
  }),

  makeSheet("Other - Crypto", "Other", "other", [
    owner(), recordId(), text("name", "Investment name *", 24),
    select("coinToken", "Coin / token *", 22, "CryptoAssets"),
    select("exchangeWallet", "Exchange / wallet *", 30, "CryptoPlatforms"),
    number("quantity", "Quantity *", 18), purchaseDate(),
    number("purchasePrice", "Average buy price (₹) *", 28),
    number("currentPrice", "Current price (₹)", 23), text("walletAddress", "Wallet address", 44)
  ], {
    name: "name", symbol: (v) => tickerFrom(v.coinToken), broker: "exchangeWallet",
    quantity: "quantity", purchasePrice: "purchasePrice", currentPrice: "currentPrice"
  }),

  makeSheet("Other - Insurance", "Other", "other", [
    owner(), recordId(), text("name", "Investment name *", 24),
    select("insurer", "Insurer *", 34, "Insurers"), select("policyType", "Policy type *", 24, "PolicyTypes"),
    text("policyNumber", "Policy number *", 25), number("sumAssured", "Sum assured (₹)", 22),
    purchaseDate(), number("premiumAmount", "Premium amount (₹)", 24),
    select("premiumFrequency", "Premium frequency", 24, "PremiumFrequencies"),
    number("policyTermYears", "Policy term (years)", 23, { integer: true, max: 100 }),
    ...simpleMaturity(), number("surrenderValue", "Fund / surrender value (₹)", 32),
    number("premiumsPaid", "Premiums paid (₹) *", 24), number("currentFundValue", "Current fund value (₹)", 27)
  ], {
    name: "name", broker: "insurer", quantity: () => 1,
    purchasePrice: "premiumsPaid",
    currentPrice: (v) => firstNumber(v.currentFundValue, v.surrenderValue),
    maturityDate: "manualMaturityDate", tenorYears: "policyTermYears"
  }, { start: "purchaseDate", years: "policyTermYears", manual: "manualMaturityDate" })
];

export const LEGACY_IMPORT_SHEETS = new Map([
  ["Listed equity", "Listed equity"],
  ["Equity MF", "Equity mutual fund"],
  ["Debt MF", "Debt mutual fund"],
  ["Fixed deposits", "Fixed deposit"],
  ["Bonds - NCDs", "Bond / NCD"],
  ["PPF - EPF", "PPF / EPF"],
  ["NPS", "NPS"],
  ["Gold", "Gold"],
  ["Other", "Other"]
]);

export function resolveImportSchemaValue(rule, values) {
  if (typeof rule === "function") return rule(values);
  if (Array.isArray(rule)) {
    return rule.map((key) => values[key]).find((value) => value !== null && value !== undefined && value !== "");
  }
  return rule ? values[rule] : undefined;
}

function firstNumber(...values) {
  return values.map(asNumber).find((value) => value !== null) ?? null;
}

function divide(numerator, denominator) {
  const top = asNumber(numerator);
  const bottom = asNumber(denominator);
  return top === null || bottom === null || bottom <= 0 ? null : top / bottom;
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function tickerFrom(value) {
  const match = String(value ?? "").match(/\(([A-Za-z0-9.-]+)\)/);
  return match?.[1] || null;
}
