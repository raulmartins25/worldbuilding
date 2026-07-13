import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { env } from "./env";
import { registerRoutes } from "./routes";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });

  app.register(jwt, { secret: env.JWT_SECRET });

  app.decorate("authenticate", async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation", issues: err.issues });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: err.message ?? "internal_error" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.register(registerRoutes, { prefix: "/api/v1" });

  return app;
}
