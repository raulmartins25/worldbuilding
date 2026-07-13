import type { Config } from "drizzle-kit";

// Migrations canônicas são SQL escrito à mão em db/migrations (extensões, tsvector
// gerado, índice HNSW e RLS precisam de controle fino). O drizzle-kit fica disponível
// para inspeção/geração auxiliar durante o desenvolvimento.
export default {
  schema: "./src/db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
