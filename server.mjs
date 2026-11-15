import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./src/load-local-env.mjs";
import { enrichBankDetails, lookupBankByIfsc } from "./src/bank-lookup.mjs";
import {
  addHolding,
  addImportedHoldings,
  addTransaction,
  buildDashboard,
  deleteHoldings,
  exportRows,
  updateHolding,
  updateHoldingPrice,
  updateSettings
} from "./src/investment-domain.mjs";
import { buildHoldingsTemplate, parseHoldingsWorkbook } from "./src/investment-workbook.mjs";
import { EncryptedStore } from "./src/encrypted-store.mjs";
import { AmfiMarketData } from "./src/amfi-market-data.mjs";
import { NseMarketData } from "./src/nse-market-data.mjs";
import { refreshMarketPrices } from "./src/market-price-refresh.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
await loadLocalEnv(resolve(root, ".env"));
const publicRoot = resolve(root, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const appOrigin = new URL(
  process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://${host}:${port}`
).origin;
const allowedEmails = [...new Set((process.env.GOOGLE_ALLOWED_EMAILS || "")
  .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))];
const familyMemberNames = (process.env.FAMILY_MEMBER_NAMES || "")
  .split(",").map((name) => name.trim()).filter(Boolean);
const validEmailList = allowedEmails.every((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
const redirectUri = process.env.GOOGLE_REDIRECT_URI || "";
let redirectUriValid = false;
try {
  const callback = new URL(redirectUri);
  redirectUriValid = callback.origin === appOrigin && callback.pathname === "/auth/google/callback";
} catch {
  redirectUriValid = false;
}
const googleSetupMissing = [
  ...(!process.env.GOOGLE_CLIENT_ID?.trim() ? ["GOOGLE_CLIENT_ID"] : []),
  ...(!process.env.GOOGLE_CLIENT_SECRET?.trim() ? ["GOOGLE_CLIENT_SECRET"] : []),
  ...(!redirectUriValid ? ["GOOGLE_REDIRECT_URI (must match APP_ORIGIN/auth/google/callback)"] : []),
  ...(allowedEmails.length !== 4 || !validEmailList ? ["GOOGLE_ALLOWED_EMAILS (four distinct valid email addresses)"] : [])
];
const googleConfigured = googleSetupMissing.length === 0;
const sessions = new Map();
const pendingStates = new Map();
const sessionTtl = 12 * 60 * 60 * 1000;
const nseMarketData = new NseMarketData();
const amfiMarketData = new AmfiMarketData();
const secureCookie = process.env.NODE_ENV === "production";
const cookieName = secureCookie ? "__Host-invest_session" : "invest_session";
const encryptionKey = process.env.DATA_ENCRYPTION_KEY || "";
const validEncryptionKey = /^[0-9a-f]{64}$/i.test(encryptionKey);
const storageSetupMissing = validEncryptionKey
  ? []
  : ["DATA_ENCRYPTION_KEY (64 hexadecimal characters)"];
const store = validEncryptionKey
  ? new EncryptedStore(
    resolve(process.env.DATA_FILE || resolve(root, "data", "family-investments.enc")),
    encryptionKey,
    allowedEmails
  )
  : null;
let marketDataConfigured = false;
try {
  const marketEndpoint = new URL(process.env.MARKET_DATA_URL);
  marketDataConfigured = marketEndpoint.protocol === "https:" ||
    (marketEndpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(marketEndpoint.hostname));
} catch {
  marketDataConfigured = false;
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function securityHeaders() {
  const headers = {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
  if (secureCookie) headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

function sendJson(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(value));
}

function redirect(response, location, cookies = []) {
  response.writeHead(303, {
    ...securityHeaders(),
    location,
    ...(cookies.length ? { "set-cookie": cookies } : {})
  });
  response.end();
}

function cookie(token, maxAge) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;
}

function readCookie(request) {
  const raw = request.headers.cookie || "";
  const found = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return found ? found.slice(cookieName.length + 1) : null;
}

function getSession(request) {
  const token = readCookie(request);
  if (!token) return null;
  const key = hash(token);
  const session = sessions.get(key);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return null;
  }
  return { ...session, key };
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw Object.assign(new Error("Request body is too large."), { status: 413 });
  }
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

async function readBuffer(request, limit) {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw Object.assign(new Error("Workbook must be 2 MB or smaller."), { status: 413 });
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error("Workbook must be 2 MB or smaller."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendWorkbook(response, buffer) {
  response.writeHead(200, {
    ...securityHeaders(),
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": 'attachment; filename="investment-holdings-template.xlsx"',
    "content-length": buffer.length
  });
  response.end(buffer);
}

function requireSession(request, response) {
  const session = getSession(request);
  if (!session) {
    sendError(response, 401, "Sign in with an authorized family Google account to continue.");
    return null;
  }
  return session;
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin === appOrigin;
}

function requireMutationProtection(request, response, session) {
  if (!isAllowedOrigin(request)) {
    sendError(response, 403, "Request origin is not allowed.");
    return false;
  }
  if (request.headers["x-csrf-token"] !== session.csrfToken) {
    sendError(response, 403, "Request verification failed. Reload the page and try again.");
    return false;
  }
  return true;
}

function requireStore(response) {
  if (!store) {
    sendError(response, 503, "Encrypted storage is not configured. Set DATA_ENCRYPTION_KEY before adding family data.");
    return false;
  }
  return true;
}

async function fetchMarketPrices(data) {
  return refreshMarketPrices(data, {
    nseMarketData,
    amfiMarketData,
    marketDataUrl: marketDataConfigured ? process.env.MARKET_DATA_URL : "",
    marketDataToken: process.env.MARKET_DATA_TOKEN
  });
}

async function exchangeGoogleCode(code, verifier) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!tokenResponse.ok) throw new Error("Google sign-in could not be completed.");
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error("Google did not return an access token.");
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${tokenData.access_token}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!profileResponse.ok) throw new Error("Google account details could not be verified.");
  const profile = await profileResponse.json();
  return {
    email: String(profile.email || "").toLowerCase(),
    verified: profile.verified_email === true
  };
}

async function serveStatic(pathname, response) {
  let relativePath;
  try {
    relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    sendError(response, 404, "Not found.");
    return;
  }
  const filePath = resolve(publicRoot, relativePath);
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + sep)) {
    sendError(response, 404, "Not found.");
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      ...securityHeaders(),
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    response.end(content);
  } catch {
    sendError(response, 404, "Not found.");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, appOrigin);
  try {
    if (request.method === "GET" && url.pathname === "/auth/google") {
      if (!googleConfigured) {
        redirect(response, "/?setup=google");
        return;
      }
      const callback = new URL(redirectUri);
      if (callback.origin !== appOrigin || callback.pathname !== "/auth/google/callback") {
        throw new Error("GOOGLE_REDIRECT_URI must be APP_ORIGIN/auth/google/callback.");
      }
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      pendingStates.set(state, { verifier, createdAt: Date.now() });
      while (pendingStates.size > 100) pendingStates.delete(pendingStates.keys().next().value);
      const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorization.search = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account"
      }).toString();
      redirect(response, authorization.toString());
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth/google/callback") {
      const state = url.searchParams.get("state");
      const pending = state ? pendingStates.get(state) : null;
      if (state) pendingStates.delete(state);
      if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000 || url.searchParams.has("error")) {
        redirect(response, "/?auth=failed");
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        redirect(response, "/?auth=failed");
        return;
      }
      const profile = await exchangeGoogleCode(code, pending.verifier);
      if (!profile.verified || !allowedEmails.includes(profile.email)) {
        redirect(response, "/?auth=denied");
        return;
      }
      const token = randomBytes(32).toString("base64url");
      for (const [key, session] of sessions) {
        if (session.expiresAt <= Date.now()) sessions.delete(key);
      }
      sessions.set(hash(token), {
        email: profile.email,
        csrfToken: randomBytes(32).toString("base64url"),
        expiresAt: Date.now() + sessionTtl
      });
      while (sessions.size > 100) sessions.delete(sessions.keys().next().value);
      redirect(response, "/", [cookie(token, sessionTtl / 1000)]);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      const session = getSession(request);
      sendJson(response, 200, {
        authenticated: Boolean(session),
        user: session ? { email: session.email } : null,
        csrfToken: session?.csrfToken || null,
        googleConfigured,
        googleSetupMissing,
        storageConfigured: Boolean(store),
        storageSetupMissing,
        marketDataConfigured,
        allowedMemberCount: allowedEmails.length
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/import/holdings-template") {
      const session = requireSession(request, response);
      if (!session) return;
      sendWorkbook(response, await buildHoldingsTemplate(allowedEmails, familyMemberNames));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/equities/search") {
      const session = requireSession(request, response);
      if (!session) return;
      const query = url.searchParams.get("q") || "";
      const items = query.trim().length < 3 ? [] : await nseMarketData.searchEquities(query);
      sendJson(response, 200, { items, source: "NSE EQUITY_L" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/mutual-funds/search") {
      const session = requireSession(request, response);
      if (!session) return;
      const query = url.searchParams.get("q") || "";
      const items = query.trim().length < 3 ? [] : await amfiMarketData.searchSchemes(query);
      sendJson(response, 200, { items, source: "AMFI NAVAll" });
      return;
    }
    if (request.method === "GET" && /^\/api\/banks\/ifsc\/[A-Za-z0-9]{11}$/.test(url.pathname)) {
      const session = requireSession(request, response);
      if (!session) return;
      const ifsc = url.pathname.slice("/api/banks/ifsc/".length);
      sendJson(response, 200, await lookupBankByIfsc(ifsc));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/logout") {
      const session = requireSession(request, response);
      if (!session || !requireMutationProtection(request, response, session)) return;
      sessions.delete(session.key);
      sendJson(response, 200, { ok: true }, { "set-cookie": cookie("", 0) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response)) return;
      const data = await store.read();
      sendJson(response, 200, buildDashboard(data));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/export") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response)) return;
      sendJson(response, 200, exportRows(await store.read()));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/holdings") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const input = await readJson(request);
      const holding = await store.mutate((data) => addHolding(data, input, allowedEmails));
      sendJson(response, 201, { holding });
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/api/holdings") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const { ids } = await readJson(request);
      const result = await store.mutate((data) => deleteHoldings(data, ids));
      sendJson(response, 200, result);
      return;
    }
    if (request.method === "DELETE" && /^\/api\/holdings\/[^/]+$/.test(url.pathname)) {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const holdingId = decodeURIComponent(url.pathname.split("/")[3]);
      const result = await store.mutate((data) => deleteHoldings(data, [holdingId]));
      sendJson(response, 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/transactions") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const input = await readJson(request);
      const transaction = await store.mutate((data) => addTransaction(data, input, allowedEmails));
      sendJson(response, 201, { transaction });
      return;
    }
    if (request.method === "PATCH" && /^\/api\/holdings\/[^/]+\/price$/.test(url.pathname)) {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const holdingId = decodeURIComponent(url.pathname.split("/")[3]);
      const { price } = await readJson(request);
      await store.mutate((data) => updateHoldingPrice(data, holdingId, price));
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "PATCH" && /^\/api\/holdings\/[^/]+$/.test(url.pathname)) {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const holdingId = decodeURIComponent(url.pathname.split("/")[3]);
      const input = await readJson(request);
      const holding = await store.mutate((data) => updateHolding(data, holdingId, input, allowedEmails));
      sendJson(response, 200, { holding });
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/settings") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const input = await readJson(request);
      await store.mutate((data) => updateSettings(data, input));
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/prices/refresh") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const result = await store.mutate((data) => fetchMarketPrices(data));
      sendJson(response, 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/import/holdings") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const { rows } = await readJson(request);
      const enriched = await enrichBankDetails(rows);
      const result = await store.mutate((data) => addImportedHoldings(data, enriched.rows, allowedEmails));
      sendJson(response, 200, { ...result, bankLookup: enriched.lookup });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/import/holdings-workbook") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      if (!String(request.headers["content-type"] || "").startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
        throw Object.assign(new Error("Upload an Excel .xlsx workbook."), { status: 415 });
      }
      const buffer = await readBuffer(request, 2_000_000);
      const rows = await parseHoldingsWorkbook(buffer, allowedEmails, familyMemberNames);
      const enriched = await enrichBankDetails(rows);
      const result = await store.mutate((data) => addImportedHoldings(data, enriched.rows, allowedEmails));
      sendJson(response, 200, { ...result, bankLookup: enriched.lookup });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/import/transactions") {
      const session = requireSession(request, response);
      if (!session || !requireStore(response) || !requireMutationProtection(request, response, session)) return;
      const { rows } = await readJson(request);
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) throw Object.assign(new Error("Import 1 to 1,000 transactions at a time."), { status: 400 });
      let added = 0;
      await store.mutate((data) => {
        for (const row of rows) {
          addTransaction(data, row, allowedEmails);
          added += 1;
        }
      });
      sendJson(response, 200, { added });
      return;
    }
    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }
    sendError(response, 405, "Method not allowed.");
  } catch (error) {
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    if (status >= 500) {
      console.error(`Request failed (${request.method} ${url.pathname}): ${error.name}${error.code ? ` ${error.code}` : ""}`);
    }
    sendError(response, status, error.publicMessage
      ? error.message
      : status >= 500
        ? "The server could not complete this request. Check server configuration and retry."
        : error.message || "Request could not be completed.");
  }
});

server.listen(port, host, () => {
  console.log(`Investment tracker ready at http://${host}:${port}`);
  if (!googleConfigured) console.warn("Google OAuth is not configured; sign-in is unavailable.");
  if (!store) console.warn("Encrypted family data storage is disabled; set DATA_ENCRYPTION_KEY before use.");
  if (secureCookie && new URL(appOrigin).protocol !== "https:") {
    console.error("Production cookies require APP_ORIGIN to use HTTPS.");
    server.close();
  }
});
