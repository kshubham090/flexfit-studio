import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

// Runs once before the whole test run: builds a throwaway SQLite file with
// the real schema applied, isolated from flexfit.db (the dev database).
const repoRoot = path.resolve(__dirname, "../..");
const dbPath = path.resolve(repoRoot, "test-flexfit.db");

export async function setup() {
  if (existsSync(dbPath)) unlinkSync(dbPath);
  execSync("npx drizzle-kit push --force", {
    cwd: repoRoot,
    env: { ...process.env, DB_FILE: `file:${dbPath}` },
    stdio: "pipe",
  });
}

export async function teardown() {
  if (existsSync(dbPath)) unlinkSync(dbPath);
}
