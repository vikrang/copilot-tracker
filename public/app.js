const PRODUCT_TYPES = [
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
const MUTUAL_FUND_TYPES = ["Equity mutual fund", "Debt mutual fund"];
const TRANSACTION_TYPES = ["BUY", "SELL", "DIVIDEND", "BONUS"];
const INTEREST_FREQUENCIES = ["Monthly", "Quarterly", "Half-yearly", "Annual", "At maturity", "Other"];
const byId = (id) => document.getElementById(id);
const elements = {
  auth: byId("auth-screen"),
  app: byId("app-shell"),
  authMessage: byId("auth-message"),
  signIn: byId("google-signin"),
  setup: byId("setup-guide"),
  loading: byId("loading-state"),
  content: byId("screen-content"),
  modal: byId("modal"),
  modalContent: byId("modal-content"),
  notice: byId("app-notice"),
  title: byId("page-title")
};
let equitySearchTimer = null;
let equitySearchSequence = 0;
let mutualFundSearchTimer = null;
let mutualFundSearchSequence = 0;
const state = { session: null, dashboard: null, screen: "overview", csrfToken: null };
const screenTitles = {
  overview: "Overview",
  portfolio: "Portfolio",
  debt: "Fixed income",
  activity: "Activity",
  planning: "Planning",
  tools: "Import & export"
};
const dateToday = new Date().toISOString().slice(0, 10);
let ifscLookupTimer;
let ifscLookupController;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function downloadTransactionsTemplate() {
  const firstHolding = state.dashboard.holdings[0];
  if (!firstHolding) {
    setNotice("Add an investment first. The transaction template needs an existing holding ID.", "warning");
    return;
  }
  downloadCsv("investment-transactions-template.csv", [{
    holdingId: firstHolding.id,
    type: "BUY",
    date: dateToday,
    quantity: "10",
    price: "100",
    amount: "",
    notes: ""
  }]);
  setNotice("Transaction template downloaded. Use holding IDs from the household transaction export.", "success");
}

function money(value, options = {}) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: options.decimals ?? 0
  }).format(value);
}

async function importTransactions(file) {
  if (!file) return;
  if (file.size > 1_000_000) {
    setNotice("CSV must be 1 MB or smaller.", "error");
    return;
  }
  try {
    const rows = parseCsv(await file.text());
    const mapped = rows.map((row) => ({
      holdingId: row.holdingid,
      type: row.type,
      date: row.date,
      quantity: row.quantity,
      price: row.price,
      amount: row.amount,
      notes: row.notes
    }));
    const result = await api("/api/import/transactions", { method: "POST", body: { rows: mapped } });
    if (await loadDashboard()) setNotice(`Imported ${result.added} transaction(s).`, "success");
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    byId("transactions-import").value = "";
  }
}

function number(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(value);
}

function formatDate(value, options = {}) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric", month: options.short ? "short" : "long", year: "numeric"
  });
}

function memberLabel(email) {
  const member = String(email || "");
  const [name] = member.split("@");
  return name || "Family member";
}

function setNotice(message, type = "info") {
  elements.notice.textContent = message;
  elements.notice.className = `app-notice notice-${type}`;
  elements.notice.hidden = !message;
  if (message) window.scrollTo({ top: 0, behavior: "smooth" });
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (["POST", "PATCH", "DELETE"].includes(method)) headers["x-csrf-token"] = state.csrfToken || "";
  const response = await fetch(path, {
    ...options,
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin"
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showSignIn("Your sign-in has expired. Sign in again to continue.");
    throw new Error(payload.error || "Please sign in again.");
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
  return payload;
}

function showSignIn(message, session = null) {
  state.session = session;
  elements.auth.hidden = false;
  elements.app.hidden = true;
  elements.authMessage.textContent = message;
  elements.authMessage.className = "notice notice-info";
  elements.signIn.hidden = !session?.googleConfigured;
  elements.setup.hidden = !session || Boolean(session.googleConfigured);
  const missing = session?.googleSetupMissing || [];
  byId("setup-missing").textContent = missing.length ? `Missing server settings: ${missing.join(", ")}` : "";
}

async function initialize() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    const session = await response.json();
    const params = new URLSearchParams(location.search);
    if (params.get("auth") === "denied") {
      showSignIn("This Google account is not on the household access list.", session);
    } else if (params.get("auth") === "failed") {
      showSignIn("Google sign-in did not complete. Please try again.", session);
    } else if (session.authenticated) {
      state.session = session;
      state.csrfToken = session.csrfToken;
      elements.auth.hidden = true;
      elements.app.hidden = false;
      byId("account-name").textContent = session.user.email;
      byId("avatar").textContent = session.user.email.slice(0, 1).toUpperCase();
      if (!session.storageConfigured) {
        elements.app.classList.add("storage-disabled");
        document.querySelector(".sidebar").hidden = true;
        document.querySelector(".topbar").hidden = true;
        elements.loading.hidden = true;
          const missing = session.storageSetupMissing || ["DATA_ENCRYPTION_KEY"];
          setNotice(`Encrypted storage is not configured. Set ${missing.join(", ")} before adding family data.`, "warning");
        elements.content.hidden = false;
        elements.content.innerHTML = `<section class="page-heading"><p class="eyebrow">HOUSEHOLD WORKSPACE</p><h1>Your portfolio, together.</h1><p class="page-subtitle">Secure storage must be configured before this dashboard can display or save family investment data. Missing: ${escapeHtml(missing.join(", ") || "DATA_ENCRYPTION_KEY")}.</p></section>`;
        return;
      }
      await loadDashboard();
    } else {
      const message = session.googleConfigured
        ? "Sign in with an authorized family Google account to open your private dashboard."
        : "Google sign-in is not configured for this app yet.";
      showSignIn(message, session);
    }
    if (params.has("auth") || params.has("setup")) history.replaceState(null, "", "/");
  } catch {
    showSignIn("The tracker server is unavailable. Start the server and reload this page.");
  }
}

async function loadDashboard() {
  elements.loading.hidden = false;
  elements.content.hidden = true;
  try {
    state.dashboard = await api("/api/dashboard");
    elements.loading.hidden = true;
    elements.content.hidden = false;
    renderScreen();
    return true;
  } catch (error) {
    if (state.session?.authenticated) {
      setNotice(error.message, "error");
      elements.content.innerHTML = `<section class="page-heading"><p class="eyebrow">HOUSEHOLD WORKSPACE</p><h1>Portfolio unavailable.</h1><p class="page-subtitle">${escapeHtml(error.message)}</p><button class="button button-secondary" type="button" data-action="retry-dashboard">Try again</button></section>`;
      elements.content.hidden = false;
    }
    elements.loading.hidden = true;
    return false;
  }
}

function summaryCard(label, value, note, icon, tone = "") {
  return `<article class="summary-card ${tone}">
    <div class="summary-top"><span>${label}</span><span class="summary-icon">${icon}</span></div>
    <strong>${value}</strong><small>${note}</small>
  </article>`;
}

function emptyPanel(title, detail, action = "") {
  return `<div class="empty-panel"><span class="empty-mark">◌</span><strong>${title}</strong><p>${detail}</p>${action}</div>`;
}

function renderAllocation(allocation) {
  if (!allocation.length) return emptyPanel("No investments yet", "Your household allocation will take shape as you add holdings.");
  const colors = ["#4c7df0", "#3bb89d", "#aa86ee", "#efa85d", "#e77383", "#4ca8ce", "#8391a9", "#d0b550", "#70b77d"];
  let cursor = 0;
  const stops = allocation.map((item, index) => {
    const start = cursor;
    cursor += item.percentage;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  }).join(", ");
  return `<div class="allocation-layout">
    <div class="allocation-donut" style="background:conic-gradient(${stops})"><div><strong>${allocation.length}</strong><span>categories</span></div></div>
    <div class="allocation-legend">${allocation.map((item, index) => `<div class="legend-row"><i style="--legend-color:${colors[index % colors.length]}"></i><span>${escapeHtml(item.productType)}</span><strong>${Math.round(item.percentage)}%</strong></div>`).join("")}</div>
  </div>`;
}

function renderProjectionChart(projections, baseValue) {
  const values = [baseValue, ...projections.map((item) => item.value)];
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = 26 + index * 155;
    const y = 116 - value / max * 95;
    return `${x},${y}`;
  }).join(" ");
  const labels = ["Today", ...projections.map((item) => `${item.years} yr`)];
  return `<svg class="projection-chart" viewBox="0 0 665 145" role="img" aria-label="Illustrative portfolio projection chart">
    <line x1="20" y1="120" x2="645" y2="120" class="chart-axis"></line>
    <polyline points="${points}" class="chart-line"></polyline>
    ${values.map((value, index) => {
      const x = 26 + index * 155;
      const y = 116 - value / max * 95;
      return `<circle cx="${x}" cy="${y}" r="4" class="chart-point"></circle><text x="${x}" y="139" text-anchor="middle" class="chart-label">${labels[index]}</text>`;
    }).join("")}
  </svg>`;
}

function holdingsTable(holdings, compact = false) {
  if (!holdings.length) return emptyPanel("Your portfolio starts here", "Add your family's first investment to see its value, cost and returns.", '<button class="button button-primary" type="button" data-action="add-holding">＋ Add investment</button>');
  const shown = compact ? holdings.slice(0, 5) : holdings;
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Investment</th><th>Owner</th><th>Invested</th><th>Current value</th><th>Unrealized</th><th>Holding period</th>${compact ? "" : "<th>Price</th><th></th>"}</tr></thead>
    <tbody>${shown.map((holding) => {
      const returnClass = holding.unrealized > 0 ? "positive" : holding.unrealized < 0 ? "negative" : "";
      const status = holding.units <= 1e-8
        ? "Closed"
        : holding.shortTermUnits > 0 && holding.longTermUnits > 0
          ? "Mixed"
          : holding.longTermUnits
            ? "Long-held"
            : "Short-held";
      return `<tr>
        <td><span class="holding-name">${escapeHtml(holding.name)}</span><small>${escapeHtml(holding.productType)}${holding.symbol ? ` · ${escapeHtml(holding.symbol)}` : ""}</small></td>
        <td><span class="member-chip"><i>${escapeHtml(memberLabel(holding.ownerEmail).slice(0, 1).toUpperCase())}</i>${escapeHtml(memberLabel(holding.ownerEmail))}</span></td>
        <td>${money(holding.costBasis)}</td>
        <td>${holding.currentValue === null ? '<span class="muted">Price unavailable</span>' : money(holding.currentValue)}${holding.currentValue !== null ? `<small>${number(holding.units)} units</small>` : ""}</td>
        <td class="${returnClass}">${holding.unrealized === null ? "—" : money(holding.unrealized)}${holding.unrealized !== null && holding.costBasis ? `<small>${((holding.unrealized / holding.costBasis) * 100).toFixed(1)}%</small>` : ""}</td>
        <td><span class="term-chip ${status === "Long-held" ? "term-long" : status === "Mixed" ? "term-mixed" : status === "Closed" ? "term-closed" : "term-short"}">${status}</span><small>${holding.oldestDays === null ? "—" : `${holding.oldestDays} days`} · indicative</small></td>
        ${compact ? "" : `<td>${holding.currentPrice === null ? "—" : money(holding.currentPrice, { decimals: 2 })}<small>${holding.priceUpdatedAt ? `${escapeHtml(holding.priceSource || "manual")} · ${escapeHtml(new Date(holding.priceUpdatedAt).toLocaleDateString("en-IN"))}` : "No price update"}</small></td>
          <td><button class="icon-button" type="button" title="Edit investment details" aria-label="Edit ${escapeHtml(holding.name)}" data-action="edit-holding" data-id="${escapeHtml(holding.id)}">✎</button><button class="icon-button" type="button" title="Update price" aria-label="Update price for ${escapeHtml(holding.name)}" data-action="edit-price" data-id="${escapeHtml(holding.id)}">↻</button></td>`}
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function reminderCards(reminders) {
  if (!reminders.length) return emptyPanel("Nothing due soon", "Maturity and interest dates will appear here when you add fixed-income investments.");
  return `<div class="reminder-list">${reminders.map((item) => `
    <article class="reminder-card ${item.overdue ? "reminder-overdue" : ""}">
      <span class="reminder-icon">${item.kind === "maturity" ? "◷" : "₹"}</span>
      <span class="reminder-copy"><strong>${escapeHtml(item.name)}</strong><small>${item.kind === "maturity" ? "Maturity" : "Interest payment"} · ${formatDate(item.date)}</small></span>
      <span class="reminder-status">${escapeHtml(item.message)}</span>
    </article>`).join("")}</div>`;
}

function transactionRows(items) {
  if (!items.length) return '<tr><td class="table-empty" colspan="5">No transactions recorded yet.</td></tr>';
  return items.map((item) => `<tr>
    <td><span class="transaction-type type-${item.type.toLowerCase()}">${escapeHtml(item.type)}</span></td>
    <td><span class="holding-name">${escapeHtml(item.holdingName || "Investment")}</span><small>${escapeHtml(item.notes || "")}</small></td>
    <td>${formatDate(item.date, { short: true })}</td>
    <td>${item.quantity === null ? "—" : number(item.quantity)}${item.price === null ? "" : ` × ${money(item.price, { decimals: 2 })}`}</td>
    <td class="amount-cell">${money(item.amount)}</td>
  </tr>`).join("");
}

function overviewScreen() {
  const data = state.dashboard;
  const { summary, settings } = data;
  const returnNote = summary.grossInvested
    ? `${number(summary.returnPct, 1)}% return on recorded buys · indicative`
    : "Add positions to calculate returns";
  const notice = state.session.marketDataConfigured
    ? "Refresh uses the configured adapter for identified securities and AMFI's latest published mutual-fund NAVs"
    : "NSE closing prices and AMFI-published mutual-fund NAVs are available on demand; bond prices need an adapter or manual entry";
  return `<section class="page-heading page-heading-row">
    <div><p class="eyebrow">YOUR FAMILY'S FINANCIAL PICTURE</p><h1>Good to see you, ${escapeHtml(memberLabel(state.session.user.email))}.</h1><p class="page-subtitle">A shared view of what's invested, what's growing and what's coming up.</p></div>
    <span class="date-pill"><i></i> Updated ${formatDate(data.asOf)}</span>
  </section>
  <section class="summary-grid">
    ${summaryCard("Portfolio value", money(summary.totalValue), `${summary.valuedCount} priced ${summary.valuedCount === 1 ? "holding" : "holdings"}`, "↗")}
    ${summaryCard("Invested", money(summary.totalCost), `${summary.holdingCount} active ${summary.holdingCount === 1 ? "position" : "positions"}`, "▤", "card-blue")}
    ${summaryCard("Unrealized return", money(summary.unrealized), returnNote, "⌁", summary.unrealized >= 0 ? "card-green" : "card-red")}
    ${summaryCard("Realized + income", money(summary.realized + summary.dividends), `${summary.realizedPct === null ? "No sales yet" : `${number(summary.realizedPct, 1)}% realized ROI`} · ${money(summary.dividends)} income`, "₹", "card-purple")}
  </section>
  <div class="grid-two overview-grid">
    <section class="panel">
      <div class="panel-heading"><div><p class="eyebrow">WHERE IT'S INVESTED</p><h2>Portfolio allocation</h2></div><button class="text-button" type="button" data-screen="portfolio">View portfolio <span>→</span></button></div>
      ${renderAllocation(data.allocation)}
    </section>
    <section class="panel">
      <div class="panel-heading"><div><p class="eyebrow">KEEP AN EYE ON</p><h2>Upcoming reminders</h2></div><button class="text-button" type="button" data-screen="debt">All reminders <span>→</span></button></div>
      ${reminderCards(data.reminders.slice(0, 3))}
    </section>
  </div>
  <section class="panel portfolio-panel">
    <div class="panel-heading"><div><p class="eyebrow">THE BIG PICTURE</p><h2>Family portfolio</h2></div><button class="button button-secondary button-small" type="button" data-action="add-holding">＋ Add investment</button></div>
    ${holdingsTable(data.holdings, true)}
    ${data.holdings.length > 5 ? '<div class="panel-footer"><button class="text-button" type="button" data-screen="portfolio">See all holdings →</button></div>' : ""}
  </section>
  <div class="grid-two">
    <section class="panel">
      <div class="panel-heading"><div><p class="eyebrow">A SCENARIO, NOT A FORECAST</p><h2>Value projection</h2></div><button class="text-button" type="button" data-screen="planning">Adjust <span>→</span></button></div>
      <div class="projection-summary"><strong>${money(data.projections.at(-1)?.value || summary.totalValue)}</strong><span>in 10 years · ${number(settings.annualReturnPct, 1)}% assumed annual growth</span></div>
      ${renderProjectionChart(data.projections, summary.totalValue)}
      <p class="panel-footnote">Illustrative only · ${money(settings.monthlyContribution)}/mo contribution · no guarantee of returns</p>
    </section>
    <section class="panel">
      <div class="panel-heading"><div><p class="eyebrow">RECENT ACTIVITY</p><h2>Latest transactions</h2></div><button class="text-button" type="button" data-screen="activity">View all <span>→</span></button></div>
      <div class="table-wrap"><table class="data-table activity-table"><thead><tr><th>Type</th><th>Investment</th><th>Date</th><th>Amount</th></tr></thead><tbody>${transactionRows(data.recentTransactions)}</tbody></table></div>
    </section>
  </div>
  <p class="data-caveat"><span>ⓘ</span> ${escapeHtml(notice)}. Values are estimates based on recorded transactions and prices. Holding labels are indicative and not tax advice.</p>`;
}

function portfolioScreen() {
  return `<section class="page-heading page-heading-row"><div><p class="eyebrow">YOUR INVESTMENTS</p><h1>Portfolio</h1><p class="page-subtitle">Positions shared across the authorized household.</p></div>
    <div class="heading-actions"><button class="button button-secondary button-small" type="button" data-action="refresh-prices" title="Refresh NSE equity prices and AMFI mutual-fund NAVs; configured adapter may also price bonds">↻ Refresh prices</button><button class="button button-primary button-small" type="button" data-action="add-holding">＋ Add investment</button></div></section>
    <div class="inline-note"><span>ⓘ</span>${state.session.marketDataConfigured ? "Refresh uses the configured adapter for identified securities plus AMFI-published daily mutual-fund NAVs. Bond adapter coverage depends on your provider." : "Refresh uses NSE end-of-day closes and AMFI-published daily mutual-fund NAVs. Bonds need a configured adapter or manual prices."}</div>
    <section class="panel portfolio-panel">${holdingsTable(state.dashboard.holdings)}</section>
    <p class="data-caveat">ROI uses recorded purchase costs and your latest entered price. Family-level realized returns use FIFO cost basis. Holding period is informational only; tax outcomes depend on current law and your circumstances.</p>`;
}

function debtScreen() {
  const types = ["Fixed deposit", "Bond / NCD", "PPF / EPF", "Debt mutual fund"];
  const holdings = state.dashboard.holdings.filter((holding) => types.includes(holding.productType));
  const rows = holdings.map((holding) => `<tr>
    <td><span class="holding-name">${escapeHtml(holding.name)}</span><small>${escapeHtml(holding.productType)} · ${escapeHtml(memberLabel(holding.ownerEmail))}</small></td>
    <td>${holding.interestRate === null ? "—" : `${number(holding.interestRate, 2)}%`}<small>${escapeHtml(holding.frequency || "Rate not set")}</small></td>
    <td>${formatDate(holding.maturityDate, { short: true })}</td><td>${formatDate(holding.nextInterestDate, { short: true })}</td>
    <td>${holding.currentValue === null ? "—" : money(holding.currentValue)}</td>
    <td><button class="icon-button" type="button" title="Update price" aria-label="Update price for ${escapeHtml(holding.name)}" data-action="edit-price" data-id="${escapeHtml(holding.id)}">↻</button></td>
  </tr>`).join("");
  return `<section class="page-heading page-heading-row"><div><p class="eyebrow">MATURITIES &amp; INTEREST</p><h1>Fixed income</h1><p class="page-subtitle">Track dates and interest for deposits, bonds and other debt products.</p></div><button class="button button-primary button-small" type="button" data-action="add-holding" data-product="Fixed deposit">＋ Add fixed income</button></section>
    <section class="panel reminder-panel"><div class="panel-heading"><div><p class="eyebrow">UP NEXT</p><h2>Maturity &amp; interest reminders</h2></div><span class="count-badge">${state.dashboard.reminders.length}</span></div>${reminderCards(state.dashboard.reminders)}</section>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">FIXED-INCOME HOLDINGS</p><h2>Your debt portfolio</h2></div></div>
      ${holdings.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Investment</th><th>Rate</th><th>Maturity</th><th>Next interest</th><th>Value</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyPanel("No fixed-income holdings", "Add a deposit, bond, PPF/EPF or debt fund to see it here.", '<button class="button button-primary" type="button" data-action="add-holding" data-product="Fixed deposit">＋ Add fixed income</button>')}
    </section><p class="data-caveat">Reminders are calculated from dates you enter and appear within 90 days of maturity or 30 days of interest due. This dashboard does not send push notifications or email.</p>`;
}

function activityScreen() {
  const items = state.dashboard.recentTransactions;
  return `<section class="page-heading page-heading-row"><div><p class="eyebrow">HOUSEHOLD LEDGER</p><h1>Activity</h1><p class="page-subtitle">Buys, sales, bonus units, dividends and interest in one place.</p></div><button class="button button-primary button-small" type="button" data-action="add-transaction">＋ Add transaction</button></section>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">LATEST ENTRIES</p><h2>Transaction history</h2></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Type</th><th>Investment</th><th>Date</th><th>Units / price</th><th>Amount</th></tr></thead><tbody>${items.length ? items.map((item) => transactionRows([item])).join("") : '<tr><td class="table-empty" colspan="5">No transactions recorded yet.</td></tr>'}</tbody></table></div>
    </section><p class="data-caveat">Sales are matched against purchase lots using FIFO cost basis. Dividends and interest are recorded as income; bonus units add quantity at zero acquisition cost. This is a household record, not a tax filing.</p>`;
}

function planningScreen() {
  const { settings, projections, summary } = state.dashboard;
  return `<section class="page-heading"><p class="eyebrow">LONG-TERM VIEW</p><h1>Plan a few scenarios.</h1><p class="page-subtitle">Illustrations based on your current priced portfolio, an assumed annual return and optional monthly contributions.</p></section>
    <div class="grid-two planning-grid"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">YOUR ASSUMPTIONS</p><h2>Projection inputs</h2></div></div>
      <form id="settings-form" class="form-grid">
        <label>Assumed annual growth (%)<input name="annualReturnPct" type="number" min="0" max="30" step="0.1" value="${settings.annualReturnPct}" required><small>Illustrative range: 0–30%; not a return forecast.</small></label>
        <label>Monthly contribution (₹)<input name="monthlyContribution" type="number" min="0" max="100000000" step="1000" value="${settings.monthlyContribution}" required><small>Assumed to continue unchanged for every projected month.</small></label>
        <div class="form-actions"><button class="button button-primary" type="submit">Save assumptions</button></div>
      </form>
    </section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">ILLUSTRATIVE OUTCOMES</p><h2>Portfolio value scenarios</h2></div></div>
      <div class="projection-list"><div><span>Current priced value</span><strong>${money(summary.totalValue)}</strong></div>${projections.map((item) => `<div><span>In ${item.years} ${item.years === 1 ? "year" : "years"}</span><strong>${money(item.value)}</strong></div>`).join("")}</div>
      <div class="projection-foot"><span class="projection-dot"></span> Assumed annual growth: ${number(settings.annualReturnPct, 1)}% <span class="projection-separator">·</span> Monthly contribution: ${money(settings.monthlyContribution)}</div>
    </section></div>
    <div class="notice notice-warning planning-warning"><strong>Important:</strong> Projections use a constant monthly compounding rate and assume contributions at month end. They exclude taxes, fees, inflation and market volatility. They are mathematical illustrations only—not investment advice or a promise of performance.</div>`;
}

function toolsScreen() {
  return `<section class="page-heading"><p class="eyebrow">YOUR DATA, YOURS TO MANAGE</p><h1>Import &amp; export</h1><p class="page-subtitle">Use the styled, multi-tab Excel workbook for guided entry, or continue importing CSV files.</p></section>
    <div class="grid-two tools-grid">
      <section class="panel"><div class="panel-heading"><div><p class="eyebrow">BULK ADD</p><h2>Import investments</h2></div><span class="tool-icon">⇧</span></div>
        <p class="panel-description">The styled Excel template has asset-class tabs, a Read me sheet, a field guide, dropdowns and protected maturity formulas. Each imported row becomes an opening BUY position.</p>
        <div class="tool-actions"><button class="button button-secondary" type="button" data-action="download-template">Download Excel template</button><label class="button button-primary file-label">Choose Excel or CSV<input id="holdings-import" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden></label></div>
        <p class="tool-small">Enter a purchase/start date and tenor to calculate maturity; otherwise enter a maturity date directly. Same-name investments stay separate. Reference numbers distinguish repeated records; rows without one remain separate.</p>
        <p class="tool-small">IFSC lookup fills bank name/address in forms and imports using an online public directory; if lookup is unavailable, the code is kept and a warning is shown.</p>
        <div class="tool-actions transaction-import-actions"><button class="button button-secondary" type="button" data-action="download-transactions-template">Transaction template</button><label class="button button-secondary file-label">Import transactions<input id="transactions-import" type="file" accept=".csv,text/csv" hidden></label></div>
        <p class="tool-small">Transaction rows require a holdingId (available in the transaction export). Imports reject duplicate events and invalid sale quantities.</p>
      </section>
      <section class="panel"><div class="panel-heading"><div><p class="eyebrow">KEEP A COPY</p><h2>Export household data</h2></div><span class="tool-icon">⇩</span></div>
        <p class="panel-description">Download current positions and the full transaction ledger as separate CSV files. These files contain private portfolio information—store them carefully.</p>
        <div class="tool-actions"><button class="button button-primary" type="button" data-action="export-data">Export CSV files</button></div>
        <p class="tool-small">Exports are generated from the encrypted server-side records. Avoid sharing them outside your household.</p>
      </section>
    </div>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">SUPPORTED PRODUCTS</p><h2>One family, many kinds of investments</h2></div></div>
      <div class="product-list">${PRODUCT_TYPES.map((type, index) => `<span><i>${["↗", "▤", "₹", "◷", "◇", "⌂", "⌁", "◉", "＋"][index]}</i>${type}</span>`).join("")}</div>
      <p class="data-caveat">Never enter passwords, PINs, PAN or Aadhaar. Imported account, policy and wallet details are encrypted at rest but shared with authorized family members; leave optional fields blank unless needed.</p>
    </section>`;
}

function renderScreen() {
  if (!state.dashboard) return;
  const renderers = {
    overview: overviewScreen,
    portfolio: portfolioScreen,
    debt: debtScreen,
    activity: activityScreen,
    planning: planningScreen,
    tools: toolsScreen
  };
  state.screen = renderers[state.screen] ? state.screen : "overview";
  elements.title.textContent = screenTitles[state.screen];
  elements.content.innerHTML = renderers[state.screen]();
  elements.content.hidden = false;
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === state.screen);
  });
  byId("portfolio-nav-count").textContent = state.dashboard.holdings.length;
}

function memberOptions(selected) {
  return (state.dashboard?.members || [state.session.user.email]).map((email) =>
    `<option value="${escapeHtml(email)}" ${email === selected ? "selected" : ""}>${escapeHtml(memberLabel(email))} · ${escapeHtml(email)}</option>`
  ).join("");
}

function frequencyOptions(selected = "") {
  const values = [...new Set([...(selected && !INTEREST_FREQUENCIES.includes(selected) ? [selected] : []), ...INTEREST_FREQUENCIES])];
  return `<option value="">Not specified</option>${values.map((value) =>
    `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`
  ).join("")}`;
}

function maturityFromTenor(startDate, years, months, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) return "";
  const [year, month, day] = startDate.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 + years * 12 + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const maturity = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay) + days));
  return Number.isFinite(maturity.getTime()) && maturity.getUTCFullYear() <= 9999
    ? maturity.toISOString().slice(0, 10)
    : "";
}

function refreshMaturityFields(form) {
  const maturity = form?.elements.namedItem("maturityDate");
  if (!maturity) return;
  const fields = ["tenorYears", "tenorMonths", "tenorDays"].map((name) => form.elements.namedItem(name));
  const values = fields.map((field) => field.value === "" ? 0 : Number(field.value));
  const invalidTenor = fields.some((field, index) =>
    field.value !== "" && (!Number.isInteger(values[index]) || values[index] < 0 || values[index] > Number(field.max))
  );
  const hasTenor = values.some((value) => value > 0);
  const hint = form.querySelector("#maturity-hint");

  if (invalidTenor) {
    maturity.value = "";
    maturity.readOnly = true;
    if (hint) hint.textContent = "Tenor must use whole, non-negative years, months and days.";
    return;
  }
  if (hasTenor) {
    maturity.readOnly = true;
    maturity.dataset.calculated = "true";
    maturity.value = maturityFromTenor(form.elements.namedItem("purchaseDate").value, ...values);
    if (hint) hint.textContent = maturity.value
      ? "Calculated from the purchase / start date and tenor. This date cannot be edited while tenor is provided."
      : "Enter a valid purchase / start date to calculate maturity.";
    return;
  }
  if (maturity.dataset.calculated === "true") {
    maturity.value = "";
    delete maturity.dataset.calculated;
  }
  maturity.readOnly = false;
  if (hint) hint.textContent = "Enter a tenor to calculate maturity from the purchase date, or leave tenor blank to enter maturity directly.";
}

function scheduleIfscLookup(form) {
  clearTimeout(ifscLookupTimer);
  ifscLookupController?.abort();
  ifscLookupController = null;
  const codeInput = form.elements.namedItem("bankIfsc");
  const bankName = form.elements.namedItem("bankName");
  const bankAddress = form.elements.namedItem("bankAddress");
  const status = form.querySelector("#bank-lookup-status");
  const submit = form.querySelector('[type="submit"]');
  const code = codeInput.value.trim().toUpperCase();
  codeInput.value = code;
  bankName.value = "";
  bankAddress.value = "";
  form.dataset.ifscLookupPending = "false";
  if (submit) submit.disabled = false;

  if (!code) {
    status.textContent = "Enter an IFSC code to look up its bank and branch address. Internet access is required.";
    return;
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
    status.textContent = code.length < 11 ? "Enter the complete 11-character IFSC code." : "Check the IFSC format and try again.";
    return;
  }

  status.textContent = "Looking up bank and branch details…";
  form.dataset.ifscLookupPending = "true";
  if (submit) submit.disabled = true;
  ifscLookupTimer = window.setTimeout(async () => {
    const controller = new AbortController();
    ifscLookupController = controller;
    try {
      const details = await api(`/api/banks/ifsc/${encodeURIComponent(code)}`, { signal: controller.signal });
      if (!form.isConnected || codeInput.value !== code) return;
      bankName.value = details.bankName;
      bankAddress.value = details.bankAddress;
      status.textContent = "Bank and branch details found.";
    } catch (error) {
      if (form.isConnected && codeInput.value === code) status.textContent = error.message;
    } finally {
      if (ifscLookupController === controller) {
        ifscLookupController = null;
        if (form.isConnected && codeInput.value === code) {
          form.dataset.ifscLookupPending = "false";
          if (submit) submit.disabled = false;
        }
      }
    }
  }, 350);
}

function openModal(title, content) {
  elements.modalContent.innerHTML = `<div class="modal-heading"><div><p class="eyebrow">HOUSEHOLD PORTFOLIO</p><h2>${title}</h2></div><button class="icon-button modal-close" type="button" aria-label="Close dialog">×</button></div>${content}`;
  elements.modal.showModal();
}

function equitySearchFields() {
  return `<label class="field-wide equity-search-field" hidden>Search NSE listed shares<input class="equity-search-input" type="search" autocomplete="off" placeholder="Type at least 3 letters of a company or symbol"><small>Searches NSE's official EQ-series list. Select a result to fill the investment name and symbol.</small></label>
    <div class="field-wide equity-search-results" role="listbox" aria-live="polite" hidden></div>`;
}

function mutualFundSearchFields() {
  return `<label class="field-wide mutual-fund-search-field" hidden>Search AMFI mutual-fund schemes<input class="mutual-fund-search-input" type="search" autocomplete="off" placeholder="Type at least 3 letters of a scheme"><small>Searches AMFI's published NAV list. Select a scheme to fill the required scheme name and code.</small></label>
    <div class="field-wide equity-search-results mutual-fund-search-results" role="listbox" aria-live="polite" hidden></div>`;
}

function updateProductSearchVisibility(form) {
  const productType = form.elements.productType.value;
  const equityField = form.querySelector(".equity-search-field");
  const equityResults = form.querySelector(".equity-search-results:not(.mutual-fund-search-results)");
  const equitySearch = form.querySelector(".equity-search-input");
  const fundField = form.querySelector(".mutual-fund-search-field");
  const fundResults = form.querySelector(".mutual-fund-search-results");
  const fundSearch = form.querySelector(".mutual-fund-search-input");
  const identifier = form.elements.symbol;
  const isMutualFund = MUTUAL_FUND_TYPES.includes(productType);
  const nameLabel = form.querySelector(".investment-name-label");
  const identifierLabel = form.querySelector(".price-identifier-label");
  const identifierNote = form.querySelector(".price-identifier-note");

  if (nameLabel) nameLabel.textContent = isMutualFund ? "Scheme name *" : "Investment name *";
  if (identifierLabel) {
    identifierLabel.textContent = isMutualFund
      ? "AMFI scheme code *"
      : productType === "Listed equity"
        ? "NSE symbol"
        : productType === "Bond / NCD"
          ? "Bond ISIN"
          : "Price identifier";
  }
  if (identifierNote) {
    identifierNote.textContent = isMutualFund
      ? ""
      : productType === "Listed equity"
        ? "(for NSE price updates)"
        : productType === "Bond / NCD"
          ? "(for adapter pricing)"
          : "(optional)";
  }

  if (equityField && equityResults && equitySearch) {
    const visible = productType === "Listed equity";
    equityField.hidden = !visible;
    if (!visible) {
      if (equitySearchTimer) clearTimeout(equitySearchTimer);
      equitySearchSequence += 1;
      equitySearch.value = "";
      equityResults.innerHTML = "";
      equityResults.hidden = true;
    }
  }
  if (fundField && fundResults && fundSearch) {
    const visible = MUTUAL_FUND_TYPES.includes(productType);
    fundField.hidden = !visible;
    if (!visible) {
      if (mutualFundSearchTimer) clearTimeout(mutualFundSearchTimer);
      mutualFundSearchSequence += 1;
      fundSearch.value = "";
      fundResults.innerHTML = "";
      fundResults.hidden = true;
    }
  }
  if (identifier) {
    identifier.required = isMutualFund;
    identifier.placeholder = productType === "Listed equity"
      ? "e.g. HDFCBANK"
      : isMutualFund
        ? "AMFI scheme code, e.g. 135762"
        : productType === "Bond / NCD"
          ? "ISIN, e.g. INE..."
          : "Optional";
  }
}

function showMutualFundSearchResults(form, items) {
  const results = form.querySelector(".mutual-fund-search-results");
  if (!results) return;
  results.innerHTML = items.length
    ? items.map((item) => `<button class="equity-search-result" type="button" role="option" data-action="select-mutual-fund" data-scheme-code="${escapeHtml(item.schemeCode)}" data-name="${escapeHtml(item.schemeName)}" data-plan="${escapeHtml(item.plan)}" data-option="${escapeHtml(item.option)}"><strong>${escapeHtml(item.schemeCode)} · ₹${number(item.nav, 4)}</strong><span>${escapeHtml(item.schemeName)} · ${escapeHtml(item.plan)} · ${escapeHtml(item.option)} · ${formatDate(item.asOf)}</span></button>`).join("")
    : '<p class="equity-search-message">No matching AMFI mutual-fund schemes found.</p>';
  results.hidden = false;
}

function scheduleMutualFundSearch(input) {
  if (mutualFundSearchTimer) clearTimeout(mutualFundSearchTimer);
  const form = input.form;
  const results = form.querySelector(".mutual-fund-search-results");
  const query = input.value.trim();
  const sequence = ++mutualFundSearchSequence;
  if (query.length < 3) {
    results.innerHTML = query ? '<p class="equity-search-message">Type at least 3 letters to search.</p>' : "";
    results.hidden = !query;
    return;
  }
  results.innerHTML = '<p class="equity-search-message">Searching AMFI NAV list…</p>';
  results.hidden = false;
  mutualFundSearchTimer = setTimeout(async () => {
    try {
      const { items } = await api(`/api/mutual-funds/search?q=${encodeURIComponent(query)}`);
      if (!form.isConnected || input.value.trim() !== query || sequence !== mutualFundSearchSequence) return;
      showMutualFundSearchResults(form, items);
    } catch (error) {
      if (!form.isConnected || sequence !== mutualFundSearchSequence) return;
      results.innerHTML = `<p class="equity-search-message">${escapeHtml(error.message)}</p>`;
      results.hidden = false;
    }
  }, 300);
}

function showEquitySearchResults(form, items) {
  const results = form.querySelector(".equity-search-results:not(.mutual-fund-search-results)");
  if (!results) return;
  results.innerHTML = items.length
    ? items.map((item) => `<button class="equity-search-result" type="button" role="option" data-action="select-equity" data-symbol="${escapeHtml(item.symbol)}" data-name="${escapeHtml(item.name)}"><strong>${escapeHtml(item.symbol)}</strong><span>${escapeHtml(item.name)}</span></button>`).join("")
    : '<p class="equity-search-message">No matching NSE-listed shares found.</p>';
  results.hidden = false;
}

function scheduleEquitySearch(input) {
  if (equitySearchTimer) clearTimeout(equitySearchTimer);
  const form = input.form;
  const results = form.querySelector(".equity-search-results:not(.mutual-fund-search-results)");
  const query = input.value.trim();
  const sequence = ++equitySearchSequence;
  if (query.length < 3) {
    results.innerHTML = query ? '<p class="equity-search-message">Type at least 3 letters to search.</p>' : "";
    results.hidden = !query;
    return;
  }
  results.innerHTML = '<p class="equity-search-message">Searching NSE equity list…</p>';
  results.hidden = false;
  equitySearchTimer = setTimeout(async () => {
    try {
      const { items } = await api(`/api/equities/search?q=${encodeURIComponent(query)}`);
      if (!form.isConnected || input.value.trim() !== query || sequence !== equitySearchSequence) return;
      showEquitySearchResults(form, items);
    } catch (error) {
      if (!form.isConnected || sequence !== equitySearchSequence) return;
      results.innerHTML = `<p class="equity-search-message">${escapeHtml(error.message)}</p>`;
      results.hidden = false;
    }
  }, 300);
}

function openHoldingForm(product = "") {
  const productOptions = PRODUCT_TYPES.map((value) => `<option ${product === value ? "selected" : ""}>${value}</option>`).join("");
  openModal("Add investment", `<form id="holding-form" class="form-grid">
    <label>Family member<select name="ownerEmail" required>${memberOptions(state.session.user.email)}</select></label>
    <label>Product type<select class="holding-product-type" name="productType" required>${productOptions}</select></label>
    ${equitySearchFields()}
    ${mutualFundSearchFields()}
    <label class="field-wide"><span class="investment-name-label">Investment name *</span><input name="name" maxlength="100" placeholder="e.g. HDFC Bank or SBI Fixed Deposit" required></label>
    <label><span class="price-identifier-label">Price identifier</span> <span class="optional price-identifier-note">(optional)</span><input name="symbol" maxlength="20" placeholder="e.g. HDFCBANK"></label>
    <label>Broker / institution<input name="broker" maxlength="80" placeholder="Optional"></label>
    <label class="field-wide">Reference number <span class="optional">(optional; distinguishes separate investments)</span><input name="referenceNo" maxlength="100" placeholder="e.g. deposit reference or policy number"></label>
    <div class="form-divider">OPENING POSITION</div>
    <label>Purchase / start date<input class="tenor-start" name="purchaseDate" type="date" value="${dateToday}" required></label>
    <label>Units / quantity<input name="quantity" type="number" min="0.000001" step="any" required></label>
    <label>Purchase price per unit (₹)<input name="purchasePrice" type="number" min="0" step="any" required></label>
    <label>Current price per unit (₹)<input name="currentPrice" type="number" min="0" step="any" placeholder="Optional"></label>
    <div class="form-divider">MATURITY &amp; INTEREST <span class="optional">Optional</span></div>
    <label>Tenor years<input class="tenor-input" name="tenorYears" type="number" min="0" max="100" step="1" placeholder="Optional"></label>
    <label>Tenor months<input class="tenor-input" name="tenorMonths" type="number" min="0" max="1200" step="1" placeholder="Optional"></label>
    <label>Tenor days<input class="tenor-input" name="tenorDays" type="number" min="0" max="36525" step="1" placeholder="Optional"></label>
    <label>Maturity date<input name="maturityDate" type="date"></label>
    <p id="maturity-hint" class="form-hint field-wide">Enter a tenor to calculate maturity from the purchase date, or leave tenor blank to enter maturity directly.</p>
    <label>Interest rate (%)<input name="interestRate" type="number" min="0" max="100" step="0.01" placeholder="Optional"></label>
    <label>Next interest date<input name="nextInterestDate" type="date"></label>
    <label>Interest frequency<select name="frequency">${frequencyOptions()}</select></label>
    <div class="form-divider">BANK BRANCH <span class="optional">Optional</span></div>
    <label>IFSC code<input class="bank-ifsc" name="bankIfsc" maxlength="11" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" autocapitalize="characters" autocomplete="off" placeholder="e.g. HDFC0001234"></label>
    <label>Bank name<input name="bankName" maxlength="100" readonly></label>
    <label class="field-wide">Branch address<input name="bankAddress" maxlength="300" readonly></label>
    <p id="bank-lookup-status" class="form-hint field-wide bank-lookup-status" aria-live="polite">Enter an IFSC code to look up its bank and branch address. Internet access is required.</p>
    <p class="form-hint field-wide">Add more buys, sales, dividends or bonus units later from Activity. Do not enter PAN, Aadhaar, bank or demat numbers.</p>
    <div class="form-actions field-wide"><button class="button button-secondary modal-cancel" type="button">Cancel</button><button class="button button-primary" type="submit">Save investment</button></div>
  </form>`);
  const form = byId("holding-form");
  refreshMaturityFields(form);
  updateProductSearchVisibility(form);
}

function openEditHoldingForm(holdingId) {
  const holding = state.dashboard.holdings.find((item) => item.id === holdingId);
  if (!holding) return;
  const productOptions = PRODUCT_TYPES.map((value) => `<option ${holding.productType === value ? "selected" : ""}>${value}</option>`).join("");
  openModal("Edit investment details", `<form id="edit-holding-form" class="form-grid">
    <input type="hidden" name="holdingId" value="${escapeHtml(holding.id)}">
    <input type="hidden" name="purchaseDate" value="${escapeHtml(holding.purchaseDate || "")}">
    <label>Family member<select name="ownerEmail" required>${memberOptions(holding.ownerEmail)}</select></label>
    <label>Product type<select class="holding-product-type" name="productType" required>${productOptions}</select></label>
    ${equitySearchFields()}
    ${mutualFundSearchFields()}
    <label class="field-wide"><span class="investment-name-label">Investment name *</span><input name="name" maxlength="100" value="${escapeHtml(holding.name)}" required></label>
    <label><span class="price-identifier-label">Price identifier</span> <span class="optional price-identifier-note">(optional)</span><input name="symbol" maxlength="20" value="${escapeHtml(holding.symbol || "")}" placeholder="Optional"></label>
    <label>Broker / institution<input name="broker" maxlength="80" value="${escapeHtml(holding.broker || "")}" placeholder="Optional"></label>
    <label class="field-wide">Reference number <span class="optional">(optional; distinguishes separate investments)</span><input name="referenceNo" maxlength="100" value="${escapeHtml(holding.importDetails?.["Reference no"] || "")}" placeholder="e.g. deposit reference or policy number"></label>
    <div class="form-divider">MATURITY &amp; INTEREST <span class="optional">Optional</span></div>
    <label>Tenor years<input class="tenor-input" name="tenorYears" type="number" min="0" max="100" step="1" value="${holding.tenorYears ?? ""}" placeholder="Optional"></label>
    <label>Tenor months<input class="tenor-input" name="tenorMonths" type="number" min="0" max="1200" step="1" value="${holding.tenorMonths ?? ""}" placeholder="Optional"></label>
    <label>Tenor days<input class="tenor-input" name="tenorDays" type="number" min="0" max="36525" step="1" value="${holding.tenorDays ?? ""}" placeholder="Optional"></label>
    <label>Maturity date<input name="maturityDate" type="date" value="${escapeHtml(holding.maturityDate || "")}"></label>
    <p id="maturity-hint" class="form-hint field-wide">Enter a tenor to calculate maturity from the purchase date, or leave tenor blank to enter maturity directly.</p>
    <label>Interest rate (%)<input name="interestRate" type="number" min="0" max="100" step="0.01" value="${holding.interestRate ?? ""}"></label>
    <label>Next interest date<input name="nextInterestDate" type="date" value="${escapeHtml(holding.nextInterestDate || "")}"></label>
    <label>Interest frequency<select name="frequency">${frequencyOptions(holding.frequency || "")}</select></label>
    <div class="form-divider">BANK BRANCH <span class="optional">Optional</span></div>
    <label>IFSC code<input class="bank-ifsc" name="bankIfsc" maxlength="11" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" autocapitalize="characters" autocomplete="off" value="${escapeHtml(holding.bankIfsc || "")}" placeholder="e.g. HDFC0001234"></label>
    <label>Bank name<input name="bankName" maxlength="100" value="${escapeHtml(holding.bankName || "")}" readonly></label>
    <label class="field-wide">Branch address<input name="bankAddress" maxlength="300" value="${escapeHtml(holding.bankAddress || "")}" readonly></label>
    <p id="bank-lookup-status" class="form-hint field-wide bank-lookup-status" aria-live="polite">Changing the IFSC code will refresh its bank and branch address. Internet access is required.</p>
    <div class="form-actions field-wide"><button class="button button-secondary modal-cancel" type="button">Cancel</button><button class="button button-primary" type="submit">Save changes</button></div>
  </form>`);
  const form = byId("edit-holding-form");
  refreshMaturityFields(form);
  updateProductSearchVisibility(form);
}

function openTransactionForm() {
  const holdings = state.dashboard.holdings;
  if (!holdings.length) {
    setNotice("Add an investment first, then record its transactions.", "warning");
    return;
  }
  openModal("Record activity", `<form id="transaction-form" class="form-grid">
    <label class="field-wide">Investment<select name="holdingId" required>${holdings.map((holding) => `<option value="${escapeHtml(holding.id)}">${escapeHtml(holding.name)} · ${escapeHtml(memberLabel(holding.ownerEmail))}</option>`).join("")}</select></label>
    <label>Activity type<select name="type" id="transaction-type">${TRANSACTION_TYPES.map((type) => `<option value="${type}">${type === "DIVIDEND" ? "Dividend / interest" : type.charAt(0) + type.slice(1).toLowerCase()}</option>`).join("")}</select></label>
    <label>Date<input name="date" type="date" value="${dateToday}" required></label>
    <label class="transaction-units">Units<input name="quantity" type="number" min="0.000001" step="any" required></label>
    <label class="transaction-price">Price per unit (₹)<input name="price" type="number" min="0" step="any" required></label>
    <label class="transaction-amount" hidden>Amount (₹)<input name="amount" type="number" min="0.01" step="any"></label>
    <label class="field-wide">Notes<input name="notes" maxlength="240" placeholder="Optional"></label>
    <p class="form-hint field-wide">Sales are matched against purchase lots using FIFO. Dividends and interest are recorded as cash income.</p>
    <div class="form-actions field-wide"><button class="button button-secondary modal-cancel" type="button">Cancel</button><button class="button button-primary" type="submit">Save activity</button></div>
  </form>`);
}

function openPriceForm(holdingId) {
  const holding = state.dashboard.holdings.find((item) => item.id === holdingId);
  if (!holding) return;
  openModal("Update price", `<form id="price-form" class="form-grid">
    <input type="hidden" name="holdingId" value="${escapeHtml(holding.id)}">
    <p class="modal-intro field-wide">${escapeHtml(holding.name)}${holding.symbol ? ` · ${escapeHtml(holding.symbol)}` : ""}</p>
    <label class="field-wide">Current price per unit (₹)<input name="price" type="number" min="0" max="10000000" step="any" value="${holding.currentPrice ?? ""}" required></label>
    <p class="form-hint field-wide">Manual entry only. Last updated prices are labeled with their source and date; the app does not claim to show live quotes.</p>
    <div class="form-actions field-wide"><button class="button button-secondary modal-cancel" type="button">Cancel</button><button class="button button-primary" type="submit">Save price</button></div>
  </form>`);
}

async function refreshPrices() {
  try {
    const result = await api("/api/prices/refresh", { method: "PATCH" });
    if (!await loadDashboard()) return;
    if (result.message) {
      setNotice(result.message, "warning");
      return;
    }
    const issues = [];
    if (result.missingSymbols?.length) {
      issues.push(`No equity price found for ${result.missingSymbols.slice(0, 5).join(", ")}${result.missingSymbols.length > 5 ? " and more" : ""}.`);
    }
    if (result.missingSchemeCodes?.length) {
      issues.push(`Add or verify AMFI scheme codes for ${result.missingSchemeCodes.slice(0, 5).join(", ")}${result.missingSchemeCodes.length > 5 ? " and more" : ""}.`);
    }
    if (result.bondNote) issues.push(result.bondNote);
    if (result.failures?.length) issues.push(...result.failures);
    const source = result.source ? ` from ${result.source}` : "";
    const suffix = issues.length ? ` ${issues.join(" ")}` : "";
    setNotice(`${result.updated} holding price(s) updated${source}.${suffix}`, result.updated && !issues.length ? "success" : "warning");
  } catch (error) {
    setNotice(error.message, "error");
  }
}

async function submitForm(form, path, method = "POST", successMessage = "Saved.") {
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api(path, { method, body: Object.fromEntries(new FormData(form)) });
    elements.modal.close();
    if (await loadDashboard()) setNotice(successMessage, "success");
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV must include a header and at least one data row.");
  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, "").toLowerCase());
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || "").trim()])));
}

function downloadCsv(filename, rows) {
  if (!rows.length) {
    setNotice("There is no data to export yet.", "warning");
    return;
  }
  const headers = Object.keys(rows[0]);
  const cell = (value) => {
    let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header]))].map((values) => values.map(cell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadTemplate() {
  try {
    const response = await fetch("/api/import/holdings-template", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Template download failed (HTTP ${response.status}).`);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "investment-holdings-template.xlsx";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Excel template downloaded with asset-class tabs, dropdowns, a field guide and calculated maturity cells.", "success");
  } catch (error) {
    setNotice(error.message, "error");
  }
}

async function importHoldings(file) {
  if (!file) return;
  const isWorkbook = /\.xlsx$/i.test(file.name);
  if (file.size > (isWorkbook ? 2_000_000 : 1_000_000)) {
    setNotice(isWorkbook ? "Excel workbooks must be 2 MB or smaller." : "CSV must be 1 MB or smaller.", "error");
    return;
  }
  try {
    let result;
    if (isWorkbook) {
      const response = await fetch("/api/import/holdings-workbook", {
        method: "POST",
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "x-csrf-token": state.csrfToken || ""
        },
        body: await file.arrayBuffer(),
        credentials: "same-origin"
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        showSignIn("Your sign-in has expired. Sign in again to continue.");
        throw new Error(payload.error || "Please sign in again.");
      }
      if (!response.ok) throw new Error(payload.error || `Workbook import failed (HTTP ${response.status}).`);
      result = payload;
    } else {
      const rows = parseCsv(await file.text());
      const mapped = rows.map((row) => ({
        id: row.id,
        ownerEmail: row.owneremail,
        productType: row.producttype,
        name: row.name,
        symbol: row.symbol,
        broker: row.broker,
        purchaseDate: row.purchasedate,
        quantity: row.quantity,
        purchasePrice: row.purchaseprice,
        currentPrice: row.currentprice,
        priceSource: row.pricesource,
        priceUpdatedAt: row.priceupdatedat,
        maturityDate: row.maturitydate,
        tenorYears: row.tenoryears,
        tenorMonths: row.tenormonths,
        tenorDays: row.tenordays,
        interestRate: row.interestrate,
        nextInterestDate: row.nextinterestdate,
        frequency: row.frequency,
        bankIfsc: row.bankifsc,
        bankName: row.bankname,
        bankAddress: row.bankaddress,
        importDetails: row.importdetails ? JSON.parse(row.importdetails) : null
      }));
      result = await api("/api/import/holdings", { method: "POST", body: { rows: mapped } });
    }
    const lookupIssues = (result.bankLookup?.failed || 0) + (result.bankLookup?.skipped || 0);
    const lookupNote = lookupIssues
      ? ` Bank details could not be filled for ${lookupIssues} IFSC code(s); the IFSC values were imported.`
      : "";
    if (await loadDashboard()) {
      setNotice(`Imported ${result.added} investment(s); skipped ${result.duplicates} row(s) with an existing holding ID or reference number.${lookupNote}`, lookupIssues ? "warning" : "success");
    }
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    byId("holdings-import").value = "";
  }
}

async function exportData() {
  try {
    const data = await api("/api/export");
    downloadCsv("household-investments.csv", data.holdings);
    downloadCsv("household-transactions.csv", data.transactions);
    setNotice("Exported current holdings and transaction history as separate Excel-compatible CSV files.", "success");
  } catch (error) {
    setNotice(error.message, "error");
  }
}

function refreshTransactionFields() {
  const type = byId("transaction-type")?.value;
  const dividend = type === "DIVIDEND";
  document.querySelectorAll(".transaction-units,.transaction-price").forEach((element) => { element.hidden = dividend || type === "BONUS" && element.classList.contains("transaction-price"); });
  const amount = document.querySelector(".transaction-amount");
  if (amount) {
    amount.hidden = !dividend;
    amount.querySelector("input").required = dividend;
  }
  const quantity = document.querySelector(".transaction-units input");
  if (quantity) quantity.required = !dividend;
  const price = document.querySelector('.transaction-price input');
  if (price) price.required = !dividend && type !== "BONUS";
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-screen]");
  if (nav) {
    state.screen = nav.dataset.screen;
    renderScreen();
    document.querySelector(".sidebar").classList.remove("sidebar-open");
  }
  const action = event.target.closest("[data-action]");
  if (action) {
    if (action.dataset.action === "add-holding") openHoldingForm(action.dataset.product || "");
    if (action.dataset.action === "retry-dashboard") await loadDashboard();
    if (action.dataset.action === "add-transaction") openTransactionForm();
    if (action.dataset.action === "edit-holding") openEditHoldingForm(action.dataset.id);
    if (action.dataset.action === "edit-price") openPriceForm(action.dataset.id);
    if (action.dataset.action === "select-equity") {
      const form = action.closest("form");
      form.elements.name.value = action.dataset.name;
      form.elements.symbol.value = action.dataset.symbol;
      form.querySelector(".equity-search-input").value = `${action.dataset.symbol} — ${action.dataset.name}`;
      form.querySelector(".equity-search-results").hidden = true;
    }
    if (action.dataset.action === "select-mutual-fund") {
      const form = action.closest("form");
      form.elements.name.value = action.dataset.name;
      form.elements.symbol.value = action.dataset.schemeCode;
      form.querySelector(".mutual-fund-search-input").value =
        `${action.dataset.name} — ${action.dataset.plan} — ${action.dataset.option}`;
      form.querySelector(".mutual-fund-search-results").hidden = true;
    }
    if (action.dataset.action === "refresh-prices") await refreshPrices();
    if (action.dataset.action === "download-template") await downloadTemplate();
    if (action.dataset.action === "download-transactions-template") downloadTransactionsTemplate();
    if (action.dataset.action === "export-data") await exportData();
  }
  if (event.target.closest(".modal-close,.modal-cancel")) elements.modal.close();
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if ((form.id === "holding-form" || form.id === "edit-holding-form") && form.dataset.ifscLookupPending === "true") {
    event.preventDefault();
    setNotice("Wait for the IFSC lookup to finish before saving.", "info");
    return;
  }
  if (form.id === "holding-form") {
    event.preventDefault();
    await submitForm(form, "/api/holdings", "POST", "Investment added to your shared portfolio.");
  } else if (form.id === "edit-holding-form") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    await submitForm(form, `/api/holdings/${encodeURIComponent(values.holdingId)}`, "PATCH", "Investment details updated.");
  } else if (form.id === "transaction-form") {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (body.type === "DIVIDEND") {
      delete body.quantity;
      delete body.price;
    } else if (body.type === "BONUS") body.price = 0;
    await submitForm(form, "/api/transactions", "POST", "Activity added to your household ledger.");
  } else if (form.id === "price-form") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    try {
      await api(`/api/holdings/${encodeURIComponent(values.holdingId)}/price`, { method: "PATCH", body: { price: values.price } });
      elements.modal.close();
      if (await loadDashboard()) setNotice("Price updated. Check its timestamp and source before relying on it.", "success");
    } catch (error) {
      setNotice(error.message, "error");
    }
  } else if (form.id === "settings-form") {
    event.preventDefault();
    try {
      await api("/api/settings", { method: "PATCH", body: Object.fromEntries(new FormData(form)) });
      if (await loadDashboard()) setNotice("Planning assumptions saved.", "success");
    } catch (error) {
      setNotice(error.message, "error");
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "holdings-import") importHoldings(event.target.files[0]);
  if (event.target.id === "transactions-import") importTransactions(event.target.files[0]);
  if (event.target.id === "transaction-type") refreshTransactionFields();
  if (event.target.matches(".holding-product-type")) updateProductSearchVisibility(event.target.form);
  if (event.target.matches(".tenor-input,.tenor-start")) refreshMaturityFields(event.target.form);
  if (event.target.matches(".bank-ifsc")) scheduleIfscLookup(event.target.form);
});

document.addEventListener("input", (event) => {
  if (event.target.matches(".equity-search-input")) scheduleEquitySearch(event.target);
  if (event.target.matches(".mutual-fund-search-input")) scheduleMutualFundSearch(event.target);
  if (event.target.matches(".tenor-input,.tenor-start")) refreshMaturityFields(event.target.form);
  if (event.target.matches(".bank-ifsc")) scheduleIfscLookup(event.target.form);
});

byId("signout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    window.location.assign("/");
  }
});
byId("add-investment-top").addEventListener("click", () => openHoldingForm());
byId("mobile-menu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("sidebar-open"));
elements.modal.addEventListener("click", (event) => {
  if (event.target === elements.modal) elements.modal.close();
});

initialize();
