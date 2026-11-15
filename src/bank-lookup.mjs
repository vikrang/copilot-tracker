const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const MAX_IMPORT_LOOKUPS = 20;

function failure(message, status) {
  return Object.assign(new Error(message), { status, publicMessage: true });
}

export async function lookupBankByIfsc(value, fetcher = fetch) {
  const ifsc = String(value ?? "").trim().toUpperCase();
  if (!IFSC_PATTERN.test(ifsc)) {
    throw failure("Enter a valid 11-character Indian IFSC code.", 400);
  }

  let response;
  try {
    response = await fetcher(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw failure("Bank lookup is temporarily unavailable. Check your internet connection and try again.", 502);
  }

  if (response.status === 404) throw failure("No bank branch was found for this IFSC code.", 404);
  if (!response.ok) throw failure("Bank lookup could not be completed. Try again later.", 502);

  let record;
  try {
    record = await response.json();
  } catch {
    throw failure("Bank lookup returned an unreadable response. Try again later.", 502);
  }

  const bankName = typeof record?.BANK === "string" ? record.BANK.trim() : "";
  const bankAddress = typeof record?.ADDRESS === "string" ? record.ADDRESS.trim() : "";
  if (!bankName || !bankAddress || bankName.length > 100 || bankAddress.length > 300) {
    throw failure("Bank lookup returned incomplete branch details. Try again later.", 502);
  }
  return { ifsc, bankName, bankAddress };
}

export async function enrichBankDetails(rows, lookup = lookupBankByIfsc) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) {
    throw failure("Import 1 to 500 investment rows at a time.", 400);
  }
  if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw failure("Each imported investment must be a row of named fields.", 400);
  }
  const enrichedRows = rows.map((row) => ({
    ...row,
    bankIfsc: String(row.bankIfsc ?? "").trim().toUpperCase(),
    bankName: String(row.bankName ?? "").trim(),
    bankAddress: String(row.bankAddress ?? "").trim()
  }));
  const codes = [...new Set(enrichedRows
    .filter((row) => row.bankIfsc)
    .map((row) => row.bankIfsc))];
  const attempted = codes.slice(0, MAX_IMPORT_LOOKUPS);
  const results = await Promise.all(attempted.map(async (ifsc) => {
    try {
      return [ifsc, await lookup(ifsc)];
    } catch (error) {
      return [ifsc, { error }];
    }
  }));
  const detailsByIfsc = new Map(results);
  let failed = 0;
  for (const [ifsc, result] of detailsByIfsc) {
    if (result.error) {
      failed += 1;
      continue;
    }
    for (const row of enrichedRows) {
      if (row.bankIfsc !== ifsc) continue;
      row.bankName = result.bankName;
      row.bankAddress = result.bankAddress;
    }
  }
  return {
    rows: enrichedRows,
    lookup: { matched: attempted.length - failed, failed, skipped: codes.length - attempted.length }
  };
}
