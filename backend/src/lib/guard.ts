import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { projects, entries, boards, maps } from "../db/schema";

/** Erro com statusCode para o error handler global. */
export function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

/** Retorna o projeto se pertencer ao usuário, senão lança 404. */
export async function requireProject(userId: string, projectId: string) {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!p) throw httpError(404, "project_not_found");
  return p;
}

/** Retorna a entry se pertencer ao usuário, senão lança 404. */
export async function requireEntry(userId: string, entryId: string) {
  const [e] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId)));
  if (!e) throw httpError(404, "entry_not_found");
  return e;
}

/** Retorna o board se pertencer ao usuário (via projeto), senão lança 404. */
export async function requireBoard(userId: string, boardId: string) {
  const [row] = await db
    .select({ board: boards })
    .from(boards)
    .innerJoin(projects, eq(boards.projectId, projects.id))
    .where(and(eq(boards.id, boardId), eq(projects.userId, userId)));
  if (!row) throw httpError(404, "board_not_found");
  return row.board;
}

/** Retorna o mapa se pertencer ao usuário (via projeto), senão lança 404. */
export async function requireMap(userId: string, mapId: string) {
  const [row] = await db
    .select({ map: maps })
    .from(maps)
    .innerJoin(projects, eq(maps.projectId, projects.id))
    .where(and(eq(maps.id, mapId), eq(projects.userId, userId)));
  if (!row) throw httpError(404, "map_not_found");
  return row.map;
}
