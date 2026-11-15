import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalEnv } from "../src/load-local-env.mjs";

test("local env loading preserves process values and parses simple quoted values", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "investment-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, ".env");
  await writeFile(file, [
    "# Local-only secrets",
    "export GOOGLE_CLIENT_ID=file-client",
    'GOOGLE_CLIENT_SECRET="secret value"',
    "DATA_ENCRYPTION_KEY=abc123",
    "EMPTY_VALUE="
  ].join("\n"));
  const environment = { NODE_ENV: "development", GOOGLE_CLIENT_ID: "process-client" };
  assert.equal(await loadLocalEnv(file, environment), true);
  assert.equal(environment.GOOGLE_CLIENT_ID, "process-client");
  assert.equal(environment.GOOGLE_CLIENT_SECRET, "secret value");
  assert.equal(environment.DATA_ENCRYPTION_KEY, "abc123");
  assert.equal(environment.EMPTY_VALUE, "");
});

test("production ignores local env files and invalid entries fail clearly", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "investment-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, ".env");
  await writeFile(file, "NOT_AN_ASSIGNMENT\n");
  assert.equal(await loadLocalEnv(file, { NODE_ENV: "production" }), false);
  await assert.rejects(() => loadLocalEnv(file, { NODE_ENV: "development" }), /line 1/);
});
