#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 10_000;

function deploymentUrl(baseUrl, file) {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(file, normalized);
  url.searchParams.set("deployment", `${Date.now()}-${Math.random()}`);
  return url;
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`${url.pathname} returned ${response.status}`);
  }
  return response.json();
}

async function verifyProductionDeployment({
  baseUrl,
  expectedRelease,
  expectedSha,
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_ATTEMPTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  if (!baseUrl || !expectedRelease || !expectedSha) {
    throw new Error("Deployment verification requires a URL, release, and SHA");
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [release, marker] = await Promise.all([
        fetchJson(
          fetchImpl,
          deploymentUrl(baseUrl, "releases.json"),
          timeoutMs
        ),
        fetchJson(
          fetchImpl,
          deploymentUrl(baseUrl, "deployment.json"),
          timeoutMs
        )
      ]);
      assert.deepStrictEqual(release, expectedRelease);
      assert.deepStrictEqual(marker, { commit: expectedSha });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(intervalMs);
      }
    }
  }

  throw new Error(`Production deployment did not become current: ${lastError}`);
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const baseUrl = readArgument("--base-url");
  const expectedFile = readArgument("--expected-release");
  const expectedSha = readArgument("--expected-sha");
  if (!baseUrl || !expectedFile || !expectedSha) {
    throw new Error(
      "Usage: verify-website-deployment.cjs --base-url <url> " +
        "--expected-release <file> --expected-sha <sha>"
    );
  }

  const expectedRelease = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
  await verifyProductionDeployment({
    baseUrl,
    expectedRelease,
    expectedSha
  });
  process.stdout.write(`Verified production website at ${expectedSha}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_ATTEMPTS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  verifyProductionDeployment
};
