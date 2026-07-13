import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema";
import { hashPassword, verifyPassword } from "../lib/password";
import { httpError } from "../lib/guard";

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).optional(),
});

function sanitize(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    provider: u.provider,
    createdAt: u.createdAt,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (req, reply) => {
    const { email, password, displayName } = credentials.parse(req.body);

    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) throw httpError(409, "email_already_registered");

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, displayName: displayName ?? email.split("@")[0] })
      .returning();

    const token = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: "7d" });
    return reply.code(201).send({ token, user: sanitize(user) });
  });

  app.post("/login", async (req) => {
    const { email, password } = credentials.omit({ displayName: true }).parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !user.passwordHash) throw httpError(401, "invalid_credentials");

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw httpError(401, "invalid_credentials");

    const token = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: "7d" });
    return { token, user: sanitize(user) };
  });

  app.get("/me", { preHandler: [app.authenticate] }, async (req) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.user.sub));
    if (!user) throw httpError(404, "user_not_found");
    return { user: sanitize(user) };
  });

  app.post("/refresh", { preHandler: [app.authenticate] }, async (req) => {
    const token = app.jwt.sign({ sub: req.user.sub, email: req.user.email }, { expiresIn: "7d" });
    return { token };
  });
}
