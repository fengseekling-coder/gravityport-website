// Node-side preparation for the contract tests. Runs in the vitest config
// (before workerd starts): builds the synthetic nginx access log, runs the
// real scripts/report-usage.mjs on it, runs the import script on a synthetic
// usage-state.json, and returns everything the workerd tests need as plain
// data. No server, no network — only local files in a temp directory.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContractData, buildImportState } from "./contract-data.mjs";
import { analyticsDayKey } from "../src/util.js";

const edgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(edgeDir, "..", "..");
const reportUsagePath = path.join(repoRoot, "scripts", "report-usage.mjs");
const importScriptPath = path.join(edgeDir, "scripts", "import-usage-state.mjs");

/**
 * Run a Node script and fail loudly when it exits nonzero.
 * @param {string} scriptPath
 * @param {string[]} args
 * @returns {{stdout: string}}
 */
function runScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`contract setup: ${path.basename(scriptPath)} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

/**
 * @returns {{feed: unknown, importCase: unknown}}
 */
export async function prepareContractBindings() {
  const dir = mkdtempSync(path.join(tmpdir(), "gp-edge-contract-"));
  try {
    const nowMs = Date.now();
    const contract = buildContractData(nowMs);

    const accessLog = path.join(dir, "access.log");
    writeFileSync(accessLog, contract.logText);
    const report = runScript(reportUsagePath, [
      accessLog,
      "--output", path.join(dir, "stats.json"),
      "--now", String(nowMs),
    ]);

    const state = buildImportState(nowMs, (timestamp) => analyticsDayKey(timestamp));
    const statePath = path.join(dir, "usage-state.json");
    writeFileSync(statePath, `${JSON.stringify(state)}\n`);
    const imported = runScript(importScriptPath, [
      statePath,
      "--output", path.join(dir, "import.sql"),
      "--now", String(nowMs),
    ]);
    const importSql = readFileSync(path.join(dir, "import.sql"), "utf8");

    // Expected numbers for the import case come from report-usage.mjs run on
    // the same state with an empty access log.
    const emptyLog = path.join(dir, "empty.log");
    writeFileSync(emptyLog, "");
    const importExpected = runScript(reportUsagePath, [
      emptyLog,
      "--state", statePath,
      "--output", path.join(dir, "import-stats.json"),
      "--now", String(nowMs),
    ]);

    return {
      feed: {
        t0: nowMs,
        requests: contract.requests,
        pages: contract.pages,
        expected: JSON.parse(readFileSync(path.join(dir, "stats.json"), "utf8")),
        reportStderr: report.stderr || "",
      },
      importCase: {
        t0: nowMs,
        sql: importSql,
        expected: JSON.parse(readFileSync(path.join(dir, "import-stats.json"), "utf8")),
        expectedStdout: imported.stdout || "",
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
