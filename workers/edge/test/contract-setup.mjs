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
import { buildContractData, buildImportLogText, TEST_INSTALL_ID, EXCLUDED_INSTALL_ID } from "./contract-data.mjs";
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

    const importLogText = buildImportLogText(nowMs);
    const importAccessLog = path.join(dir, "import-access.log");
    writeFileSync(importAccessLog, importLogText);
    const statePath = path.join(dir, "usage-state.json");
    const importStatsPath = path.join(dir, "import-stats.json");
    runScript(reportUsagePath, [
      importAccessLog,
      "--state", statePath,
      "--output", importStatsPath,
      "--now", String(nowMs),
    ]);

    const excludesPath = path.join(dir, "excludes.txt");
    writeFileSync(excludesPath, `${EXCLUDED_INSTALL_ID}\n`);

    const summaryPath = path.join(dir, "summary.json");
    const importSqlPath = path.join(dir, "import.sql");
    const imported = runScript(importScriptPath, [
      statePath,
      "--output", importSqlPath,
      "--summary", summaryPath,
      "--now", String(nowMs),
      "--exclude-installs", excludesPath,
    ]);
    const importSql = readFileSync(importSqlPath, "utf8");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const importExpected = JSON.parse(readFileSync(importStatsPath, "utf8"));

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
        summary,
        expected: importExpected,
        testId: TEST_INSTALL_ID,
        excludedId: EXCLUDED_INSTALL_ID,
        expectedStdout: imported.stdout || "",
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
