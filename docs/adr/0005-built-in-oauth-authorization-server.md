---
status: accepted
date: 2026-09-03
---

# A built-in OAuth 2.1 authorization server, not SuperTokens' OAuth2Provider recipe

**Context.** The Workflow harness's MCP endpoint (bffless/apps#554, spec 10, auth ladder
rung 3) must let claude.ai's one-click connector flow complete against a private deployment:
RFC 9728 protected-resource discovery → dynamic client registration (RFC 7591) → an
authorization-code grant with PKCE → tokens, where the access token _is_ an app token
(a member-bound, project-bound, scoped bearer — CE #727) so that `auth_required`,
`requiredScopes` and the visibility gate need no second credential type. SuperTokens is
CE's identity provider, and its OAuth2Provider recipe ("unified login") exists; the story
required a spike to decide between adopting it and building the small server CE needs.

**Decision.** Build it in: a `OAuthModule` on the admin host — `GET
/.well-known/oauth-authorization-server` (RFC 8414), `POST /api/oauth/register` (RFC 7591,
public clients only), `GET /api/oauth/authorize` (PKCE `S256` required, RFC 8707 `resource`
required), a consent page in the admin SPA with per-scope checkboxes, `POST
/api/oauth/consent`, `POST /api/oauth/token` (authorization_code + refresh_token with
rotation and family revocation), `POST /api/oauth/revoke` (RFC 7009). Access tokens are
minted through the app-tokens service (`kind: 'oauth'`, 1 h) bound to the project the
`resource` resolves to. State: `oauth_clients`, `oauth_authorization_codes`,
`oauth_refresh_tokens`; pending authorization requests ride as signed JWTs (10 min), no table.

**Considered — SuperTokens OAuth2Provider (rejected, four criteria, spike 2026-09-03).**

1. _Dynamic client registration for public clients with no admin step_ — **no.** The recipe's
   API surface (`lib/ts/recipe/oauth2provider/api/`: `auth`, `token`, `login`, `loginInfo`,
   `logout`, `endSession`, `introspectToken`, `revokeToken`, `userInfo`) has no `register`
   endpoint; clients are created by the authenticated SDK function `createOAuth2Client`.
   claude.ai registers itself, so an operator-created client would not work.
2. _Works with CE's `supertokens-node` ^17 and core 12.0.10_ — **no.** The recipe shipped in
   `supertokens-node` **21.0.0** (2024-10-07, "Added OAuth2Provider recipe", core ≥ 9.3, CDI
   5.2): a four-major upgrade of the SDK, on top of the core-12 migration pain recorded in #695.
3. _RFC 8707 resource indicators honoured and reflected into the token_ — **not as such.**
   The recipe reasons in OAuth2 _audiences_ (`requirements.audience` on token validation),
   not resource indicators mapped to a CE project.
4. _The access token can be an app token_ — **no.** The recipe issues its own JWTs; CE would
   have to exchange them for app tokens at every gate, or teach three guards a second bearer.

Any one failure was to decide it; all four did. Also considered: an external authorization
server (Hydra, Keycloak) — rejected for the same operational reason ADR-0005 in the apps repo
gives for a standalone Node service: an unowned unit every self-hoster would have to run.

**Consequences.** CE owns a small, standards-shaped authorization server and its three
tables; the admin nginx vhost gains one `location` for the RFC 8414 document (the SPA's
catch-all served `index.html` there); the app ships its protected-resource document as a
rule (`bypassVisibility`), so CE never grows an app-aware discovery endpoint. OIDC discovery,
token introspection (RFC 7662) and client garbage collection are deferred. If SuperTokens'
recipe later gains DCR and CE has crossed the SDK-21 line, revisiting is a one-ADR decision.

**Amended 2026-09-06 (#760).** The document stays a rule of the alias — still no CE endpoint
that knows about apps — but CE now ships a declared step for it, `oauth_protected_resource`,
after two apps had copied the same ~50-line function (and both guessed the issuer as
`admin.<parent>`, wrong for any instance whose admin host is not `admin.*`). The step derives
`resource` from the request host, `authorization_servers` from `OAuthService.issuer()`, and
`scopes_supported` from the `mcp_handler`'s sibling `requiredScopes` unless declared; a rule
carrying it is served regardless of visibility without `bypassVisibility`. The fully-derived
alternative (answer `/.well-known` on a rule miss from whatever `mcp_handler` the alias has)
was rejected: `scopes_supported` is the authorize flow's allowlist, and an emergent list that
an unrelated rule edit can change is not something to publish implicitly. Hand-written
documents keep working; `OAuthService` reads the step's config directly and fetches only for
those.

**Amended 2026-09-07 (#741).** A client may also identify itself by URL — a _Client ID
Metadata Document_ (draft-ietf-oauth-client-id-metadata-document), the mode claude.ai's
connector dialog marks "Recommended": `client_id` is an `https://` URL, CE fetches the
RFC 7591 metadata from it, requires the document's own `client_id` to equal that URL, and
proceeds as for a registered public client. No new table: the URL maps deterministically to
an `oauth_clients` uuid (uuid v5 under a pinned namespace) that is upserted with the
document's name and redirect URIs, so the uuid foreign keys on codes and refresh tokens hold
and the App Tokens page shows the client's name. The token endpoint maps the URL to that
uuid without fetching — the code plus PKCE verifier is the proof. Because the server fetches
a caller-supplied URL, the fetch is guarded (`ClientMetadataService`): https only, a domain
name never an IP literal, no local/cluster suffixes, every resolved address must be public
and the socket is pinned to those addresses, no redirects, 5 s timeout, 64 KiB cap; the
authorize endpoint (where the fetch happens) already requires a member session. Registration
stays as the fallback for hosts without hosted metadata.
