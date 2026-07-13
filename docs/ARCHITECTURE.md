# Arquitetura — Loregrid

## Princípios

1. **PK `uuid`** em tudo (`gen_random_uuid()`).
2. **Escopo `user_id → project_id`** em todas as tabelas de conteúdo.
3. **pgvector desde já** — coluna `embedding` em `entries` para busca semântica / RAG.
4. **Três sistemas de coordenadas desacoplados** sobre as mesmas entries:
   - **Semântico** → `relationships` (alimenta IA, grafo, genealogia)
   - **Board / canvas** → `board_nodes` / `board_edges` (layout do quadro branco)
   - **Geográfico** → `map_pins` (coordenada na imagem do mapa)

   Nunca misturar os três. `board_edges.relationship_id` é um link **opcional**, jamais obrigatório.

## Modelo de dados

O DDL canônico e completo vive em [`backend/db/migrations/0001_init.sql`](../backend/db/migrations/0001_init.sql).
A camada de queries tipada (Drizzle) espelha isso em [`backend/src/db/schema.ts`](../backend/src/db/schema.ts).

Tabelas: `users`, `projects`, `entries`, `memberships`, `relationships`, `attributes`,
`tags`, `entry_tags`, `boards`, `board_nodes`, `board_edges`, `maps`, `map_pins`,
`timeline_events`, `timeline_event_entries`, `references_`, `ai_checks`.

`entries.type` (enum): character, location, region, faction, item, magic_system, species,
creature, deity, religion, event, lore, language, scene, chapter, note.

## Rotas REST (`/api/v1`)

| Recurso | Rotas |
|---|---|
| Auth | `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `GET /auth/me` |
| Projects | `GET/POST /projects` · `GET/PATCH/DELETE /projects/:pid` |
| Entries | `GET/POST /projects/:pid/entries` · `GET/PATCH/DELETE /entries/:id` · `POST /projects/:pid/entries/search` |
| Memberships | `GET /entries/:id/members` · `GET /entries/:id/containers` · `GET /projects/:pid/tree` · `POST /projects/:pid/memberships` · `PATCH/DELETE /memberships/:id` |
| Relationships | `GET/POST /projects/:pid/relationships` · `PATCH/DELETE /relationships/:id` · `GET /entries/:id/relationships` · `GET /projects/:pid/graph` · `GET /entries/:id/genealogy` |
| Attributes | `GET/PUT /entries/:id/attributes` · `PATCH/DELETE /attributes/:id` |
| Tags | `GET/POST /projects/:pid/tags` · `PATCH/DELETE /tags/:id` · `POST /entries/:id/tags` · `DELETE /entries/:id/tags/:tagId` |
| Boards | `GET/POST /projects/:pid/boards` · `GET/PATCH/DELETE /boards/:id` · nodes/edges · `POST /boards/:id/expand-container` |
| Maps | `GET/POST /projects/:pid/maps` · `GET/PATCH/DELETE /maps/:id` · pins |
| Timeline | `GET/POST /projects/:pid/timeline` · `PATCH/DELETE /timeline-events/:id` |
| References | `GET/POST /entries/:id/references` · `PATCH/DELETE /references/:id` |
| Uploads | `POST /projects/:pid/uploads` |
| IA | `POST /projects/:pid/ai/check` · `GET /projects/:pid/ai/checks` · `PATCH /ai-checks/:id` · `POST /projects/:pid/ai/suggest-links` · `POST /projects/:pid/ai/search` · `POST /entries/:id/ai/interview` |

**Implementado no scaffold:** auth, projects, entries, memberships, relationships, attributes, tags.
Demais recursos: skeleton + TODO.

## Telas (frontend)

```
/login, /register
/worlds                      lista de Worlds
/worlds/:pid                 shell (sidebar + topbar + views)
  ├─ /canvas   (default)     React Flow — cards vivos, frames, edges tipados
  ├─ /entries                tabela com filtros
  ├─ /entry/:id              Tiptap + atributos + tags + relações + membership + refs
  ├─ /map                    mapa + pins (nested)
  ├─ /timeline               calendário custom
  ├─ /graph                  grafo + árvore genealógica
  └─ Painel IA (lateral)     AIChecks, sugestões, entrevistar personagem
/settings/world/:pid, /settings/account
```

## Segurança

- JWT (access) em todas as rotas exceto `auth/*`.
- Senha com **argon2** (`@node-rs/argon2`), campo `provider` no `users` para OAuth futuro.
- Escopo obrigatório por `user_id`; recomendado ligar **RLS** por `project_id` em produção.
