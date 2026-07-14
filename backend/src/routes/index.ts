import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth";
import { projectRoutes } from "./projects";
import { entryRoutes } from "./entries";
import { membershipRoutes } from "./memberships";
import { relationshipRoutes } from "./relationships";
import { attributeRoutes } from "./attributes";
import { tagRoutes } from "./tags";
import { boardRoutes } from "./boards";
import { referenceRoutes } from "./references";
import { aiRoutes } from "./ai";
import { mapRoutes } from "./maps";
import { timelineRoutes } from "./timeline";

export async function registerRoutes(app: FastifyInstance) {
  app.register(authRoutes, { prefix: "/auth" });
  app.register(projectRoutes);
  app.register(entryRoutes);
  app.register(membershipRoutes);
  app.register(relationshipRoutes);
  app.register(attributeRoutes);
  app.register(tagRoutes);
  app.register(boardRoutes);
  app.register(referenceRoutes);
  app.register(aiRoutes);
  app.register(mapRoutes);
  app.register(timelineRoutes);
}
