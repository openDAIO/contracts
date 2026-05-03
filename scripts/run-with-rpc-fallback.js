#!/usr/bin/env node

const fs = require("fs");
const { spawnSync } = require("child_process");

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => value.trim()).filter(Boolean))];
}

function rpcUrls(env) {
  return unique([
    ...(env.SEPOLIA_RPC_URLS || "").split(/[\s,]+/),
    env.SEPOLIA_RPC_URL,
    "https://ethereum-sepolia-rpc.publicnode.com"
  ]);
}

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("Usage: node scripts/run-with-rpc-fallback.js <command> [args...]");
  process.exit(1);
}

const env = { ...parseEnvFile(".env"), ...process.env };
const urls = rpcUrls(env);
if (urls.length === 0) {
  console.error("SEPOLIA_RPC_URL or SEPOLIA_RPC_URLS is required");
  process.exit(1);
}

const maxAttempts = Number(env.RPC_FALLBACK_ATTEMPTS || urls.length);
const timeout = Number(env.RPC_FALLBACK_TIMEOUT_MS || 180_000);
let lastStatus = 1;
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  const url = urls[attempt % urls.length];
  const label = attempt + 1;
  console.log(`RPC attempt ${label}/${maxAttempts}: ${url}`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...env, SEPOLIA_RPC_URL: url },
    timeout
  });
  if (result.error && result.error.code === "ETIMEDOUT") {
    console.error(`Command timed out after ${timeout}ms on this RPC`);
    lastStatus = 124;
    continue;
  }
  if (result.status === 0) process.exit(0);
  if (result.signal) {
    console.error(`Command stopped by signal ${result.signal}`);
    process.exit(1);
  }
  lastStatus = result.status || 1;
}

process.exit(lastStatus);
