// Runner de migrations: aplica os .sql de db/migrations em ordem, uma vez cada.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { env } from "../env";

async function main() {
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  const dir = join(__dirname, "..", "..", "db", "migrations");

  await sql`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const already = await sql`SELECT 1 FROM _migrations WHERE name = ${file}`;
    if (already.length > 0) {
      console.log(`↷ skip   ${file}`);
      continue;
    }
    const contents = readFileSync(join(dir, file), "utf8");
    console.log(`→ apply  ${file}`);
    await sql.unsafe(contents);
    await sql`INSERT INTO _migrations (name) VALUES (${file})`;
  }

  await sql.end();
  console.log("✔ migrations up to date");
}

main().catch((err) => {
  console.error("✘ migration failed:", err);
  process.exit(1);
});
