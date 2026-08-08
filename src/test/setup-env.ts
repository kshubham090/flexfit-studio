import path from "node:path";

// Runs before each test file's own imports, so "@/db" (which reads
// DB_FILE at module-load time) resolves to the isolated test database
// created once in global-setup.ts, never the dev database (flexfit.db).
const dbPath = path.resolve(__dirname, "../../test-flexfit.db");
process.env.DB_FILE = `file:${dbPath}`;
