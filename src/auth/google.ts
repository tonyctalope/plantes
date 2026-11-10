import * as oidc from 'openid-client';
import type { Config } from '../config.ts';
import { get, run, type Db } from '../db/database.ts';
import { sha256 } from '../lib/crypto.ts';

export const LOGIN_COOKIE = 'plantes_login';
const LOGIN_TTL_MS = 10 * 60 * 1000;

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export interface IdentityProvider {
  /** Starts a login: returns the URL to send the browser to and the state to bind to the browser. */
  start(nextPath: string): Promise<{ url: string; state: string }>;
  /** Completes it from the callback URL; throws on any protocol failure. */
  finish(callbackUrl: URL, state: string): Promise<{ identity: GoogleIdentity; nextPath: string }>;
}

export class LoginError extends Error {}

export function createGoogleProvider(
  config: Config,
  db: Db,
  options: { allowInsecure?: boolean } = {},
): IdentityProvider {
  let discovered: Promise<oidc.Configuration> | null = null;
  const configuration = () => {
    discovered ??= oidc
      .discovery(
        new URL(config.google.issuer),
        config.google.clientId,
        config.google.clientSecret,
        undefined,
        options.allowInsecure ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((error: unknown) => {
        discovered = null; // retry discovery on the next login
        throw error;
      });
    return discovered;
  };
  const redirectUri = `${config.origin}/auth/google/callback`;

  return {
    async start(nextPath) {
      const server = await configuration();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const verifier = oidc.randomPKCECodeVerifier();
      run(
        db,
        `INSERT INTO login_states (state_hash, nonce, code_verifier, next_path, expires_at)
         VALUES (:state, :nonce, :verifier, :next, :expires)`,
        {
          state: sha256(state),
          nonce,
          verifier,
          next: nextPath,
          expires: new Date(Date.now() + LOGIN_TTL_MS).toISOString(),
        },
      );
      const url = oidc.buildAuthorizationUrl(server, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        response_type: 'code',
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url: url.href, state };
    },

    async finish(callbackUrl, state) {
      const stateHash = sha256(state);
      const pending = get<{ nonce: string; code_verifier: string; next_path: string; expires_at: string }>(
        db,
        'SELECT nonce, code_verifier, next_path, expires_at FROM login_states WHERE state_hash = :state',
        { state: stateHash },
      );
      run(db, 'DELETE FROM login_states WHERE state_hash = :state', { state: stateHash });
      if (!pending || Date.parse(pending.expires_at) <= Date.now()) {
        throw new LoginError('La tentative de connexion a expiré, recommence.');
      }
      const server = await configuration();
      const tokens = await oidc.authorizationCodeGrant(server, callbackUrl, {
        pkceCodeVerifier: pending.code_verifier,
        expectedState: state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.email !== 'string') throw new LoginError('Google n’a pas fourni d’adresse e-mail.');
      return {
        identity: {
          sub: claims.sub,
          email: claims.email.toLowerCase(),
          emailVerified: claims.email_verified === true,
          name: typeof claims.name === 'string' ? claims.name : null,
        },
        nextPath: pending.next_path,
      };
    },
  };
}
