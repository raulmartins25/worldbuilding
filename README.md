# Loregrid — Worldbuilding OS

Um OS de worldbuilding para escritores de fantasia: o mundo se constrói em **cards interligados**
sobre um **canvas infinito**, com **mapa cartográfico**, **linha do tempo** e uma **IA** (RAG com
pgvector) que lê todo o contexto para apontar inconsistências e sugerir conexões.

Monorepo:

```
worldbuilding/
├── backend/     Fastify + TypeScript + Drizzle (Postgres + pgvector)
├── frontend/    Vite + React + React Flow + Tiptap
└── docs/        ARCHITECTURE.md (schema, rotas, telas)
```

## Rodando local

Pré-requisitos: Node 20+, um Postgres com a extensão **pgvector** (imagem `pgvector/pgvector:pg17`).

```bash
# 1. instalar deps do monorepo
npm install

# 2. backend
cp backend/.env.example backend/.env      # ajuste DATABASE_URL e JWT_SECRET
npm run db:migrate                         # cria extensões + tabelas
npm run dev:backend                        # http://localhost:3000

# 3. frontend (outro terminal)
cp frontend/.env.example frontend/.env     # VITE_API_URL
npm run dev:frontend                        # http://localhost:5173
```

## Deploy (EasyPanel)

- **loregrid-db** — serviço Postgres com imagem `pgvector/pgvector:pg17`.
- **loregrid-api** — app buildado a partir de `backend/Dockerfile`.
- **loregrid-web** — app buildado a partir de `frontend/Dockerfile`.

Ver `docs/ARCHITECTURE.md` para o schema completo, rotas REST e mapa de telas.

## Status

MVP em construção: **auth · worlds · entries · memberships · relationships · tags**.
Próximos: canvas (boards) · mapa · timeline · genealogia/grafo · IA.
