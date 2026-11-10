import {
  createMcpHandler,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import { protectedResourceMetadataUrl } from '../oauth/metadata.ts';
import { SCOPE } from '../oauth/errors.ts';
import { verifyAccessToken } from '../oauth/tokens.ts';
import { allowlist, type AppEnv, type Deps } from '../types.ts';
import { buildMcpServer, callerFromAuth } from './server.ts';

/** POST /mcp — Streamable HTTP (2026-07-28 stateless, and 2025-era clients) behind our bearer tokens. */
export function mcpHandler(deps: Deps) {
  const { db, config } = deps;
  const isAllowed = allowlist(config);
  const gate = requireBearerAuth({
    verifier: {
      async verifyAccessToken(token: string): Promise<AuthInfo> {
        const access = verifyAccessToken(db, token, isAllowed);
        if (!access) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or expired access token');
        return {
          token,
          clientId: access.clientId,
          scopes: access.scopes,
          expiresAt: access.expiresAt,
          resource: new URL(access.resource),
          extra: { userId: access.userId, email: access.email, clientName: access.clientName },
        };
      },
    },
    requiredScopes: [SCOPE],
    resourceMetadataUrl: protectedResourceMetadataUrl(config),
    expectedResource: new URL(config.mcpResource),
  });
  const handler = createMcpHandler(
    (ctx) => {
      const caller = callerFromAuth(ctx.authInfo);
      if (!caller) throw new Error('MCP request without a verified caller');
      return buildMcpServer(deps, caller);
    },
    { onerror: (error) => console.error('mcp error:', error.message) },
  );
  return async (c: Context<AppEnv>) => {
    const auth = await gate(c.req.raw);
    if (auth instanceof Response) return auth;
    return handler.fetch(c.req.raw, { authInfo: auth });
  };
}
