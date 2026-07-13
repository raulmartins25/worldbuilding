// Camada de queries tipada (Drizzle). Espelha db/migrations/0001_init.sql.
// O DDL canônico (extensões, tsvector gerado, HNSW, RLS) vive no SQL.
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  integer,
  smallint,
  doublePrecision,
  bigint,
  timestamp,
  numeric,
  vector,
  customType,
  primaryKey,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const entryType = pgEnum("entry_type", [
  "character", "location", "region", "faction", "item", "magic_system",
  "species", "creature", "deity", "religion", "event", "lore",
  "language", "scene", "chapter", "note",
]);
export const entryStatus = pgEnum("entry_status", ["draft", "canon", "archived"]);
export const aiStatus = pgEnum("ai_status", ["open", "ignored", "resolved"]);
export const aiKind = pgEnum("ai_kind", ["inconsistency", "suggestion", "gap", "interview"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash"),
  provider: text("provider").notNull().default("local"),
  providerId: text("provider_id"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  coverUrl: text("cover_url"),
  calendar: jsonb("calendar").notNull().default({}),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entries = pgTable("entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: entryType("type").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  body: jsonb("body").notNull().default({}),
  coverUrl: text("cover_url"),
  importance: smallint("importance").notNull().default(0),
  status: entryStatus("status").notNull().default("draft"),
  metadata: jsonb("metadata").notNull().default({}),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  containerId: uuid("container_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  role: text("role"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const relationships = pgTable("relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  label: text("label"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attributes = pgTable("attributes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value"),
  valueNum: numeric("value_num"),
  unit: text("unit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
});

export const entryTags = pgTable("entry_tags", {
  entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.entryId, t.tagId] }) }));

export const boards = pgTable("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Main"),
  viewport: jsonb("viewport").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const boardNodes = pgTable("board_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").references(() => entries.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("card"),
  x: doublePrecision("x").notNull().default(0),
  y: doublePrecision("y").notNull().default(0),
  width: doublePrecision("width"),
  height: doublePrecision("height"),
  zIndex: integer("z_index").notNull().default(0),
  parentNodeId: uuid("parent_node_id"),
  style: jsonb("style").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const boardEdges = pgTable("board_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  sourceNodeId: uuid("source_node_id").notNull().references(() => boardNodes.id, { onDelete: "cascade" }),
  targetNodeId: uuid("target_node_id").notNull().references(() => boardNodes.id, { onDelete: "cascade" }),
  relationshipId: uuid("relationship_id").references(() => relationships.id, { onDelete: "set null" }),
  label: text("label"),
  style: jsonb("style").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const maps = pgTable("maps", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imageUrl: text("image_url").notNull(),
  width: integer("width"),
  height: integer("height"),
  parentMapId: uuid("parent_map_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mapPins = pgTable("map_pins", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mapId: uuid("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").references(() => entries.id, { onDelete: "cascade" }),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  label: text("label"),
  icon: text("icon"),
  color: text("color"),
  childMapId: uuid("child_map_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timelineEvents = pgTable("timeline_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").references(() => entries.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  startValue: bigint("start_value", { mode: "number" }).notNull(),
  startStruct: jsonb("start_struct").notNull().default({}),
  endValue: bigint("end_value", { mode: "number" }),
  endStruct: jsonb("end_struct"),
  importance: smallint("importance").notNull().default(0),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timelineEventEntries = pgTable("timeline_event_entries", {
  eventId: uuid("event_id").notNull().references(() => timelineEvents.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  role: text("role"),
}, (t) => ({ pk: primaryKey({ columns: [t.eventId, t.entryId] }) }));

export const references = pgTable("references_", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("link"),
  url: text("url"),
  title: text("title"),
  content: text("content"),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiChecks = pgTable("ai_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").references(() => entries.id, { onDelete: "cascade" }),
  kind: aiKind("kind").notNull(),
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  detail: text("detail"),
  payload: jsonb("payload").notNull().default({}),
  status: aiStatus("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
