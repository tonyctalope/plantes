import type { Config } from '../config.ts';
import { SCOPE } from './errors.ts';

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(config: Config) {
  const base = config.origin;
  return {
    issuer: config.issuer,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base}/`,
  };
}

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export function protectedResourceMetadata(config: Config) {
  return {
    resource: config.mcpResource,
    authorization_servers: [config.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Plantes',
    resource_documentation: `${config.origin}/`,
  };
}

export const protectedResourceMetadataUrl = (config: Config) =>
  `${config.origin}/.well-known/oauth-protected-resource/mcp`;
