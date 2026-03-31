import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("userId", "");

  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    // Skip auth for login/register
    if (request.url.startsWith("/api/v1/auth/login") || request.url.startsWith("/api/v1/auth/register")) {
      return;
    }
    // Skip non-API routes
    if (!request.url.startsWith("/api/")) {
      return;
    }

    await request.jwtVerify();
    request.userId = request.user.sub;
  });
}

export default fp(authPlugin, { name: "auth" });
