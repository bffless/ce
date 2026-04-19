# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.246](https://github.com/bffless/ce/compare/v0.0.245...v0.0.246) (2026-04-19)


### Features

* adds create issue handler ([318d76a](https://github.com/bffless/ce/commit/318d76abc253e3154bd5619bb755905650a66306))

## [0.0.245](https://github.com/bffless/ce/compare/v0.0.244...v0.0.245) (2026-04-19)


### Bug Fixes

* prioritize owner/repo over :id in project permission guard ([7b52109](https://github.com/bffless/ce/commit/7b52109154d887750afcd8309492f81e8cb14cc2))

## [0.0.244](https://github.com/bffless/ce/compare/v0.0.243...v0.0.244) (2026-04-19)


### Features

* add redirect URL to invite links and use project display name ([63bee45](https://github.com/bffless/ce/commit/63bee45a01e7118aba8401dbc72f073e7039c497))

## [0.0.243](https://github.com/bffless/ce/compare/v0.0.242...v0.0.243) (2026-04-19)


### Bug Fixes

* preserve projectInvite token across signup/login page links ([9043dda](https://github.com/bffless/ce/commit/9043ddadf9989e92106ce4d63d7d444e6172f562))

## [0.0.242](https://github.com/bffless/ce/compare/v0.0.241...v0.0.242) (2026-04-19)


### Features

* add project invite links for auto-granting project roles on signup ([c63e3af](https://github.com/bffless/ce/commit/c63e3af59b01e3591380e67898736b23aa2bc4e9))


### Bug Fixes

* add guest role to onboarding rules and make dialog scrollable ([2bc5983](https://github.com/bffless/ce/commit/2bc5983cc696cbb0b12e909b7126fcbecd54bf31))

## [0.0.241](https://github.com/bffless/ce/compare/v0.0.240...v0.0.241) (2026-04-18)


### Bug Fixes

* hide repositories link from members on homepage ([597799a](https://github.com/bffless/ce/commit/597799ad014c981e7cf9cde58185bbafc805f671))

## [0.0.240](https://github.com/bffless/ce/compare/v0.0.239...v0.0.240) (2026-04-18)


### Bug Fixes

* restrict project creation to admin global role only ([dbcd288](https://github.com/bffless/ce/commit/dbcd288405e08e4fb13290526f2547554252c024))

## [0.0.239](https://github.com/bffless/ce/compare/v0.0.238...v0.0.239) (2026-04-18)


### Bug Fixes

* add guest role to change member role dialog ([c974716](https://github.com/bffless/ce/commit/c9747168ec34d2dc9750fb82552d79027b41d38d))

## [0.0.238](https://github.com/bffless/ce/compare/v0.0.237...v0.0.238) (2026-04-18)


### Features

* add guest project role and restrict API keys to admins ([4cd00c8](https://github.com/bffless/ce/commit/4cd00c8cb1dbc1f4f44642d57d908338d031e174))


### Bug Fixes

* onboarding ([380ab5f](https://github.com/bffless/ce/commit/380ab5f79283003b7bbce6eafddc9b50e5092998))

## [0.0.237](https://github.com/bffless/ce/compare/v0.0.236...v0.0.237) (2026-04-18)


### Features

* add AI chat handler for pipelines with project-level AI settings ([a402db9](https://github.com/bffless/ce/commit/a402db989e1c6c248a7227550f2a06f55410fdce))
* add AI pipeline skills support ([8d1ded8](https://github.com/bffless/ce/commit/8d1ded8bf3c10d07d225436fcb67c2164b7961a0))
* add AI pipeline skills support ([8e915b4](https://github.com/bffless/ce/commit/8e915b402b3ee5cc9f8d52172a82f94e76bba5e0))
* add AI plugin system for executable tools in chat pipelines ([d96fc9d](https://github.com/bffless/ce/commit/d96fc9dfb0f16dc10d962de45aa97778d706bdd8))
* add alias and version columns to pipeline data schema ([db873df](https://github.com/bffless/ce/commit/db873df8700cadc3efac6214a0473920907748e5))
* add alias-level proxy rule set assignments ([10e1988](https://github.com/bffless/ce/commit/10e1988f11c50ae311568183fdbd4f0d79a0de2e))
* add auto-persistence for AI chat messages in streaming mode ([7967eb8](https://github.com/bffless/ce/commit/7967eb8a105d4a03f63197d5c9cbc812a8dc70ab))
* add change password to settings page ([c7fe76d](https://github.com/bffless/ce/commit/c7fe76dc03118022e73421d40f220074e1ab259e))
* add change password to settings page ([9b620c2](https://github.com/bffless/ce/commit/9b620c2d5abb254cff7cb627af8037dcf82782d3))
* add conditional validators for pipelines ([824bd8e](https://github.com/bffless/ce/commit/824bd8e2fbedbae23fb01114101e2fa330b6b9a8))
* add configurable input mapping for RAG Search embedding models ([45c5d9b](https://github.com/bffless/ce/commit/45c5d9b95689dc6ded74a07ab7ff7a872f138637))
* add copyable record IDs and recordId/single query options ([90f31db](https://github.com/bffless/ce/commit/90f31dba7a78808f2bfe485689a5ad630fe3ca01))
* add create_signed_url MCP tool for downloading storage files ([94f47aa](https://github.com/bffless/ce/commit/94f47aab43413b3fa3191c01fa93d0ab213f521c))
* add custom domain JWT auth support for pipeline execution ([1f0f9e1](https://github.com/bffless/ce/commit/1f0f9e16be3a06cbf59a75b12f6f5286d3ead41f))
* add custom headers for proxy rules and header-based traffic rules ([4b5ca0c](https://github.com/bffless/ce/commit/4b5ca0ccaca94e486aaed4819026352ed36d5ddf))
* add custom headers for proxy rules and header-based traffic rules ([1ac5774](https://github.com/bffless/ce/commit/1ac57743904c37e843820f76c51c7f15eff0abc9))
* add db_aggregate handler, expression support for query limit/offset ([c387abb](https://github.com/bffless/ce/commit/c387abbc68555163d848e191ecd405e7b7d7d6b0))
* add Email Contact chat plugin ([74ae23d](https://github.com/bffless/ce/commit/74ae23d06645dcc390c113b1f5f7190d739476a5))
* add extra fields mapping to file upload handler ([133f7a2](https://github.com/bffless/ce/commit/133f7a21126528f040ccfd6153244246ca144500))
* add extra fields support for ai_handler message persistence ([6505810](https://github.com/bffless/ce/commit/6505810676c3e89b5559e5494aac3d447b8b19e8))
* add file upload/serve pipeline handlers with schema generator ([ccf4724](https://github.com/bffless/ce/commit/ccf4724a5239bdb457f714864071ab76f58c0ff9))
* add file upload/serve pipeline handlers with schema generator ([ae2014d](https://github.com/bffless/ce/commit/ae2014dd5c746ca37365e3adde2dd3f1f03977d0))
* add GitHub integration and github_api pipeline handler ([0147b7e](https://github.com/bffless/ce/commit/0147b7ecd8adbce7b978dbd7f677f6449038e786))
* add github_api handler to MCP proxy rules tool schema ([36e0f91](https://github.com/bffless/ce/commit/36e0f91e12772a901764538c3447260065ee2952))
* add github_api handler to pipeline UI with config form ([5abc6bc](https://github.com/bffless/ce/commit/5abc6bc7a978a92d5f0c1791c8ff3437ae1a7306))
* add Google Calendar AI plugin with OAuth2 integration ([6a146f2](https://github.com/bffless/ce/commit/6a146f21f9a374157f6d938ddfcb55e70c06513e))
* add Google Meet link option and improve event descriptions for calendar plugin ([513b798](https://github.com/bffless/ce/commit/513b7986432bc9576dd2ec93b2aba058df896ee3))
* add Google OAuth sign-in and reorganize admin settings into tabs ([e3718d6](https://github.com/bffless/ce/commit/e3718d6ebafb51ad84e8915eeeca5f8b45dce1ff))
* add groupBy support to db_aggregate pipeline handler ([d1144c4](https://github.com/bffless/ce/commit/d1144c46c74cac00368d9dbd88c92d922c7bfc25))
* add HTTP method filtering to proxy rules ([7308484](https://github.com/bffless/ce/commit/73084848d494cfda0d0607c0d9b3366ce44810ff))
* add http_request pipeline handler for cross-project API calls ([086f6d5](https://github.com/bffless/ce/commit/086f6d5f8a81ecc67434b77d8aee2c969584e9ea))
* add image conversion, filename override, and grouped handler picker ([5e81a93](https://github.com/bffless/ce/commit/5e81a93a32932e63da735936e47736953b775cf0))
* add MCP server for CE admin API ([1d26a9c](https://github.com/bffless/ce/commit/1d26a9c114dd520db11541d61d8219260f3dd755))
* add MCP server for CE admin API ([6840ade](https://github.com/bffless/ce/commit/6840adede33d637d0b66433948afa99535d1a321))
* add per-step Stripe environment override (sandbox/production) ([6b59d7b](https://github.com/bffless/ce/commit/6b59d7baccadcc94d5e12c90fb159e8201cb594b))
* add per-variant path override for traffic splitting ([8fa91af](https://github.com/bffless/ce/commit/8fa91af90c3fd5418c0237024524ad9c8e4b74b9))
* add pgvector embedding storage and vector search pipeline handlers ([7c6ce6b](https://github.com/bffless/ce/commit/7c6ce6bba14f50d0e27096d27040eca7b4c2f2a1))
* add pipeline execution logging for debugging production pipeline runs ([9909ab8](https://github.com/bffless/ce/commit/9909ab87f3b977bfaa5941d19501a8255bbbc5d8))
* add pipeline foundation and data tab (Phase B + F) ([ee5b149](https://github.com/bffless/ce/commit/ee5b149f65f6ff1aae951204c563ba7106382f4a))
* add pipeline foundation and data tab (Phase B + F) ([65d3ba7](https://github.com/bffless/ce/commit/65d3ba73de66dab56334da67f4a17bdbebe43cd5))
* add proxyRuleSetId to update_alias and improve file upload docs ([0a0067c](https://github.com/bffless/ce/commit/0a0067cc196d0f0ef73fd9951fdaf8d273777664))
* add RAG Search AI plugin for semantic search and write-back ([5e5b511](https://github.com/bffless/ce/commit/5e5b5117bf553ab79c03bd6da82ba9a7fb3791d8))
* add Replicate AI pipeline handler and AI Services settings ([ade3b0b](https://github.com/bffless/ce/commit/ade3b0b9cc4fb2f7437bcd0e19cd4b674c178ed9))
* add request.ip, request.headers, request.userAgent to pipeline expressions ([28fff09](https://github.com/bffless/ce/commit/28fff091530fbefc7360cb54d47e694d96200c54))
* add response header rules for per-project iframe embedding control ([016ad1e](https://github.com/bffless/ce/commit/016ad1e69fb3dfe38b9323e1912b6caa6dcb5d77))
* add run_pipeline onboarding action and fix Stripe integration config merging ([1447e12](https://github.com/bffless/ce/commit/1447e12c98f8bffdbfd35d103e44a479648fb82b))
* add search and filtering to Data tab ([681decc](https://github.com/bffless/ce/commit/681decce39e92c2a22ca4129d5344fa1c6e6870c))
* add set_repo_variable action to github_api handler ([4c1d266](https://github.com/bffless/ce/commit/4c1d266452b1bd1177c98b48c433b31a34e1987c))
* add signed_url pipeline handler for presigned storage URLs ([d9f17b6](https://github.com/bffless/ce/commit/d9f17b6a388fc4290bdac35891e34da577f43ec5))
* add state schema generation and pipeline improvements ([959860a](https://github.com/bffless/ce/commit/959860af6822ca56158ae8cc39b06880226d8704))
* add Stripe payments integration with checkout and webhook pipeline handlers ([7822797](https://github.com/bffless/ce/commit/78227976fd747a510350b7f5d9541e4b90de3623))
* add update_pipeline_schema MCP tool ([94a7772](https://github.com/bffless/ce/commit/94a77722d552ef2c456de787fb4978c2715db668))
* adds branding ([a2ffe06](https://github.com/bffless/ce/commit/a2ffe06e695d47daa7909cbcd508475148484b8c))
* adds deployment alias to pipeline ([75d999e](https://github.com/bffless/ce/commit/75d999ebce59e1a9297af2547f7cf69fb56c503a))
* adds duplicate proxy ruleset ([a73719e](https://github.com/bffless/ce/commit/a73719e889251abce586d31894fd507d0bf13d18))
* AI handler for pipelines with project-level provider settings ([5dd67fc](https://github.com/bffless/ce/commit/5dd67fc946c8623dfbdf31bceb2ecc2e1b31ca39))
* AI plugin system for chat pipelines ([d24d5b8](https://github.com/bffless/ce/commit/d24d5b85db0b097f495be3cb2aa3dc876c85120d))
* capture client IP address in chat conversations ([9482139](https://github.com/bffless/ce/commit/9482139c162e3fc7f4783d522e354aecab78d919))
* capture post-processing steps debug info in pipeline execution logs ([38828da](https://github.com/bffless/ce/commit/38828da0c80cb38446750d258d5b5a5f1baf064a))
* completes test ([4637f59](https://github.com/bffless/ce/commit/4637f59a397b4329052ec4a2734fecac8ca7e1ea))
* configurable file field name and respect maxFileSize in multer ([858b497](https://github.com/bffless/ce/commit/858b497dc8ee878c772d0864fd168ac782abd9b7))
* configurable skills path and fix AI Data Tools userId in chat ([5406b8a](https://github.com/bffless/ce/commit/5406b8a64e38495dcfaeefedc322638c21e57dfd))
* default ENABLE_MINIO and ENABLE_REDIS to false ([295bb46](https://github.com/bffless/ce/commit/295bb4616e809244ee71bd58c13eab3d6d882f41))
* default new projects to public visibility ([bd53b1c](https://github.com/bffless/ce/commit/bd53b1c3893da716d91f9b815a77fad71e61b68a))
* enforce project visibility on proxy endpoints and improve token refresh signaling ([0c38151](https://github.com/bffless/ce/commit/0c381516ed5dc0ffa9ab7d14ef4db4a05c72bb5e))
* evolve RAG Search into AI Data Tools with multi-source support ([41bfedf](https://github.com/bffless/ce/commit/41bfedffe4e523f0310a1dc882ce05fe2768aa1b))
* google auth for self hosted ([7d189c2](https://github.com/bffless/ce/commit/7d189c25432d7ec4bf61873e59f1f9b771507c3c))
* google auth for self hosted ([8ca7a87](https://github.com/bffless/ce/commit/8ca7a87e71fb38bf698a3933197a7e354aeec517))
* Google Calendar AI plugin with OAuth2 ([e3749e3](https://github.com/bffless/ce/commit/e3749e311d029b91969dff155a76afbab145ea81))
* implement function handler with sandboxed JS execution (Phase D) ([5e342e4](https://github.com/bffless/ce/commit/5e342e4d08979ee078395b2702c15f9b30ddf608))
* implement handler library for pipelines (Phase C) ([e84bc74](https://github.com/bffless/ce/commit/e84bc744dff2c3d446567b51ab2b778d0bbb39d4))
* improve MCP tools for pipelines, domains, and proxy rules ([2151da1](https://github.com/bffless/ce/commit/2151da1841c70e6b20e1a606e05802971e00716f))
* include resolved system prompt and user message in AI handler debug output ([3d225b0](https://github.com/bffless/ce/commit/3d225b01a3e939981a6b84a511574d9c3378b47b))
* make Google OAuth shared at platform level with per-workspace opt-out ([d445e85](https://github.com/bffless/ce/commit/d445e8519204400698edfcb0d8cce121b230ba8d))
* move security headers from nginx to NestJS backend ([5a6f935](https://github.com/bffless/ce/commit/5a6f935b59af3ebd45e56300f61dab348d342fe7))
* per-step Stripe environment override ([08fa42d](https://github.com/bffless/ce/commit/08fa42d989205a1b83728a9f908de405bfa7b42d))
* pgvector embedding storage & vector search handlers ([1467b69](https://github.com/bffless/ce/commit/1467b69ba12de06e9a0d0cfda7e3bb4a09c9fa1e))
* pipeline UX improvements and validator support ([f9d4cf7](https://github.com/bffless/ce/commit/f9d4cf72df7727e8067a6fc21f0570e6a72dc0bf))
* post-processing steps to pipeline ([cc0ac25](https://github.com/bffless/ce/commit/cc0ac251462a959b07a15bcd5592768bf2a6bf15))
* post-processing steps to pipeline ([49582b2](https://github.com/bffless/ce/commit/49582b2b4f3b3b61310d94215dd206ce5d5fa2e1))
* **proxy-rules:** add ability to edit rule set name, environment, and description ([b74f703](https://github.com/bffless/ce/commit/b74f703c4de9eb6bd1c351a6b5c3bbea3eb2bc98))
* RAG Search AI plugin ([f00bb79](https://github.com/bffless/ce/commit/f00bb79e196e2ecfcd876a690b10b2d1d76ee981))
* refactor proxy rules to full-page views with path-based routing ([2a4d984](https://github.com/bffless/ce/commit/2a4d9845435f3707211e73adf3d8bd130671469f))
* refactor proxy rules to full-page views with path-based routing ([4238e23](https://github.com/bffless/ce/commit/4238e2334c1fe23e5be65ac76a6073dee9c5fb18))
* rename chat_handler to ai_handler with mode toggle ([b4c764f](https://github.com/bffless/ce/commit/b4c764f2d00c57b986dbf496eea2e4bda1ca5e7d))
* replace input with explicit request.body and request.query ([0993e26](https://github.com/bffless/ce/commit/0993e26819e484b8b7bdb52e5e97fc1f42b4f2ac))
* Replicate AI pipeline handler ([adb5b64](https://github.com/bffless/ce/commit/adb5b64bd013898a6e0684f52fc1623a9de2ec1f))
* show alias and version in data UI, auto-increment schema version ([397ac2f](https://github.com/bffless/ce/commit/397ac2f3e9d455338f8c54b77a96caf07eabc85c))
* stream files from storage to avoid OOM on large file serving ([bbcf2d7](https://github.com/bffless/ce/commit/bbcf2d7826339e1029bedc6431742d469cf6a1f8))
* Stripe payments integration ([f69ca59](https://github.com/bffless/ce/commit/f69ca59fb4d2b6108153d162dddfe5bdf023d6bb))
* support localhost dev auth with targetOrigin parameter ([aebc692](https://github.com/bffless/ce/commit/aebc6925b403e6966a92ae446e54430d77cb099d))
* support multiple default proxy rule sets per project ([f34c043](https://github.com/bffless/ce/commit/f34c043748b394a4a93149c3b104031bbd043769))
* system prompt height ([af08262](https://github.com/bffless/ce/commit/af08262b55c158b7f111436e1cf8a0a407cf0f6e))
* upload handler UI, pipeline tester file support, and admin previews ([dba80e8](https://github.com/bffless/ce/commit/dba80e81ff7f0fab658687745933d06b04c0e0e5))
* use Umbrel DEVICE_DOMAIN_NAME for SSH command in setup page ([a2117ef](https://github.com/bffless/ce/commit/a2117ef40fb2add3df1689b311184875b3ff255f))


### Bug Fixes

* add _bffless/auth proxy to subdomain/wildcard nginx configs ([64e054e](https://github.com/bffless/ce/commit/64e054e89f2a0167a86086962131303cabf6a384))
* add /mcp location to nginx configs for MCP endpoint proxying ([ba69496](https://github.com/bffless/ce/commit/ba69496f7a134364635fc19d99f5821a1d50b1ea))
* add /mcp proxy route to Umbrel nginx config ([4a20308](https://github.com/bffless/ce/commit/4a2030801a63c8316b0eb481b1342dab658159e9))
* add DomainsModule import to base @Module decorator for middleware DI ([c13334a](https://github.com/bffless/ce/commit/c13334ae8fda66f5158b5e7eedc3c9e6745dff11))
* add missing service mocks to ProxyRulesController test ([aeadb23](https://github.com/bffless/ce/commit/aeadb236f9f2903e91c6f0a00446b92f4de09ff9))
* add missing upload components and fix gitignore rule ([66f61b1](https://github.com/bffless/ce/commit/66f61b136507eac1f51f515ca799dbcbc28309dd))
* add SuperTokens session fallback to _bffless/auth/session endpoint ([e1c5964](https://github.com/bffless/ce/commit/e1c5964cd6ae3ac01ddab5fe06395cc95bf86163))
* add VisibilityService to AuthModule providers for middleware injection ([1ace13d](https://github.com/bffless/ce/commit/1ace13d262f069cc36149eaf1e4a2e951311d839))
* adds mcp for stripe ([4e4c55b](https://github.com/bffless/ce/commit/4e4c55b087224686ac97f18936c29cc93790ea65))
* adds stripe metadata ([2d5e06c](https://github.com/bffless/ce/commit/2d5e06c07ca475a9e1e65f5914d9b690733bc609))
* admin pipeline bugs ([97c97d4](https://github.com/bffless/ce/commit/97c97d4d60f63132e1c82930df4d8bcec17e3e0d))
* ai sdk chat v3 ([4c332c3](https://github.com/bffless/ce/commit/4c332c356d5605c7553b48d32ba3b74e72b23702))
* aligns cookie to supertokens expiration ([c135f86](https://github.com/bffless/ce/commit/c135f8610496fe7144354ad775675b945acaaa28))
* allow domain-token for workspace subdomains and all domain types ([dffbb7e](https://github.com/bffless/ce/commit/dffbb7e7b40824f3055509888c2f786031210967))
* allow proxy rule set IDs on alias creation ([5abb13d](https://github.com/bffless/ce/commit/5abb13dba612b277ce5f3db82888eabb8cd067ed))
* allow public domains to bypass auth middleware 401 on expired tokens ([83438aa](https://github.com/bffless/ce/commit/83438aa83c464f31c2c85d400d32c3923fde9c61))
* apply variant cookie to pipeline requests via dedicated domains ([be51bfe](https://github.com/bffless/ce/commit/be51bfeac2ecfbe8429e7e3099cca13c4e36bdcc))
* auth headers ([a893018](https://github.com/bffless/ce/commit/a8930187ac03d2f3a0033859df708ba05561b577))
* branding ([d9bdac5](https://github.com/bffless/ce/commit/d9bdac57f1bf4f4791b2e97a416eeae868e29f68))
* build ([336b7e2](https://github.com/bffless/ce/commit/336b7e2c2ffd74c7c1e6e60d38a3ff6718f6d98f))
* cache rules ([38312ee](https://github.com/bffless/ce/commit/38312eee91052f9b07a367a6d00e174a1dd2d864))
* calendar to support email to array ([8012e58](https://github.com/bffless/ce/commit/8012e58249461497066d467913eba956b72b5c7e))
* chat ([05d4f2f](https://github.com/bffless/ce/commit/05d4f2f6f622f88bd686e8c270c2aa31b4c626e7))
* chat metadata ([322a0e2](https://github.com/bffless/ce/commit/322a0e27d117c7398853bd81cca0c5baea6c60a4))
* chat streaming ([035bf3b](https://github.com/bffless/ce/commit/035bf3bf0e06663bfe08de137da735edaf1a5c83))
* circular dep ([825a574](https://github.com/bffless/ce/commit/825a574be6ed36b1ab162dc50f6ebe7752b34a3b))
* condition negation, function debug mode, and unsaved changes indicator ([c01cc9d](https://github.com/bffless/ce/commit/c01cc9d589dfd76ee0523260f7d9ec6751f452a2))
* custom domain cookie length ([d845fad](https://github.com/bffless/ce/commit/d845fad9fcd25cd18a5564e115bc3ac50a6bba40))
* date bucket not included in url for file upload ([67e6d63](https://github.com/bffless/ce/commit/67e6d63c5a1f2167b3795322141b5af7aacf50c6))
* default Google OAuth to false for CE, add enable validation ([eb908d2](https://github.com/bffless/ce/commit/eb908d26221b6d3fe7bd5d8e08544b9f30e22013))
* email send, dont await ([e18170c](https://github.com/bffless/ce/commit/e18170c0a022166e540bf71bf6adeed162ca72db))
* ensure AI collects at least one contact method (email or phone) ([1aa45b9](https://github.com/bffless/ce/commit/1aa45b9f7ed0e26741a3fbc647bd2ac30c0423dd))
* evaluate traffic rules in proxy middleware for pipelines ([e92c0fd](https://github.com/bffless/ce/commit/e92c0fd51b8ea6207fd73edd720cd4a36bb167e6))
* evaluate traffic rules in proxy middleware for pipelines ([1d73dbf](https://github.com/bffless/ce/commit/1d73dbfdb20d4e1129d9e0d0697dd57b3bd27890))
* exclude auth endpoints from token expiry check and use domain visibility ([c9f7327](https://github.com/bffless/ce/commit/c9f732714f970dc5f5f8f05cd317bf351aadeb6e))
* exclude auto-preview aliases from refs endpoint ([96a9fb6](https://github.com/bffless/ce/commit/96a9fb60aa087a2c1a0635532c92e508fcc4b8eb))
* expression evaluator handles literal values and add Monaco for email body ([218dc04](https://github.com/bffless/ce/commit/218dc04d742caa4179f050697d2b4964a7c3939c))
* external redirect ([f94de63](https://github.com/bffless/ce/commit/f94de633ded62abc0c0889b93745da73e20e5666))
* extract user from session in proxy middleware for pipelines ([ac57d12](https://github.com/bffless/ce/commit/ac57d12a149be65ce31bed1f7300c8c787b6bb9e))
* file serve handler ([862d792](https://github.com/bffless/ce/commit/862d7921477f22f2d4a791c99dc6a1283c06ea63))
* forward multiple Set-Cookie headers correctly through proxy rules ([ebe3d65](https://github.com/bffless/ce/commit/ebe3d657b05cbccd8a90cc2f2d73914782d39742))
* GitHub integration UI polish — persist defaultOrg, hide sandbox badge ([89e64c4](https://github.com/bffless/ce/commit/89e64c434e2c51bdd08227e0c1e080d72f566b44))
* helmet ([241cf8b](https://github.com/bffless/ce/commit/241cf8b97ba47da965762e87f56b39dd1a6e54d9))
* honeypot ([78d02f9](https://github.com/bffless/ce/commit/78d02f9d57cf13842f4fc7a70f2e2170d0e3a499))
* html default email ([cea3ff4](https://github.com/bffless/ce/commit/cea3ff41fab09539c4f9119424e72e32bb479a5c))
* improve RAG vector search result quality with filtering and diversity ([5f9e323](https://github.com/bffless/ce/commit/5f9e323a7d404943d24b807f360a1fbcb235147a))
* include cache-control header in ETag to invalidate CDN on rule changes ([8fb5798](https://github.com/bffless/ce/commit/8fb5798506b1f3d1be091627569f8e83011c32b1))
* increase replicate poll interval and respect step timeout config ([26e28d4](https://github.com/bffless/ce/commit/26e28d488c9a3529038f772d1468722be45731c3))
* ip ([2d7c676](https://github.com/bffless/ce/commit/2d7c676ebe4803e60f5f3990e78835e9d92cae77))
* json parsing ([4382fbe](https://github.com/bffless/ce/commit/4382fbe174d0cd106d04ff7f53391d112e1a7446))
* lint ([611e260](https://github.com/bffless/ce/commit/611e260a2a9f71aa7fcb3f8ef818e53306e9081e))
* login issues ([b19915e](https://github.com/bffless/ce/commit/b19915eb30e5a099d7e9120796e5535d7771b71f))
* logo ([c78a3b7](https://github.com/bffless/ce/commit/c78a3b78f44f7240e18b6e82fcc1e638e70b14d5))
* make generate upload modal scrollable ([901a4b0](https://github.com/bffless/ce/commit/901a4b045fb6e1ec3de493e36246bda31e20c571))
* merge default frame ancestors with custom allowed origins ([552043f](https://github.com/bffless/ce/commit/552043fce386e5efbb083b1ed5e11320cc75d7e3))
* nginx ([48ee59a](https://github.com/bffless/ce/commit/48ee59a0671de2ed57317ae6bf366682be636beb))
* pass deployment context to pipeline function handler sandbox ([cd9b435](https://github.com/bffless/ce/commit/cd9b4350c4459f2db719135534373651ffe96b33))
* pass full conversation messages to email-contact plugin ([8ab2e71](https://github.com/bffless/ce/commit/8ab2e71661895f3fcf98b2501d16917a18f8aba4))
* persist redirect URL through email verification flow ([d549975](https://github.com/bffless/ce/commit/d549975fe7cba5a880ae35d303b8027d2468684c))
* pipeline execution ([a552c53](https://github.com/bffless/ce/commit/a552c5397715e355e20b9d1e7203b5725196fdf6))
* post processing dto ([3870b20](https://github.com/bffless/ce/commit/3870b2094a002c37ec2c7cf720eb98b82d646850))
* proper HTTP status codes for pipeline errors and add auth debug logging ([da5d075](https://github.com/bffless/ce/commit/da5d075f0f5032d409a165d002c014035d69e763))
* read publicConfig from production slot for single-env integrations ([9958e89](https://github.com/bffless/ce/commit/9958e893a0ffe6a2f55d1504c8a236ef140db1d0))
* recordId for update and delete pipeline ([64fb6ef](https://github.com/bffless/ce/commit/64fb6efe4a75841087738fcf91da08bd943bcece))
* remove heic-convert dependency, reject HEIC uploads server-side ([36e651c](https://github.com/bffless/ce/commit/36e651cb77abb4f3449a681cc211cd5d56404c6a))
* rename setup checkEmail endpoint to avoid RTK Query collision with authApi ([a6b4d55](https://github.com/bffless/ce/commit/a6b4d559d2be1494425e2042e124518db6a3de55))
* repo feed shows only member repos, preserve redirect through email verification ([5297adc](https://github.com/bffless/ce/commit/5297adc445da7d1234689745459b54c7497e80a4))
* reset lastModifiedAt after save to clear dirty state ([0f27546](https://github.com/bffless/ce/commit/0f27546b570e68575552398e90a6356c6aba384e))
* revert full conversation messages in email-contact plugin ([c71cb90](https://github.com/bffless/ce/commit/c71cb90b4d6eb224580d0ba57c7cafe0bc4b828c))
* reverts member view ([090277c](https://github.com/bffless/ce/commit/090277cbea23c59db056cfff0b2d67883e35af7b))
* save user message and conversation when using smart defaults ([d3f7488](https://github.com/bffless/ce/commit/d3f7488e4e13addff0f5c208feb90b2d72a05056))
* signed url to mcp server ([d53a043](https://github.com/bffless/ce/commit/d53a0435f44a9571ff672888bd97eae0476168e4))
* skip domain mismatch check and secure cookies for localhost tokens ([a18097d](https://github.com/bffless/ce/commit/a18097d4c1ca6757507c93f663545e1d1666f6bf))
* skip domain validation on session and refresh endpoints for localhost ([82b005a](https://github.com/bffless/ce/commit/82b005a42eb0e388e9f9109e362dd7bd7a226598))
* skipped steps preserve previous output, form handler reads query params ([f36a9aa](https://github.com/bffless/ce/commit/f36a9aa32f16a704b128242e128840dcc2f5355f))
* slim down chunked vector search results to avoid redundant data ([0d800f0](https://github.com/bffless/ce/commit/0d800f0050821c0464d449e5145d6e64be0f8977))
* storage adapters and chat ([4e39789](https://github.com/bffless/ce/commit/4e39789bab7d2e67bd4ea2f8ce5fcc20626c3f52))
* support object body format in HttpRequestConfig UI ([58f59c9](https://github.com/bffless/ce/commit/58f59c9df78ae7c9a3a0e03880c083a680742f9e))
* surface image conversion errors instead of silently falling back ([54d6b9a](https://github.com/bffless/ce/commit/54d6b9a29e167f3dac07cbb6ee9f7be5469a78e7))
* swap nginx-baked path prefix when traffic variant has path override ([8a191e5](https://github.com/bffless/ce/commit/8a191e5325466700f00c10cd6fd80723719633df))
* tests ([2ed83c4](https://github.com/bffless/ce/commit/2ed83c415863592f0de175215bb6043dafec5016))
* tests ([ca04b02](https://github.com/bffless/ce/commit/ca04b02eaa2698098c143bd2cba86f815730a472))
* textarea changes ([f75203a](https://github.com/bffless/ce/commit/f75203ab3b05ab455c2190613f4a9c2ed9865523))
* trim whitespace from cache rule path patterns ([a0c54e8](https://github.com/bffless/ce/commit/a0c54e82491df3fa831b6ecfcb9c1f118de59141))
* triple-brace template expressions should not JSON-quote string primitives ([7d14a71](https://github.com/bffless/ce/commit/7d14a71fe784749466f73cf9c9a7cad11d3a3dfd))
* try refresh token ([dd814f9](https://github.com/bffless/ce/commit/dd814f983208c5e9ae4e1c7fde524c4f3e3fd646))
* ts issues ([e10a361](https://github.com/bffless/ce/commit/e10a36132f7a983b933883c39a4c72643e2d02a0))
* typeahead ([881fcbb](https://github.com/bffless/ce/commit/881fcbba1a2c02c1e842c935be84a4e1c25e8947))
* **umbrel:** serve static assets on domain-not-configured page ([ec9d6ba](https://github.com/bffless/ce/commit/ec9d6ba35c5590487a6d2a74cd68131114d9553a))
* **umbrel:** show helpful setup page when domain not configured ([135e603](https://github.com/bffless/ce/commit/135e60316f89aa8297f469b4ab367cacdee29073))
* use app DB user ID for session when existing user signs in via Google ([40be2fb](https://github.com/bffless/ce/commit/40be2fb78d2ed75a55600aaf6d723085e204179d))
* use heic-convert for HEIC decoding instead of relying on system libheif ([df2facb](https://github.com/bffless/ce/commit/df2facbc80f87db58af3f5f84761b70798e9cbaa))
* use native sharp for HEIC conversion with heic-convert fallback ([e8da604](https://github.com/bffless/ce/commit/e8da6040c1f8bb8aa79f2632e4e8618b60a7df81))
* use SchemaFieldPicker and ExpressionInput for upload extra fields ([e412c13](https://github.com/bffless/ce/commit/e412c13245b7b68e2e8184cc7c9874ee7d250055))
* wait for apt lock before installing prerequisites ([3823b83](https://github.com/bffless/ce/commit/3823b836224d97a71fd6240b27dd7a56c0acd7c3))
* warn on low-memory systems and increase SuperTokens healthcheck timeout ([6b6614e](https://github.com/bffless/ce/commit/6b6614ebe8a0a3d4fc1419ee91eb30dfc6a94519))


### Performance Improvements

* filter large text fields at SQL level in vector search ([08fd265](https://github.com/bffless/ce/commit/08fd2658528726396712b419393ff186841544cc))


### Reverts

* pass full conversation messages to email-contact plugin ([454dd9a](https://github.com/bffless/ce/commit/454dd9aba92a81b28dc7b81cd6c904d54bf53475))

## [0.0.236](https://github.com/bffless/ce/compare/v0.0.235...v0.0.236) (2026-04-18)


### Features

* add set_repo_variable action to github_api handler ([4c1d266](https://github.com/bffless/ce/commit/4c1d266452b1bd1177c98b48c433b31a34e1987c))

## [0.0.235](https://github.com/bffless/ce/compare/v0.0.234...v0.0.235) (2026-04-18)


### Features

* add github_api handler to MCP proxy rules tool schema ([36e0f91](https://github.com/bffless/ce/commit/36e0f91e12772a901764538c3447260065ee2952))

## [0.0.234](https://github.com/bffless/ce/compare/v0.0.233...v0.0.234) (2026-04-18)


### Features

* add github_api handler to pipeline UI with config form ([5abc6bc](https://github.com/bffless/ce/commit/5abc6bc7a978a92d5f0c1791c8ff3437ae1a7306))

## [0.0.233](https://github.com/bffless/ce/compare/v0.0.232...v0.0.233) (2026-04-18)


### Bug Fixes

* read publicConfig from production slot for single-env integrations ([9958e89](https://github.com/bffless/ce/commit/9958e893a0ffe6a2f55d1504c8a236ef140db1d0))

## [0.0.232](https://github.com/bffless/ce/compare/v0.0.231...v0.0.232) (2026-04-18)


### Features

* add AI chat handler for pipelines with project-level AI settings ([a402db9](https://github.com/bffless/ce/commit/a402db989e1c6c248a7227550f2a06f55410fdce))
* add AI pipeline skills support ([8d1ded8](https://github.com/bffless/ce/commit/8d1ded8bf3c10d07d225436fcb67c2164b7961a0))
* add AI pipeline skills support ([8e915b4](https://github.com/bffless/ce/commit/8e915b402b3ee5cc9f8d52172a82f94e76bba5e0))
* add AI plugin system for executable tools in chat pipelines ([d96fc9d](https://github.com/bffless/ce/commit/d96fc9dfb0f16dc10d962de45aa97778d706bdd8))
* add alias and version columns to pipeline data schema ([db873df](https://github.com/bffless/ce/commit/db873df8700cadc3efac6214a0473920907748e5))
* add alias-level proxy rule set assignments ([10e1988](https://github.com/bffless/ce/commit/10e1988f11c50ae311568183fdbd4f0d79a0de2e))
* add auto-persistence for AI chat messages in streaming mode ([7967eb8](https://github.com/bffless/ce/commit/7967eb8a105d4a03f63197d5c9cbc812a8dc70ab))
* add change password to settings page ([c7fe76d](https://github.com/bffless/ce/commit/c7fe76dc03118022e73421d40f220074e1ab259e))
* add change password to settings page ([9b620c2](https://github.com/bffless/ce/commit/9b620c2d5abb254cff7cb627af8037dcf82782d3))
* add conditional validators for pipelines ([824bd8e](https://github.com/bffless/ce/commit/824bd8e2fbedbae23fb01114101e2fa330b6b9a8))
* add configurable input mapping for RAG Search embedding models ([45c5d9b](https://github.com/bffless/ce/commit/45c5d9b95689dc6ded74a07ab7ff7a872f138637))
* add copyable record IDs and recordId/single query options ([90f31db](https://github.com/bffless/ce/commit/90f31dba7a78808f2bfe485689a5ad630fe3ca01))
* add create_signed_url MCP tool for downloading storage files ([94f47aa](https://github.com/bffless/ce/commit/94f47aab43413b3fa3191c01fa93d0ab213f521c))
* add custom domain JWT auth support for pipeline execution ([1f0f9e1](https://github.com/bffless/ce/commit/1f0f9e16be3a06cbf59a75b12f6f5286d3ead41f))
* add custom headers for proxy rules and header-based traffic rules ([4b5ca0c](https://github.com/bffless/ce/commit/4b5ca0ccaca94e486aaed4819026352ed36d5ddf))
* add custom headers for proxy rules and header-based traffic rules ([1ac5774](https://github.com/bffless/ce/commit/1ac57743904c37e843820f76c51c7f15eff0abc9))
* add db_aggregate handler, expression support for query limit/offset ([c387abb](https://github.com/bffless/ce/commit/c387abbc68555163d848e191ecd405e7b7d7d6b0))
* add Email Contact chat plugin ([74ae23d](https://github.com/bffless/ce/commit/74ae23d06645dcc390c113b1f5f7190d739476a5))
* add extra fields mapping to file upload handler ([133f7a2](https://github.com/bffless/ce/commit/133f7a21126528f040ccfd6153244246ca144500))
* add extra fields support for ai_handler message persistence ([6505810](https://github.com/bffless/ce/commit/6505810676c3e89b5559e5494aac3d447b8b19e8))
* add file upload/serve pipeline handlers with schema generator ([ccf4724](https://github.com/bffless/ce/commit/ccf4724a5239bdb457f714864071ab76f58c0ff9))
* add file upload/serve pipeline handlers with schema generator ([ae2014d](https://github.com/bffless/ce/commit/ae2014dd5c746ca37365e3adde2dd3f1f03977d0))
* add GitHub integration and github_api pipeline handler ([0147b7e](https://github.com/bffless/ce/commit/0147b7ecd8adbce7b978dbd7f677f6449038e786))
* add Google Calendar AI plugin with OAuth2 integration ([6a146f2](https://github.com/bffless/ce/commit/6a146f21f9a374157f6d938ddfcb55e70c06513e))
* add Google Meet link option and improve event descriptions for calendar plugin ([513b798](https://github.com/bffless/ce/commit/513b7986432bc9576dd2ec93b2aba058df896ee3))
* add Google OAuth sign-in and reorganize admin settings into tabs ([e3718d6](https://github.com/bffless/ce/commit/e3718d6ebafb51ad84e8915eeeca5f8b45dce1ff))
* add groupBy support to db_aggregate pipeline handler ([d1144c4](https://github.com/bffless/ce/commit/d1144c46c74cac00368d9dbd88c92d922c7bfc25))
* add HTTP method filtering to proxy rules ([7308484](https://github.com/bffless/ce/commit/73084848d494cfda0d0607c0d9b3366ce44810ff))
* add http_request pipeline handler for cross-project API calls ([086f6d5](https://github.com/bffless/ce/commit/086f6d5f8a81ecc67434b77d8aee2c969584e9ea))
* add image conversion, filename override, and grouped handler picker ([5e81a93](https://github.com/bffless/ce/commit/5e81a93a32932e63da735936e47736953b775cf0))
* add MCP server for CE admin API ([1d26a9c](https://github.com/bffless/ce/commit/1d26a9c114dd520db11541d61d8219260f3dd755))
* add MCP server for CE admin API ([6840ade](https://github.com/bffless/ce/commit/6840adede33d637d0b66433948afa99535d1a321))
* add per-step Stripe environment override (sandbox/production) ([6b59d7b](https://github.com/bffless/ce/commit/6b59d7baccadcc94d5e12c90fb159e8201cb594b))
* add per-variant path override for traffic splitting ([8fa91af](https://github.com/bffless/ce/commit/8fa91af90c3fd5418c0237024524ad9c8e4b74b9))
* add pgvector embedding storage and vector search pipeline handlers ([7c6ce6b](https://github.com/bffless/ce/commit/7c6ce6bba14f50d0e27096d27040eca7b4c2f2a1))
* add pipeline execution logging for debugging production pipeline runs ([9909ab8](https://github.com/bffless/ce/commit/9909ab87f3b977bfaa5941d19501a8255bbbc5d8))
* add pipeline foundation and data tab (Phase B + F) ([ee5b149](https://github.com/bffless/ce/commit/ee5b149f65f6ff1aae951204c563ba7106382f4a))
* add pipeline foundation and data tab (Phase B + F) ([65d3ba7](https://github.com/bffless/ce/commit/65d3ba73de66dab56334da67f4a17bdbebe43cd5))
* add proxyRuleSetId to update_alias and improve file upload docs ([0a0067c](https://github.com/bffless/ce/commit/0a0067cc196d0f0ef73fd9951fdaf8d273777664))
* add RAG Search AI plugin for semantic search and write-back ([5e5b511](https://github.com/bffless/ce/commit/5e5b5117bf553ab79c03bd6da82ba9a7fb3791d8))
* add Replicate AI pipeline handler and AI Services settings ([ade3b0b](https://github.com/bffless/ce/commit/ade3b0b9cc4fb2f7437bcd0e19cd4b674c178ed9))
* add request.ip, request.headers, request.userAgent to pipeline expressions ([28fff09](https://github.com/bffless/ce/commit/28fff091530fbefc7360cb54d47e694d96200c54))
* add response header rules for per-project iframe embedding control ([016ad1e](https://github.com/bffless/ce/commit/016ad1e69fb3dfe38b9323e1912b6caa6dcb5d77))
* add run_pipeline onboarding action and fix Stripe integration config merging ([1447e12](https://github.com/bffless/ce/commit/1447e12c98f8bffdbfd35d103e44a479648fb82b))
* add search and filtering to Data tab ([681decc](https://github.com/bffless/ce/commit/681decce39e92c2a22ca4129d5344fa1c6e6870c))
* add session endpoint for custom domain authentication ([8198cab](https://github.com/bffless/ce/commit/8198cab6c116350acf21e0cdbef2b83a4c994011))
* add session endpoint to nginx custom domain template ([134eb87](https://github.com/bffless/ce/commit/134eb870308a0bea57cab3d456745c3a89991ab6))
* add signed_url pipeline handler for presigned storage URLs ([d9f17b6](https://github.com/bffless/ce/commit/d9f17b6a388fc4290bdac35891e34da577f43ec5))
* add state schema generation and pipeline improvements ([959860a](https://github.com/bffless/ce/commit/959860af6822ca56158ae8cc39b06880226d8704))
* add Stripe payments integration with checkout and webhook pipeline handlers ([7822797](https://github.com/bffless/ce/commit/78227976fd747a510350b7f5d9541e4b90de3623))
* add update_pipeline_schema MCP tool ([94a7772](https://github.com/bffless/ce/commit/94a77722d552ef2c456de787fb4978c2715db668))
* adds branding ([a2ffe06](https://github.com/bffless/ce/commit/a2ffe06e695d47daa7909cbcd508475148484b8c))
* adds deployment alias to pipeline ([75d999e](https://github.com/bffless/ce/commit/75d999ebce59e1a9297af2547f7cf69fb56c503a))
* adds duplicate proxy ruleset ([a73719e](https://github.com/bffless/ce/commit/a73719e889251abce586d31894fd507d0bf13d18))
* AI handler for pipelines with project-level provider settings ([5dd67fc](https://github.com/bffless/ce/commit/5dd67fc946c8623dfbdf31bceb2ecc2e1b31ca39))
* AI plugin system for chat pipelines ([d24d5b8](https://github.com/bffless/ce/commit/d24d5b85db0b097f495be3cb2aa3dc876c85120d))
* capture client IP address in chat conversations ([9482139](https://github.com/bffless/ce/commit/9482139c162e3fc7f4783d522e354aecab78d919))
* capture post-processing steps debug info in pipeline execution logs ([38828da](https://github.com/bffless/ce/commit/38828da0c80cb38446750d258d5b5a5f1baf064a))
* completes test ([4637f59](https://github.com/bffless/ce/commit/4637f59a397b4329052ec4a2734fecac8ca7e1ea))
* configurable file field name and respect maxFileSize in multer ([858b497](https://github.com/bffless/ce/commit/858b497dc8ee878c772d0864fd168ac782abd9b7))
* configurable skills path and fix AI Data Tools userId in chat ([5406b8a](https://github.com/bffless/ce/commit/5406b8a64e38495dcfaeefedc322638c21e57dfd))
* default ENABLE_MINIO and ENABLE_REDIS to false ([295bb46](https://github.com/bffless/ce/commit/295bb4616e809244ee71bd58c13eab3d6d882f41))
* default new projects to public visibility ([bd53b1c](https://github.com/bffless/ce/commit/bd53b1c3893da716d91f9b815a77fad71e61b68a))
* enforce project visibility on proxy endpoints and improve token refresh signaling ([0c38151](https://github.com/bffless/ce/commit/0c381516ed5dc0ffa9ab7d14ef4db4a05c72bb5e))
* evolve RAG Search into AI Data Tools with multi-source support ([41bfedf](https://github.com/bffless/ce/commit/41bfedffe4e523f0310a1dc882ce05fe2768aa1b))
* google auth for self hosted ([7d189c2](https://github.com/bffless/ce/commit/7d189c25432d7ec4bf61873e59f1f9b771507c3c))
* google auth for self hosted ([8ca7a87](https://github.com/bffless/ce/commit/8ca7a87e71fb38bf698a3933197a7e354aeec517))
* Google Calendar AI plugin with OAuth2 ([e3749e3](https://github.com/bffless/ce/commit/e3749e311d029b91969dff155a76afbab145ea81))
* implement function handler with sandboxed JS execution (Phase D) ([5e342e4](https://github.com/bffless/ce/commit/5e342e4d08979ee078395b2702c15f9b30ddf608))
* implement handler library for pipelines (Phase C) ([e84bc74](https://github.com/bffless/ce/commit/e84bc744dff2c3d446567b51ab2b778d0bbb39d4))
* improve MCP tools for pipelines, domains, and proxy rules ([2151da1](https://github.com/bffless/ce/commit/2151da1841c70e6b20e1a606e05802971e00716f))
* include resolved system prompt and user message in AI handler debug output ([3d225b0](https://github.com/bffless/ce/commit/3d225b01a3e939981a6b84a511574d9c3378b47b))
* make Google OAuth shared at platform level with per-workspace opt-out ([d445e85](https://github.com/bffless/ce/commit/d445e8519204400698edfcb0d8cce121b230ba8d))
* move security headers from nginx to NestJS backend ([5a6f935](https://github.com/bffless/ce/commit/5a6f935b59af3ebd45e56300f61dab348d342fe7))
* per-step Stripe environment override ([08fa42d](https://github.com/bffless/ce/commit/08fa42d989205a1b83728a9f908de405bfa7b42d))
* pgvector embedding storage & vector search handlers ([1467b69](https://github.com/bffless/ce/commit/1467b69ba12de06e9a0d0cfda7e3bb4a09c9fa1e))
* pipeline UX improvements and validator support ([f9d4cf7](https://github.com/bffless/ce/commit/f9d4cf72df7727e8067a6fc21f0570e6a72dc0bf))
* post-processing steps to pipeline ([cc0ac25](https://github.com/bffless/ce/commit/cc0ac251462a959b07a15bcd5592768bf2a6bf15))
* post-processing steps to pipeline ([49582b2](https://github.com/bffless/ce/commit/49582b2b4f3b3b61310d94215dd206ce5d5fa2e1))
* **proxy-rules:** add ability to edit rule set name, environment, and description ([b74f703](https://github.com/bffless/ce/commit/b74f703c4de9eb6bd1c351a6b5c3bbea3eb2bc98))
* RAG Search AI plugin ([f00bb79](https://github.com/bffless/ce/commit/f00bb79e196e2ecfcd876a690b10b2d1d76ee981))
* refactor proxy rules to full-page views with path-based routing ([2a4d984](https://github.com/bffless/ce/commit/2a4d9845435f3707211e73adf3d8bd130671469f))
* refactor proxy rules to full-page views with path-based routing ([4238e23](https://github.com/bffless/ce/commit/4238e2334c1fe23e5be65ac76a6073dee9c5fb18))
* rename chat_handler to ai_handler with mode toggle ([b4c764f](https://github.com/bffless/ce/commit/b4c764f2d00c57b986dbf496eea2e4bda1ca5e7d))
* replace input with explicit request.body and request.query ([0993e26](https://github.com/bffless/ce/commit/0993e26819e484b8b7bdb52e5e97fc1f42b4f2ac))
* Replicate AI pipeline handler ([adb5b64](https://github.com/bffless/ce/commit/adb5b64bd013898a6e0684f52fc1623a9de2ec1f))
* show alias and version in data UI, auto-increment schema version ([397ac2f](https://github.com/bffless/ce/commit/397ac2f3e9d455338f8c54b77a96caf07eabc85c))
* stream files from storage to avoid OOM on large file serving ([bbcf2d7](https://github.com/bffless/ce/commit/bbcf2d7826339e1029bedc6431742d469cf6a1f8))
* Stripe payments integration ([f69ca59](https://github.com/bffless/ce/commit/f69ca59fb4d2b6108153d162dddfe5bdf023d6bb))
* support localhost dev auth with targetOrigin parameter ([aebc692](https://github.com/bffless/ce/commit/aebc6925b403e6966a92ae446e54430d77cb099d))
* support multiple default proxy rule sets per project ([f34c043](https://github.com/bffless/ce/commit/f34c043748b394a4a93149c3b104031bbd043769))
* system prompt height ([af08262](https://github.com/bffless/ce/commit/af08262b55c158b7f111436e1cf8a0a407cf0f6e))
* upload handler UI, pipeline tester file support, and admin previews ([dba80e8](https://github.com/bffless/ce/commit/dba80e81ff7f0fab658687745933d06b04c0e0e5))
* use Umbrel DEVICE_DOMAIN_NAME for SSH command in setup page ([a2117ef](https://github.com/bffless/ce/commit/a2117ef40fb2add3df1689b311184875b3ff255f))


### Bug Fixes

* add _bffless/auth proxy to subdomain/wildcard nginx configs ([64e054e](https://github.com/bffless/ce/commit/64e054e89f2a0167a86086962131303cabf6a384))
* add /mcp location to nginx configs for MCP endpoint proxying ([ba69496](https://github.com/bffless/ce/commit/ba69496f7a134364635fc19d99f5821a1d50b1ea))
* add /mcp proxy route to Umbrel nginx config ([4a20308](https://github.com/bffless/ce/commit/4a2030801a63c8316b0eb481b1342dab658159e9))
* add DomainsModule import to base @Module decorator for middleware DI ([c13334a](https://github.com/bffless/ce/commit/c13334ae8fda66f5158b5e7eedc3c9e6745dff11))
* add missing service mocks to ProxyRulesController test ([aeadb23](https://github.com/bffless/ce/commit/aeadb236f9f2903e91c6f0a00446b92f4de09ff9))
* add missing upload components and fix gitignore rule ([66f61b1](https://github.com/bffless/ce/commit/66f61b136507eac1f51f515ca799dbcbc28309dd))
* add SuperTokens session fallback to _bffless/auth/session endpoint ([e1c5964](https://github.com/bffless/ce/commit/e1c5964cd6ae3ac01ddab5fe06395cc95bf86163))
* add VisibilityService to AuthModule providers for middleware injection ([1ace13d](https://github.com/bffless/ce/commit/1ace13d262f069cc36149eaf1e4a2e951311d839))
* adds mcp for stripe ([4e4c55b](https://github.com/bffless/ce/commit/4e4c55b087224686ac97f18936c29cc93790ea65))
* adds stripe metadata ([2d5e06c](https://github.com/bffless/ce/commit/2d5e06c07ca475a9e1e65f5914d9b690733bc609))
* admin pipeline bugs ([97c97d4](https://github.com/bffless/ce/commit/97c97d4d60f63132e1c82930df4d8bcec17e3e0d))
* ai sdk chat v3 ([4c332c3](https://github.com/bffless/ce/commit/4c332c356d5605c7553b48d32ba3b74e72b23702))
* aligns cookie to supertokens expiration ([c135f86](https://github.com/bffless/ce/commit/c135f8610496fe7144354ad775675b945acaaa28))
* allow domain-token for workspace subdomains and all domain types ([dffbb7e](https://github.com/bffless/ce/commit/dffbb7e7b40824f3055509888c2f786031210967))
* allow proxy rule set IDs on alias creation ([5abb13d](https://github.com/bffless/ce/commit/5abb13dba612b277ce5f3db82888eabb8cd067ed))
* allow public domains to bypass auth middleware 401 on expired tokens ([83438aa](https://github.com/bffless/ce/commit/83438aa83c464f31c2c85d400d32c3923fde9c61))
* apply variant cookie to pipeline requests via dedicated domains ([be51bfe](https://github.com/bffless/ce/commit/be51bfeac2ecfbe8429e7e3099cca13c4e36bdcc))
* auth headers ([a893018](https://github.com/bffless/ce/commit/a8930187ac03d2f3a0033859df708ba05561b577))
* branding ([d9bdac5](https://github.com/bffless/ce/commit/d9bdac57f1bf4f4791b2e97a416eeae868e29f68))
* build ([336b7e2](https://github.com/bffless/ce/commit/336b7e2c2ffd74c7c1e6e60d38a3ff6718f6d98f))
* cache rules ([38312ee](https://github.com/bffless/ce/commit/38312eee91052f9b07a367a6d00e174a1dd2d864))
* calendar to support email to array ([8012e58](https://github.com/bffless/ce/commit/8012e58249461497066d467913eba956b72b5c7e))
* change SameSite from strict to lax for custom domain cookies ([a9d568d](https://github.com/bffless/ce/commit/a9d568d73dcc3d5679c2432fb41d9bbfef12b17d))
* chat ([05d4f2f](https://github.com/bffless/ce/commit/05d4f2f6f622f88bd686e8c270c2aa31b4c626e7))
* chat metadata ([322a0e2](https://github.com/bffless/ce/commit/322a0e27d117c7398853bd81cca0c5baea6c60a4))
* chat streaming ([035bf3b](https://github.com/bffless/ce/commit/035bf3bf0e06663bfe08de137da735edaf1a5c83))
* circular dep ([825a574](https://github.com/bffless/ce/commit/825a574be6ed36b1ab162dc50f6ebe7752b34a3b))
* condition negation, function debug mode, and unsaved changes indicator ([c01cc9d](https://github.com/bffless/ce/commit/c01cc9d589dfd76ee0523260f7d9ec6751f452a2))
* custom domain cookie length ([d845fad](https://github.com/bffless/ce/commit/d845fad9fcd25cd18a5564e115bc3ac50a6bba40))
* date bucket not included in url for file upload ([67e6d63](https://github.com/bffless/ce/commit/67e6d63c5a1f2167b3795322141b5af7aacf50c6))
* default Google OAuth to false for CE, add enable validation ([eb908d2](https://github.com/bffless/ce/commit/eb908d26221b6d3fe7bd5d8e08544b9f30e22013))
* email send, dont await ([e18170c](https://github.com/bffless/ce/commit/e18170c0a022166e540bf71bf6adeed162ca72db))
* ensure AI collects at least one contact method (email or phone) ([1aa45b9](https://github.com/bffless/ce/commit/1aa45b9f7ed0e26741a3fbc647bd2ac30c0423dd))
* evaluate traffic rules in proxy middleware for pipelines ([e92c0fd](https://github.com/bffless/ce/commit/e92c0fd51b8ea6207fd73edd720cd4a36bb167e6))
* evaluate traffic rules in proxy middleware for pipelines ([1d73dbf](https://github.com/bffless/ce/commit/1d73dbfdb20d4e1129d9e0d0697dd57b3bd27890))
* exclude auth endpoints from token expiry check and use domain visibility ([c9f7327](https://github.com/bffless/ce/commit/c9f732714f970dc5f5f8f05cd317bf351aadeb6e))
* exclude auto-preview aliases from refs endpoint ([96a9fb6](https://github.com/bffless/ce/commit/96a9fb60aa087a2c1a0635532c92e508fcc4b8eb))
* expression evaluator handles literal values and add Monaco for email body ([218dc04](https://github.com/bffless/ce/commit/218dc04d742caa4179f050697d2b4964a7c3939c))
* external redirect ([f94de63](https://github.com/bffless/ce/commit/f94de633ded62abc0c0889b93745da73e20e5666))
* extract user from session in proxy middleware for pipelines ([ac57d12](https://github.com/bffless/ce/commit/ac57d12a149be65ce31bed1f7300c8c787b6bb9e))
* file serve handler ([862d792](https://github.com/bffless/ce/commit/862d7921477f22f2d4a791c99dc6a1283c06ea63))
* forward multiple Set-Cookie headers correctly through proxy rules ([ebe3d65](https://github.com/bffless/ce/commit/ebe3d657b05cbccd8a90cc2f2d73914782d39742))
* GitHub integration UI polish — persist defaultOrg, hide sandbox badge ([89e64c4](https://github.com/bffless/ce/commit/89e64c434e2c51bdd08227e0c1e080d72f566b44))
* handle custom domain relay when already logged in ([3088ee8](https://github.com/bffless/ce/commit/3088ee87c2f7d5477d61eddf944361dc290d8c53))
* helmet ([241cf8b](https://github.com/bffless/ce/commit/241cf8b97ba47da965762e87f56b39dd1a6e54d9))
* honeypot ([78d02f9](https://github.com/bffless/ce/commit/78d02f9d57cf13842f4fc7a70f2e2170d0e3a499))
* html default email ([cea3ff4](https://github.com/bffless/ce/commit/cea3ff41fab09539c4f9119424e72e32bb479a5c))
* improve RAG vector search result quality with filtering and diversity ([5f9e323](https://github.com/bffless/ce/commit/5f9e323a7d404943d24b807f360a1fbcb235147a))
* include cache-control header in ETag to invalidate CDN on rule changes ([8fb5798](https://github.com/bffless/ce/commit/8fb5798506b1f3d1be091627569f8e83011c32b1))
* increase replicate poll interval and respect step timeout config ([26e28d4](https://github.com/bffless/ce/commit/26e28d488c9a3529038f772d1468722be45731c3))
* ip ([2d7c676](https://github.com/bffless/ce/commit/2d7c676ebe4803e60f5f3990e78835e9d92cae77))
* json parsing ([4382fbe](https://github.com/bffless/ce/commit/4382fbe174d0cd106d04ff7f53391d112e1a7446))
* lint ([611e260](https://github.com/bffless/ce/commit/611e260a2a9f71aa7fcb3f8ef818e53306e9081e))
* login issues ([b19915e](https://github.com/bffless/ce/commit/b19915eb30e5a099d7e9120796e5535d7771b71f))
* logo ([c78a3b7](https://github.com/bffless/ce/commit/c78a3b78f44f7240e18b6e82fcc1e638e70b14d5))
* make generate upload modal scrollable ([901a4b0](https://github.com/bffless/ce/commit/901a4b045fb6e1ec3de493e36246bda31e20c571))
* merge default frame ancestors with custom allowed origins ([552043f](https://github.com/bffless/ce/commit/552043fce386e5efbb083b1ed5e11320cc75d7e3))
* nginx ([48ee59a](https://github.com/bffless/ce/commit/48ee59a0671de2ed57317ae6bf366682be636beb))
* pass deployment context to pipeline function handler sandbox ([cd9b435](https://github.com/bffless/ce/commit/cd9b4350c4459f2db719135534373651ffe96b33))
* pass full conversation messages to email-contact plugin ([8ab2e71](https://github.com/bffless/ce/commit/8ab2e71661895f3fcf98b2501d16917a18f8aba4))
* persist redirect URL through email verification flow ([d549975](https://github.com/bffless/ce/commit/d549975fe7cba5a880ae35d303b8027d2468684c))
* pipeline execution ([a552c53](https://github.com/bffless/ce/commit/a552c5397715e355e20b9d1e7203b5725196fdf6))
* post processing dto ([3870b20](https://github.com/bffless/ce/commit/3870b2094a002c37ec2c7cf720eb98b82d646850))
* proper HTTP status codes for pipeline errors and add auth debug logging ([da5d075](https://github.com/bffless/ce/commit/da5d075f0f5032d409a165d002c014035d69e763))
* recordId for update and delete pipeline ([64fb6ef](https://github.com/bffless/ce/commit/64fb6efe4a75841087738fcf91da08bd943bcece))
* remove heic-convert dependency, reject HEIC uploads server-side ([36e651c](https://github.com/bffless/ce/commit/36e651cb77abb4f3449a681cc211cd5d56404c6a))
* rename setup checkEmail endpoint to avoid RTK Query collision with authApi ([a6b4d55](https://github.com/bffless/ce/commit/a6b4d559d2be1494425e2042e124518db6a3de55))
* repo feed shows only member repos, preserve redirect through email verification ([5297adc](https://github.com/bffless/ce/commit/5297adc445da7d1234689745459b54c7497e80a4))
* reset lastModifiedAt after save to clear dirty state ([0f27546](https://github.com/bffless/ce/commit/0f27546b570e68575552398e90a6356c6aba384e))
* revert full conversation messages in email-contact plugin ([c71cb90](https://github.com/bffless/ce/commit/c71cb90b4d6eb224580d0ba57c7cafe0bc4b828c))
* reverts member view ([090277c](https://github.com/bffless/ce/commit/090277cbea23c59db056cfff0b2d67883e35af7b))
* save user message and conversation when using smart defaults ([d3f7488](https://github.com/bffless/ce/commit/d3f7488e4e13addff0f5c208feb90b2d72a05056))
* signed url to mcp server ([d53a043](https://github.com/bffless/ce/commit/d53a0435f44a9571ff672888bd97eae0476168e4))
* skip domain mismatch check and secure cookies for localhost tokens ([a18097d](https://github.com/bffless/ce/commit/a18097d4c1ca6757507c93f663545e1d1666f6bf))
* skip domain validation on session and refresh endpoints for localhost ([82b005a](https://github.com/bffless/ce/commit/82b005a42eb0e388e9f9109e362dd7bd7a226598))
* skipped steps preserve previous output, form handler reads query params ([f36a9aa](https://github.com/bffless/ce/commit/f36a9aa32f16a704b128242e128840dcc2f5355f))
* slim down chunked vector search results to avoid redundant data ([0d800f0](https://github.com/bffless/ce/commit/0d800f0050821c0464d449e5145d6e64be0f8977))
* storage adapters and chat ([4e39789](https://github.com/bffless/ce/commit/4e39789bab7d2e67bd4ea2f8ce5fcc20626c3f52))
* support object body format in HttpRequestConfig UI ([58f59c9](https://github.com/bffless/ce/commit/58f59c9df78ae7c9a3a0e03880c083a680742f9e))
* surface image conversion errors instead of silently falling back ([54d6b9a](https://github.com/bffless/ce/commit/54d6b9a29e167f3dac07cbb6ee9f7be5469a78e7))
* swap nginx-baked path prefix when traffic variant has path override ([8a191e5](https://github.com/bffless/ce/commit/8a191e5325466700f00c10cd6fd80723719633df))
* tests ([2ed83c4](https://github.com/bffless/ce/commit/2ed83c415863592f0de175215bb6043dafec5016))
* tests ([ca04b02](https://github.com/bffless/ce/commit/ca04b02eaa2698098c143bd2cba86f815730a472))
* textarea changes ([f75203a](https://github.com/bffless/ce/commit/f75203ab3b05ab455c2190613f4a9c2ed9865523))
* trim whitespace from cache rule path patterns ([a0c54e8](https://github.com/bffless/ce/commit/a0c54e82491df3fa831b6ecfcb9c1f118de59141))
* triple-brace template expressions should not JSON-quote string primitives ([7d14a71](https://github.com/bffless/ce/commit/7d14a71fe784749466f73cf9c9a7cad11d3a3dfd))
* try refresh token ([dd814f9](https://github.com/bffless/ce/commit/dd814f983208c5e9ae4e1c7fde524c4f3e3fd646))
* ts issues ([e10a361](https://github.com/bffless/ce/commit/e10a36132f7a983b933883c39a4c72643e2d02a0))
* typeahead ([881fcbb](https://github.com/bffless/ce/commit/881fcbba1a2c02c1e842c935be84a4e1c25e8947))
* **umbrel:** serve static assets on domain-not-configured page ([ec9d6ba](https://github.com/bffless/ce/commit/ec9d6ba35c5590487a6d2a74cd68131114d9553a))
* **umbrel:** show helpful setup page when domain not configured ([135e603](https://github.com/bffless/ce/commit/135e60316f89aa8297f469b4ab367cacdee29073))
* update platform mode nginx template with consolidated auth routes ([a64c044](https://github.com/bffless/ce/commit/a64c0448784e42f610ef2d2ec247a090105ee7a1))
* use app DB user ID for session when existing user signs in via Google ([40be2fb](https://github.com/bffless/ce/commit/40be2fb78d2ed75a55600aaf6d723085e204179d))
* use heic-convert for HEIC decoding instead of relying on system libheif ([df2facb](https://github.com/bffless/ce/commit/df2facbc80f87db58af3f5f84761b70798e9cbaa))
* use native sharp for HEIC conversion with heic-convert fallback ([e8da604](https://github.com/bffless/ce/commit/e8da6040c1f8bb8aa79f2632e4e8618b60a7df81))
* use SchemaFieldPicker and ExpressionInput for upload extra fields ([e412c13](https://github.com/bffless/ce/commit/e412c13245b7b68e2e8184cc7c9874ee7d250055))
* wait for apt lock before installing prerequisites ([3823b83](https://github.com/bffless/ce/commit/3823b836224d97a71fd6240b27dd7a56c0acd7c3))
* warn on low-memory systems and increase SuperTokens healthcheck timeout ([6b6614e](https://github.com/bffless/ce/commit/6b6614ebe8a0a3d4fc1419ee91eb30dfc6a94519))


### Performance Improvements

* filter large text fields at SQL level in vector search ([08fd265](https://github.com/bffless/ce/commit/08fd2658528726396712b419393ff186841544cc))


### Reverts

* pass full conversation messages to email-contact plugin ([454dd9a](https://github.com/bffless/ce/commit/454dd9aba92a81b28dc7b81cd6c904d54bf53475))

## [0.0.231](https://github.com/bffless/ce/compare/v0.0.230...v0.0.231) (2026-04-18)


### Bug Fixes

* GitHub integration UI polish — persist defaultOrg, hide sandbox badge ([89e64c4](https://github.com/bffless/ce/commit/89e64c434e2c51bdd08227e0c1e080d72f566b44))

## [0.0.230](https://github.com/bffless/ce/compare/v0.0.229...v0.0.230) (2026-04-18)


### Features

* add GitHub integration and github_api pipeline handler ([0147b7e](https://github.com/bffless/ce/commit/0147b7ecd8adbce7b978dbd7f677f6449038e786))


### Bug Fixes

* trim whitespace from cache rule path patterns ([a0c54e8](https://github.com/bffless/ce/commit/a0c54e82491df3fa831b6ecfcb9c1f118de59141))

## [0.0.229](https://github.com/bffless/ce/compare/v0.0.228...v0.0.229) (2026-04-16)


### Bug Fixes

* include cache-control header in ETag to invalidate CDN on rule changes ([8fb5798](https://github.com/bffless/ce/commit/8fb5798506b1f3d1be091627569f8e83011c32b1))

## [0.0.228](https://github.com/bffless/ce/compare/v0.0.227...v0.0.228) (2026-04-11)


### Bug Fixes

* skip domain validation on session and refresh endpoints for localhost ([82b005a](https://github.com/bffless/ce/commit/82b005a42eb0e388e9f9109e362dd7bd7a226598))

## [0.0.227](https://github.com/bffless/ce/compare/v0.0.226...v0.0.227) (2026-04-11)


### Bug Fixes

* skip domain mismatch check and secure cookies for localhost tokens ([a18097d](https://github.com/bffless/ce/commit/a18097d4c1ca6757507c93f663545e1d1666f6bf))

## [0.0.226](https://github.com/bffless/ce/compare/v0.0.225...v0.0.226) (2026-04-11)


### Features

* support localhost dev auth with targetOrigin parameter ([aebc692](https://github.com/bffless/ce/commit/aebc6925b403e6966a92ae446e54430d77cb099d))

## [0.0.225](https://github.com/bffless/ce/compare/v0.0.224...v0.0.225) (2026-04-09)


### Bug Fixes

* allow proxy rule set IDs on alias creation ([5abb13d](https://github.com/bffless/ce/commit/5abb13dba612b277ce5f3db82888eabb8cd067ed))

## [0.0.224](https://github.com/bffless/ce/compare/v0.0.223...v0.0.224) (2026-04-07)


### Features

* default new projects to public visibility ([bd53b1c](https://github.com/bffless/ce/commit/bd53b1c3893da716d91f9b815a77fad71e61b68a))

## [0.0.223](https://github.com/bffless/ce/compare/v0.0.222...v0.0.223) (2026-04-07)


### Features

* default ENABLE_MINIO and ENABLE_REDIS to false ([295bb46](https://github.com/bffless/ce/commit/295bb4616e809244ee71bd58c13eab3d6d882f41))

## [0.0.222](https://github.com/bffless/ce/compare/v0.0.221...v0.0.222) (2026-04-07)


### Bug Fixes

* warn on low-memory systems and increase SuperTokens healthcheck timeout ([6b6614e](https://github.com/bffless/ce/commit/6b6614ebe8a0a3d4fc1419ee91eb30dfc6a94519))

## [0.0.221](https://github.com/bffless/ce/compare/v0.0.220...v0.0.221) (2026-04-07)


### Bug Fixes

* wait for apt lock before installing prerequisites ([3823b83](https://github.com/bffless/ce/commit/3823b836224d97a71fd6240b27dd7a56c0acd7c3))

## [0.0.220](https://github.com/bffless/ce/compare/v0.0.219...v0.0.220) (2026-04-05)


### Features

* google auth for self hosted ([7d189c2](https://github.com/bffless/ce/commit/7d189c25432d7ec4bf61873e59f1f9b771507c3c))
* google auth for self hosted ([8ca7a87](https://github.com/bffless/ce/commit/8ca7a87e71fb38bf698a3933197a7e354aeec517))

## [0.0.219](https://github.com/bffless/ce/compare/v0.0.218...v0.0.219) (2026-04-05)


### Bug Fixes

* default Google OAuth to false for CE, add enable validation ([eb908d2](https://github.com/bffless/ce/commit/eb908d26221b6d3fe7bd5d8e08544b9f30e22013))

## [0.0.218](https://github.com/bffless/ce/compare/v0.0.217...v0.0.218) (2026-04-04)


### Bug Fixes

* exclude auto-preview aliases from refs endpoint ([96a9fb6](https://github.com/bffless/ce/commit/96a9fb60aa087a2c1a0635532c92e508fcc4b8eb))

## [0.0.217](https://github.com/bffless/ce/compare/v0.0.216...v0.0.217) (2026-04-04)


### Bug Fixes

* signed url to mcp server ([d53a043](https://github.com/bffless/ce/commit/d53a0435f44a9571ff672888bd97eae0476168e4))

## [0.0.216](https://github.com/bffless/ce/compare/v0.0.215...v0.0.216) (2026-04-04)


### Features

* add groupBy support to db_aggregate pipeline handler ([d1144c4](https://github.com/bffless/ce/commit/d1144c46c74cac00368d9dbd88c92d922c7bfc25))

## [0.0.215](https://github.com/bffless/ce/compare/v0.0.214...v0.0.215) (2026-04-03)


### Features

* support multiple default proxy rule sets per project ([f34c043](https://github.com/bffless/ce/commit/f34c043748b394a4a93149c3b104031bbd043769))

## [0.0.214](https://github.com/bffless/ce/compare/v0.0.213...v0.0.214) (2026-04-02)


### Features

* add create_signed_url MCP tool for downloading storage files ([94f47aa](https://github.com/bffless/ce/commit/94f47aab43413b3fa3191c01fa93d0ab213f521c))

## [0.0.213](https://github.com/bffless/ce/compare/v0.0.212...v0.0.213) (2026-04-02)


### Bug Fixes

* tests ([2ed83c4](https://github.com/bffless/ce/commit/2ed83c415863592f0de175215bb6043dafec5016))

## [0.0.212](https://github.com/bffless/ce/compare/v0.0.211...v0.0.212) (2026-04-02)


### Features

* add alias-level proxy rule set assignments ([10e1988](https://github.com/bffless/ce/commit/10e1988f11c50ae311568183fdbd4f0d79a0de2e))

## [0.0.211](https://github.com/bffless/ce/compare/v0.0.210...v0.0.211) (2026-04-02)


### Features

* add signed_url pipeline handler for presigned storage URLs ([d9f17b6](https://github.com/bffless/ce/commit/d9f17b6a388fc4290bdac35891e34da577f43ec5))


### Bug Fixes

* triple-brace template expressions should not JSON-quote string primitives ([7d14a71](https://github.com/bffless/ce/commit/7d14a71fe784749466f73cf9c9a7cad11d3a3dfd))

## [0.0.210](https://github.com/bffless/ce/compare/v0.0.209...v0.0.210) (2026-04-02)


### Bug Fixes

* pass deployment context to pipeline function handler sandbox ([cd9b435](https://github.com/bffless/ce/commit/cd9b4350c4459f2db719135534373651ffe96b33))
* reverts member view ([090277c](https://github.com/bffless/ce/commit/090277cbea23c59db056cfff0b2d67883e35af7b))

## [0.0.209](https://github.com/bffless/ce/compare/v0.0.208...v0.0.209) (2026-04-01)


### Bug Fixes

* branding ([d9bdac5](https://github.com/bffless/ce/commit/d9bdac57f1bf4f4791b2e97a416eeae868e29f68))
* email send, dont await ([e18170c](https://github.com/bffless/ce/commit/e18170c0a022166e540bf71bf6adeed162ca72db))

## [0.0.208](https://github.com/bffless/ce/compare/v0.0.207...v0.0.208) (2026-04-01)


### Bug Fixes

* revert full conversation messages in email-contact plugin ([c71cb90](https://github.com/bffless/ce/commit/c71cb90b4d6eb224580d0ba57c7cafe0bc4b828c))

## [0.0.207](https://github.com/bffless/ce/compare/v0.0.206...v0.0.207) (2026-04-01)


### Reverts

* pass full conversation messages to email-contact plugin ([454dd9a](https://github.com/bffless/ce/commit/454dd9aba92a81b28dc7b81cd6c904d54bf53475))

## [0.0.206](https://github.com/bffless/ce/compare/v0.0.205...v0.0.206) (2026-04-01)


### Bug Fixes

* pass full conversation messages to email-contact plugin ([8ab2e71](https://github.com/bffless/ce/commit/8ab2e71661895f3fcf98b2501d16917a18f8aba4))

## [0.0.205](https://github.com/bffless/ce/compare/v0.0.204...v0.0.205) (2026-03-31)


### Bug Fixes

* merge default frame ancestors with custom allowed origins ([552043f](https://github.com/bffless/ce/commit/552043fce386e5efbb083b1ed5e11320cc75d7e3))

## [0.0.204](https://github.com/bffless/ce/compare/v0.0.203...v0.0.204) (2026-03-31)


### Features

* add response header rules for per-project iframe embedding control ([016ad1e](https://github.com/bffless/ce/commit/016ad1e69fb3dfe38b9323e1912b6caa6dcb5d77))

## [0.0.203](https://github.com/bffless/ce/compare/v0.0.202...v0.0.203) (2026-03-31)


### Features

* move security headers from nginx to NestJS backend ([5a6f935](https://github.com/bffless/ce/commit/5a6f935b59af3ebd45e56300f61dab348d342fe7))

## [0.0.202](https://github.com/bffless/ce/compare/v0.0.201...v0.0.202) (2026-03-31)


### Features

* use Umbrel DEVICE_DOMAIN_NAME for SSH command in setup page ([a2117ef](https://github.com/bffless/ce/commit/a2117ef40fb2add3df1689b311184875b3ff255f))

## [0.0.201](https://github.com/bffless/ce/compare/v0.0.200...v0.0.201) (2026-03-31)


### Features

* add Email Contact chat plugin ([74ae23d](https://github.com/bffless/ce/commit/74ae23d06645dcc390c113b1f5f7190d739476a5))


### Bug Fixes

* ensure AI collects at least one contact method (email or phone) ([1aa45b9](https://github.com/bffless/ce/commit/1aa45b9f7ed0e26741a3fbc647bd2ac30c0423dd))

## [0.0.200](https://github.com/bffless/ce/compare/v0.0.199...v0.0.200) (2026-03-29)


### Features

* add extra fields support for ai_handler message persistence ([6505810](https://github.com/bffless/ce/commit/6505810676c3e89b5559e5494aac3d447b8b19e8))

## [0.0.199](https://github.com/bffless/ce/compare/v0.0.198...v0.0.199) (2026-03-29)


### Bug Fixes

* typeahead ([881fcbb](https://github.com/bffless/ce/commit/881fcbba1a2c02c1e842c935be84a4e1c25e8947))

## [0.0.198](https://github.com/bffless/ce/compare/v0.0.197...v0.0.198) (2026-03-29)


### Features

* adds deployment alias to pipeline ([75d999e](https://github.com/bffless/ce/commit/75d999ebce59e1a9297af2547f7cf69fb56c503a))

## [0.0.197](https://github.com/bffless/ce/compare/v0.0.196...v0.0.197) (2026-03-28)


### Features

* capture client IP address in chat conversations ([9482139](https://github.com/bffless/ce/commit/9482139c162e3fc7f4783d522e354aecab78d919))

## [0.0.196](https://github.com/bffless/ce/compare/v0.0.195...v0.0.196) (2026-03-28)


### Bug Fixes

* add /mcp proxy route to Umbrel nginx config ([4a20308](https://github.com/bffless/ce/commit/4a2030801a63c8316b0eb481b1342dab658159e9))

## [0.0.195](https://github.com/bffless/ce/compare/v0.0.194...v0.0.195) (2026-03-28)


### Bug Fixes

* swap nginx-baked path prefix when traffic variant has path override ([8a191e5](https://github.com/bffless/ce/commit/8a191e5325466700f00c10cd6fd80723719633df))

## [0.0.194](https://github.com/bffless/ce/compare/v0.0.193...v0.0.194) (2026-03-28)


### Features

* add per-variant path override for traffic splitting ([8fa91af](https://github.com/bffless/ce/commit/8fa91af90c3fd5418c0237024524ad9c8e4b74b9))

## [0.0.193](https://github.com/bffless/ce/compare/v0.0.192...v0.0.193) (2026-03-28)


### Bug Fixes

* storage adapters and chat ([4e39789](https://github.com/bffless/ce/commit/4e39789bab7d2e67bd4ea2f8ce5fcc20626c3f52))

## [0.0.192](https://github.com/bffless/ce/compare/v0.0.191...v0.0.192) (2026-03-28)


### Bug Fixes

* helmet ([241cf8b](https://github.com/bffless/ce/commit/241cf8b97ba47da965762e87f56b39dd1a6e54d9))

## [0.0.191](https://github.com/bffless/ce/compare/v0.0.190...v0.0.191) (2026-03-27)


### Performance Improvements

* filter large text fields at SQL level in vector search ([08fd265](https://github.com/bffless/ce/commit/08fd2658528726396712b419393ff186841544cc))

## [0.0.190](https://github.com/bffless/ce/compare/v0.0.189...v0.0.190) (2026-03-27)


### Bug Fixes

* improve RAG vector search result quality with filtering and diversity ([5f9e323](https://github.com/bffless/ce/commit/5f9e323a7d404943d24b807f360a1fbcb235147a))

## [0.0.189](https://github.com/bffless/ce/compare/v0.0.188...v0.0.189) (2026-03-26)


### Bug Fixes

* use app DB user ID for session when existing user signs in via Google ([40be2fb](https://github.com/bffless/ce/commit/40be2fb78d2ed75a55600aaf6d723085e204179d))

## [0.0.188](https://github.com/bffless/ce/compare/v0.0.187...v0.0.188) (2026-03-26)


### Features

* add Google OAuth sign-in and reorganize admin settings into tabs ([e3718d6](https://github.com/bffless/ce/commit/e3718d6ebafb51ad84e8915eeeca5f8b45dce1ff))

## [0.0.187](https://github.com/bffless/ce/compare/v0.0.186...v0.0.187) (2026-03-26)


### Bug Fixes

* persist redirect URL through email verification flow ([d549975](https://github.com/bffless/ce/commit/d549975fe7cba5a880ae35d303b8027d2468684c))

## [0.0.186](https://github.com/bffless/ce/compare/v0.0.185...v0.0.186) (2026-03-26)


### Bug Fixes

* increase replicate poll interval and respect step timeout config ([26e28d4](https://github.com/bffless/ce/commit/26e28d488c9a3529038f772d1468722be45731c3))

## [0.0.185](https://github.com/bffless/ce/compare/v0.0.184...v0.0.185) (2026-03-26)


### Bug Fixes

* slim down chunked vector search results to avoid redundant data ([0d800f0](https://github.com/bffless/ce/commit/0d800f0050821c0464d449e5145d6e64be0f8977))

## [0.0.184](https://github.com/bffless/ce/compare/v0.0.183...v0.0.184) (2026-03-26)


### Features

* adds branding ([a2ffe06](https://github.com/bffless/ce/commit/a2ffe06e695d47daa7909cbcd508475148484b8c))


### Bug Fixes

* chat metadata ([322a0e2](https://github.com/bffless/ce/commit/322a0e27d117c7398853bd81cca0c5baea6c60a4))

## [0.0.183](https://github.com/bffless/ce/compare/v0.0.182...v0.0.183) (2026-03-26)


### Features

* configurable skills path and fix AI Data Tools userId in chat ([5406b8a](https://github.com/bffless/ce/commit/5406b8a64e38495dcfaeefedc322638c21e57dfd))

## [0.0.182](https://github.com/bffless/ce/compare/v0.0.181...v0.0.182) (2026-03-25)


### Features

* evolve RAG Search into AI Data Tools with multi-source support ([41bfedf](https://github.com/bffless/ce/commit/41bfedffe4e523f0310a1dc882ce05fe2768aa1b))

## [0.0.181](https://github.com/bffless/ce/compare/v0.0.180...v0.0.181) (2026-03-25)


### Features

* add configurable input mapping for RAG Search embedding models ([45c5d9b](https://github.com/bffless/ce/commit/45c5d9b95689dc6ded74a07ab7ff7a872f138637))
* add RAG Search AI plugin for semantic search and write-back ([5e5b511](https://github.com/bffless/ce/commit/5e5b5117bf553ab79c03bd6da82ba9a7fb3791d8))
* RAG Search AI plugin ([f00bb79](https://github.com/bffless/ce/commit/f00bb79e196e2ecfcd876a690b10b2d1d76ee981))

## [0.0.180](https://github.com/bffless/ce/compare/v0.0.179...v0.0.180) (2026-03-25)


### Features

* stream files from storage to avoid OOM on large file serving ([bbcf2d7](https://github.com/bffless/ce/commit/bbcf2d7826339e1029bedc6431742d469cf6a1f8))

## [0.0.179](https://github.com/bffless/ce/compare/v0.0.178...v0.0.179) (2026-03-24)


### Bug Fixes

* date bucket not included in url for file upload ([67e6d63](https://github.com/bffless/ce/commit/67e6d63c5a1f2167b3795322141b5af7aacf50c6))

## [0.0.178](https://github.com/bffless/ce/compare/v0.0.177...v0.0.178) (2026-03-24)


### Bug Fixes

* forward multiple Set-Cookie headers correctly through proxy rules ([ebe3d65](https://github.com/bffless/ce/commit/ebe3d657b05cbccd8a90cc2f2d73914782d39742))

## [0.0.177](https://github.com/bffless/ce/compare/v0.0.176...v0.0.177) (2026-03-24)


### Bug Fixes

* external redirect ([f94de63](https://github.com/bffless/ce/commit/f94de633ded62abc0c0889b93745da73e20e5666))

## [0.0.176](https://github.com/bffless/ce/compare/v0.0.175...v0.0.176) (2026-03-24)


### Bug Fixes

* repo feed shows only member repos, preserve redirect through email verification ([5297adc](https://github.com/bffless/ce/commit/5297adc445da7d1234689745459b54c7497e80a4))

## [0.0.175](https://github.com/bffless/ce/compare/v0.0.174...v0.0.175) (2026-03-24)


### Bug Fixes

* login issues ([b19915e](https://github.com/bffless/ce/commit/b19915eb30e5a099d7e9120796e5535d7771b71f))

## [0.0.174](https://github.com/bffless/ce/compare/v0.0.173...v0.0.174) (2026-03-24)


### Features

* add run_pipeline onboarding action and fix Stripe integration config merging ([1447e12](https://github.com/bffless/ce/commit/1447e12c98f8bffdbfd35d103e44a479648fb82b))

## [0.0.173](https://github.com/bffless/ce/compare/v0.0.172...v0.0.173) (2026-03-24)


### Bug Fixes

* adds stripe metadata ([2d5e06c](https://github.com/bffless/ce/commit/2d5e06c07ca475a9e1e65f5914d9b690733bc609))

## [0.0.172](https://github.com/bffless/ce/compare/v0.0.171...v0.0.172) (2026-03-24)


### Bug Fixes

* adds mcp for stripe ([4e4c55b](https://github.com/bffless/ce/commit/4e4c55b087224686ac97f18936c29cc93790ea65))

## [0.0.171](https://github.com/bffless/ce/compare/v0.0.170...v0.0.171) (2026-03-24)


### Features

* add per-step Stripe environment override (sandbox/production) ([6b59d7b](https://github.com/bffless/ce/commit/6b59d7baccadcc94d5e12c90fb159e8201cb594b))
* per-step Stripe environment override ([08fa42d](https://github.com/bffless/ce/commit/08fa42d989205a1b83728a9f908de405bfa7b42d))

## [0.0.170](https://github.com/bffless/ce/compare/v0.0.169...v0.0.170) (2026-03-23)


### Features

* add Stripe payments integration with checkout and webhook pipeline handlers ([7822797](https://github.com/bffless/ce/commit/78227976fd747a510350b7f5d9541e4b90de3623))
* Stripe payments integration ([f69ca59](https://github.com/bffless/ce/commit/f69ca59fb4d2b6108153d162dddfe5bdf023d6bb))

## [0.0.169](https://github.com/bffless/ce/compare/v0.0.168...v0.0.169) (2026-03-23)


### Features

* add Google Meet link option and improve event descriptions for calendar plugin ([513b798](https://github.com/bffless/ce/commit/513b7986432bc9576dd2ec93b2aba058df896ee3))

## [0.0.168](https://github.com/bffless/ce/compare/v0.0.167...v0.0.168) (2026-03-23)


### Features

* capture post-processing steps debug info in pipeline execution logs ([38828da](https://github.com/bffless/ce/commit/38828da0c80cb38446750d258d5b5a5f1baf064a))
* include resolved system prompt and user message in AI handler debug output ([3d225b0](https://github.com/bffless/ce/commit/3d225b01a3e939981a6b84a511574d9c3378b47b))

## [0.0.167](https://github.com/bffless/ce/compare/v0.0.166...v0.0.167) (2026-03-23)


### Features

* add pipeline execution logging for debugging production pipeline runs ([9909ab8](https://github.com/bffless/ce/commit/9909ab87f3b977bfaa5941d19501a8255bbbc5d8))

## [0.0.166](https://github.com/bffless/ce/compare/v0.0.165...v0.0.166) (2026-03-23)


### Features

* add update_pipeline_schema MCP tool ([94a7772](https://github.com/bffless/ce/commit/94a77722d552ef2c456de787fb4978c2715db668))

## [0.0.165](https://github.com/bffless/ce/compare/v0.0.164...v0.0.165) (2026-03-22)


### Bug Fixes

* support object body format in HttpRequestConfig UI ([58f59c9](https://github.com/bffless/ce/commit/58f59c9df78ae7c9a3a0e03880c083a680742f9e))

## [0.0.164](https://github.com/bffless/ce/compare/v0.0.163...v0.0.164) (2026-03-22)


### Features

* add http_request pipeline handler for cross-project API calls ([086f6d5](https://github.com/bffless/ce/commit/086f6d5f8a81ecc67434b77d8aee2c969584e9ea))

## [0.0.163](https://github.com/bffless/ce/compare/v0.0.162...v0.0.163) (2026-03-22)


### Bug Fixes

* add SuperTokens session fallback to _bffless/auth/session endpoint ([e1c5964](https://github.com/bffless/ce/commit/e1c5964cd6ae3ac01ddab5fe06395cc95bf86163))

## [0.0.162](https://github.com/bffless/ce/compare/v0.0.161...v0.0.162) (2026-03-22)


### Bug Fixes

* file serve handler ([862d792](https://github.com/bffless/ce/commit/862d7921477f22f2d4a791c99dc6a1283c06ea63))

## [0.0.161](https://github.com/bffless/ce/compare/v0.0.160...v0.0.161) (2026-03-22)


### Bug Fixes

* circular dep ([825a574](https://github.com/bffless/ce/commit/825a574be6ed36b1ab162dc50f6ebe7752b34a3b))

## [0.0.160](https://github.com/bffless/ce/compare/v0.0.159...v0.0.160) (2026-03-22)


### Features

* add proxyRuleSetId to update_alias and improve file upload docs ([0a0067c](https://github.com/bffless/ce/commit/0a0067cc196d0f0ef73fd9951fdaf8d273777664))
* improve MCP tools for pipelines, domains, and proxy rules ([2151da1](https://github.com/bffless/ce/commit/2151da1841c70e6b20e1a606e05802971e00716f))


### Bug Fixes

* add /mcp location to nginx configs for MCP endpoint proxying ([ba69496](https://github.com/bffless/ce/commit/ba69496f7a134364635fc19d99f5821a1d50b1ea))
* cache rules ([38312ee](https://github.com/bffless/ce/commit/38312eee91052f9b07a367a6d00e174a1dd2d864))

## [0.0.159](https://github.com/bffless/ce/compare/v0.0.158...v0.0.159) (2026-03-22)


### Features

* add MCP server for CE admin API ([1d26a9c](https://github.com/bffless/ce/commit/1d26a9c114dd520db11541d61d8219260f3dd755))
* add MCP server for CE admin API ([6840ade](https://github.com/bffless/ce/commit/6840adede33d637d0b66433948afa99535d1a321))

## [0.0.158](https://github.com/bffless/ce/compare/v0.0.157...v0.0.158) (2026-03-22)


### Bug Fixes

* rename setup checkEmail endpoint to avoid RTK Query collision with authApi ([a6b4d55](https://github.com/bffless/ce/commit/a6b4d559d2be1494425e2042e124518db6a3de55))

## [0.0.157](https://github.com/bffless/ce/compare/v0.0.156...v0.0.157) (2026-03-22)


### Bug Fixes

* remove heic-convert dependency, reject HEIC uploads server-side ([36e651c](https://github.com/bffless/ce/commit/36e651cb77abb4f3449a681cc211cd5d56404c6a))

## [0.0.156](https://github.com/bffless/ce/compare/v0.0.155...v0.0.156) (2026-03-22)


### Bug Fixes

* use native sharp for HEIC conversion with heic-convert fallback ([e8da604](https://github.com/bffless/ce/commit/e8da6040c1f8bb8aa79f2632e4e8618b60a7df81))

## [0.0.155](https://github.com/bffless/ce/compare/v0.0.154...v0.0.155) (2026-03-21)


### Bug Fixes

* use heic-convert for HEIC decoding instead of relying on system libheif ([df2facb](https://github.com/bffless/ce/commit/df2facbc80f87db58af3f5f84761b70798e9cbaa))

## [0.0.154](https://github.com/bffless/ce/compare/v0.0.153...v0.0.154) (2026-03-21)


### Bug Fixes

* surface image conversion errors instead of silently falling back ([54d6b9a](https://github.com/bffless/ce/commit/54d6b9a29e167f3dac07cbb6ee9f7be5469a78e7))

## [0.0.153](https://github.com/bffless/ce/compare/v0.0.152...v0.0.153) (2026-03-21)


### Features

* add image conversion, filename override, and grouped handler picker ([5e81a93](https://github.com/bffless/ce/commit/5e81a93a32932e63da735936e47736953b775cf0))

## [0.0.152](https://github.com/bffless/ce/compare/v0.0.151...v0.0.152) (2026-03-21)


### Bug Fixes

* ts issues ([e10a361](https://github.com/bffless/ce/commit/e10a36132f7a983b933883c39a4c72643e2d02a0))

## [0.0.151](https://github.com/bffless/ce/compare/v0.0.150...v0.0.151) (2026-03-21)


### Bug Fixes

* admin pipeline bugs ([97c97d4](https://github.com/bffless/ce/commit/97c97d4d60f63132e1c82930df4d8bcec17e3e0d))

## [0.0.150](https://github.com/bffless/ce/compare/v0.0.149...v0.0.150) (2026-03-21)


### Features

* add pgvector embedding storage and vector search pipeline handlers ([7c6ce6b](https://github.com/bffless/ce/commit/7c6ce6bba14f50d0e27096d27040eca7b4c2f2a1))
* pgvector embedding storage & vector search handlers ([1467b69](https://github.com/bffless/ce/commit/1467b69ba12de06e9a0d0cfda7e3bb4a09c9fa1e))

## [0.0.149](https://github.com/bffless/ce/compare/v0.0.148...v0.0.149) (2026-03-21)


### Features

* add Replicate AI pipeline handler and AI Services settings ([ade3b0b](https://github.com/bffless/ce/commit/ade3b0b9cc4fb2f7437bcd0e19cd4b674c178ed9))
* Replicate AI pipeline handler ([adb5b64](https://github.com/bffless/ce/commit/adb5b64bd013898a6e0684f52fc1623a9de2ec1f))

## [0.0.148](https://github.com/bffless/ce/compare/v0.0.147...v0.0.148) (2026-03-20)


### Features

* configurable file field name and respect maxFileSize in multer ([858b497](https://github.com/bffless/ce/commit/858b497dc8ee878c772d0864fd168ac782abd9b7))

## [0.0.147](https://github.com/bffless/ce/compare/v0.0.146...v0.0.147) (2026-03-20)


### Bug Fixes

* use SchemaFieldPicker and ExpressionInput for upload extra fields ([e412c13](https://github.com/bffless/ce/commit/e412c13245b7b68e2e8184cc7c9874ee7d250055))

## [0.0.146](https://github.com/bffless/ce/compare/v0.0.145...v0.0.146) (2026-03-20)


### Bug Fixes

* build ([336b7e2](https://github.com/bffless/ce/commit/336b7e2c2ffd74c7c1e6e60d38a3ff6718f6d98f))

## [0.0.145](https://github.com/bffless/ce/compare/v0.0.144...v0.0.145) (2026-03-20)


### Bug Fixes

* try refresh token ([dd814f9](https://github.com/bffless/ce/commit/dd814f983208c5e9ae4e1c7fde524c4f3e3fd646))

## [0.0.144](https://github.com/bffless/ce/compare/v0.0.143...v0.0.144) (2026-03-20)


### Bug Fixes

* add _bffless/auth proxy to subdomain/wildcard nginx configs ([64e054e](https://github.com/bffless/ce/commit/64e054e89f2a0167a86086962131303cabf6a384))

## [0.0.143](https://github.com/bffless/ce/compare/v0.0.142...v0.0.143) (2026-03-20)


### Features

* add extra fields mapping to file upload handler ([133f7a2](https://github.com/bffless/ce/commit/133f7a21126528f040ccfd6153244246ca144500))


### Bug Fixes

* allow domain-token for workspace subdomains and all domain types ([dffbb7e](https://github.com/bffless/ce/commit/dffbb7e7b40824f3055509888c2f786031210967))

## [0.0.142](https://github.com/bffless/ce/compare/v0.0.141...v0.0.142) (2026-03-20)


### Features

* upload handler UI, pipeline tester file support, and admin previews ([dba80e8](https://github.com/bffless/ce/commit/dba80e81ff7f0fab658687745933d06b04c0e0e5))


### Bug Fixes

* make generate upload modal scrollable ([901a4b0](https://github.com/bffless/ce/commit/901a4b045fb6e1ec3de493e36246bda31e20c571))

## [0.0.141](https://github.com/bffless/ce/compare/v0.0.140...v0.0.141) (2026-03-20)


### Features

* add change password to settings page ([c7fe76d](https://github.com/bffless/ce/commit/c7fe76dc03118022e73421d40f220074e1ab259e))
* add change password to settings page ([9b620c2](https://github.com/bffless/ce/commit/9b620c2d5abb254cff7cb627af8037dcf82782d3))
* add file upload/serve pipeline handlers with schema generator ([ccf4724](https://github.com/bffless/ce/commit/ccf4724a5239bdb457f714864071ab76f58c0ff9))
* add file upload/serve pipeline handlers with schema generator ([ae2014d](https://github.com/bffless/ce/commit/ae2014dd5c746ca37365e3adde2dd3f1f03977d0))


### Bug Fixes

* add missing upload components and fix gitignore rule ([66f61b1](https://github.com/bffless/ce/commit/66f61b136507eac1f51f515ca799dbcbc28309dd))

## [0.0.140](https://github.com/bffless/ce/compare/v0.0.139...v0.0.140) (2026-03-19)


### Bug Fixes

* skipped steps preserve previous output, form handler reads query params ([f36a9aa](https://github.com/bffless/ce/commit/f36a9aa32f16a704b128242e128840dcc2f5355f))

## [0.0.139](https://github.com/bffless/ce/compare/v0.0.138...v0.0.139) (2026-03-19)


### Features

* add db_aggregate handler, expression support for query limit/offset ([c387abb](https://github.com/bffless/ce/commit/c387abbc68555163d848e191ecd405e7b7d7d6b0))

## [0.0.138](https://github.com/bffless/ce/compare/v0.0.137...v0.0.138) (2026-03-18)


### Features

* show alias and version in data UI, auto-increment schema version ([397ac2f](https://github.com/bffless/ce/commit/397ac2f3e9d455338f8c54b77a96caf07eabc85c))

## [0.0.137](https://github.com/bffless/ce/compare/v0.0.136...v0.0.137) (2026-03-18)


### Features

* add alias and version columns to pipeline data schema ([db873df](https://github.com/bffless/ce/commit/db873df8700cadc3efac6214a0473920907748e5))

## [0.0.136](https://github.com/bffless/ce/compare/v0.0.135...v0.0.136) (2026-03-18)


### Bug Fixes

* calendar to support email to array ([8012e58](https://github.com/bffless/ce/commit/8012e58249461497066d467913eba956b72b5c7e))

## [0.0.135](https://github.com/bffless/ce/compare/v0.0.134...v0.0.135) (2026-03-18)


### Bug Fixes

* post processing dto ([3870b20](https://github.com/bffless/ce/commit/3870b2094a002c37ec2c7cf720eb98b82d646850))

## [0.0.134](https://github.com/bffless/ce/compare/v0.0.133...v0.0.134) (2026-03-17)


### Features

* post-processing steps to pipeline ([cc0ac25](https://github.com/bffless/ce/commit/cc0ac251462a959b07a15bcd5592768bf2a6bf15))
* post-processing steps to pipeline ([49582b2](https://github.com/bffless/ce/commit/49582b2b4f3b3b61310d94215dd206ce5d5fa2e1))

## [0.0.133](https://github.com/bffless/ce/compare/v0.0.132...v0.0.133) (2026-03-17)


### Features

* add Google Calendar AI plugin with OAuth2 integration ([6a146f2](https://github.com/bffless/ce/commit/6a146f21f9a374157f6d938ddfcb55e70c06513e))
* Google Calendar AI plugin with OAuth2 ([e3749e3](https://github.com/bffless/ce/commit/e3749e311d029b91969dff155a76afbab145ea81))

## [0.0.132](https://github.com/bffless/ce/compare/v0.0.131...v0.0.132) (2026-03-16)


### Features

* system prompt height ([af08262](https://github.com/bffless/ce/commit/af08262b55c158b7f111436e1cf8a0a407cf0f6e))

## [0.0.131](https://github.com/bffless/ce/compare/v0.0.130...v0.0.131) (2026-03-16)


### Features

* add AI plugin system for executable tools in chat pipelines ([d96fc9d](https://github.com/bffless/ce/commit/d96fc9dfb0f16dc10d962de45aa97778d706bdd8))
* AI plugin system for chat pipelines ([d24d5b8](https://github.com/bffless/ce/commit/d24d5b85db0b097f495be3cb2aa3dc876c85120d))


### Bug Fixes

* ip ([2d7c676](https://github.com/bffless/ce/commit/2d7c676ebe4803e60f5f3990e78835e9d92cae77))

## [0.0.130](https://github.com/bffless/ce/compare/v0.0.129...v0.0.130) (2026-03-15)


### Bug Fixes

* logo ([c78a3b7](https://github.com/bffless/ce/commit/c78a3b78f44f7240e18b6e82fcc1e638e70b14d5))

## [0.0.129](https://github.com/bffless/ce/compare/v0.0.128...v0.0.129) (2026-03-15)


### Bug Fixes

* nginx ([48ee59a](https://github.com/bffless/ce/commit/48ee59a0671de2ed57317ae6bf366682be636beb))

## [0.0.128](https://github.com/bffless/ce/compare/v0.0.127...v0.0.128) (2026-03-15)


### Features

* **proxy-rules:** add ability to edit rule set name, environment, and description ([b74f703](https://github.com/bffless/ce/commit/b74f703c4de9eb6bd1c351a6b5c3bbea3eb2bc98))


### Bug Fixes

* **umbrel:** serve static assets on domain-not-configured page ([ec9d6ba](https://github.com/bffless/ce/commit/ec9d6ba35c5590487a6d2a74cd68131114d9553a))

## [0.0.127](https://github.com/bffless/ce/compare/v0.0.126...v0.0.127) (2026-03-15)


### Bug Fixes

* **umbrel:** show helpful setup page when domain not configured ([135e603](https://github.com/bffless/ce/commit/135e60316f89aa8297f469b4ab367cacdee29073))

## [0.0.126](https://github.com/bffless/ce/compare/v0.0.125...v0.0.126) (2026-03-15)


### Bug Fixes

* evaluate traffic rules in proxy middleware for pipelines ([e92c0fd](https://github.com/bffless/ce/commit/e92c0fd51b8ea6207fd73edd720cd4a36bb167e6))
* evaluate traffic rules in proxy middleware for pipelines ([1d73dbf](https://github.com/bffless/ce/commit/1d73dbfdb20d4e1129d9e0d0697dd57b3bd27890))

## [0.0.125](https://github.com/bffless/ce/compare/v0.0.124...v0.0.125) (2026-03-15)


### Features

* add custom headers for proxy rules and header-based traffic rules ([4b5ca0c](https://github.com/bffless/ce/commit/4b5ca0ccaca94e486aaed4819026352ed36d5ddf))
* add custom headers for proxy rules and header-based traffic rules ([1ac5774](https://github.com/bffless/ce/commit/1ac57743904c37e843820f76c51c7f15eff0abc9))

## [0.0.124](https://github.com/bffless/ce/compare/v0.0.123...v0.0.124) (2026-03-15)


### Features

* add request.ip, request.headers, request.userAgent to pipeline expressions ([28fff09](https://github.com/bffless/ce/commit/28fff091530fbefc7360cb54d47e694d96200c54))

## [0.0.123](https://github.com/bffless/ce/compare/v0.0.122...v0.0.123) (2026-03-14)


### Bug Fixes

* apply variant cookie to pipeline requests via dedicated domains ([be51bfe](https://github.com/bffless/ce/commit/be51bfeac2ecfbe8429e7e3099cca13c4e36bdcc))

## [0.0.122](https://github.com/bffless/ce/compare/v0.0.121...v0.0.122) (2026-03-14)


### Bug Fixes

* add DomainsModule import to base @Module decorator for middleware DI ([c13334a](https://github.com/bffless/ce/commit/c13334ae8fda66f5158b5e7eedc3c9e6745dff11))
* add VisibilityService to AuthModule providers for middleware injection ([1ace13d](https://github.com/bffless/ce/commit/1ace13d262f069cc36149eaf1e4a2e951311d839))

## [0.0.121](https://github.com/bffless/ce/compare/v0.0.120...v0.0.121) (2026-03-14)


### Bug Fixes

* allow public domains to bypass auth middleware 401 on expired tokens ([83438aa](https://github.com/bffless/ce/commit/83438aa83c464f31c2c85d400d32c3923fde9c61))

## [0.0.120](https://github.com/bffless/ce/compare/v0.0.119...v0.0.120) (2026-03-14)


### Features

* add conditional validators for pipelines ([824bd8e](https://github.com/bffless/ce/commit/824bd8e2fbedbae23fb01114101e2fa330b6b9a8))

## [0.0.119](https://github.com/bffless/ce/compare/v0.0.118...v0.0.119) (2026-03-14)


### Features

* add AI pipeline skills support ([8d1ded8](https://github.com/bffless/ce/commit/8d1ded8bf3c10d07d225436fcb67c2164b7961a0))
* add AI pipeline skills support ([8e915b4](https://github.com/bffless/ce/commit/8e915b402b3ee5cc9f8d52172a82f94e76bba5e0))


### Bug Fixes

* add missing service mocks to ProxyRulesController test ([aeadb23](https://github.com/bffless/ce/commit/aeadb236f9f2903e91c6f0a00446b92f4de09ff9))

## [0.0.118](https://github.com/bffless/ce/compare/v0.0.117...v0.0.118) (2026-03-13)


### Bug Fixes

* aligns cookie to supertokens expiration ([c135f86](https://github.com/bffless/ce/commit/c135f8610496fe7144354ad775675b945acaaa28))
* custom domain cookie length ([d845fad](https://github.com/bffless/ce/commit/d845fad9fcd25cd18a5564e115bc3ac50a6bba40))

## [0.0.117](https://github.com/bffless/ce/compare/v0.0.116...v0.0.117) (2026-03-13)


### Bug Fixes

* exclude auth endpoints from token expiry check and use domain visibility ([c9f7327](https://github.com/bffless/ce/commit/c9f732714f970dc5f5f8f05cd317bf351aadeb6e))

## [0.0.116](https://github.com/bffless/ce/compare/v0.0.115...v0.0.116) (2026-03-13)


### Features

* enforce project visibility on proxy endpoints and improve token refresh signaling ([0c38151](https://github.com/bffless/ce/commit/0c381516ed5dc0ffa9ab7d14ef4db4a05c72bb5e))

## [0.0.115](https://github.com/bffless/ce/compare/v0.0.114...v0.0.115) (2026-03-13)


### Features

* add custom domain JWT auth support for pipeline execution ([1f0f9e1](https://github.com/bffless/ce/commit/1f0f9e16be3a06cbf59a75b12f6f5286d3ead41f))

## [0.0.114](https://github.com/bffless/ce/compare/v0.0.113...v0.0.114) (2026-03-13)


### Bug Fixes

* extract user from session in proxy middleware for pipelines ([ac57d12](https://github.com/bffless/ce/commit/ac57d12a149be65ce31bed1f7300c8c787b6bb9e))
* proper HTTP status codes for pipeline errors and add auth debug logging ([da5d075](https://github.com/bffless/ce/commit/da5d075f0f5032d409a165d002c014035d69e763))

## [0.0.113](https://github.com/bffless/ce/compare/v0.0.112...v0.0.113) (2026-03-12)


### Bug Fixes

* save user message and conversation when using smart defaults ([d3f7488](https://github.com/bffless/ce/commit/d3f7488e4e13addff0f5c208feb90b2d72a05056))

## [0.0.112](https://github.com/bffless/ce/compare/v0.0.111...v0.0.112) (2026-03-12)


### Features

* add auto-persistence for AI chat messages in streaming mode ([7967eb8](https://github.com/bffless/ce/commit/7967eb8a105d4a03f63197d5c9cbc812a8dc70ab))

## [0.0.111](https://github.com/bffless/ce/compare/v0.0.110...v0.0.111) (2026-03-12)


### Bug Fixes

* ai sdk chat v3 ([4c332c3](https://github.com/bffless/ce/commit/4c332c356d5605c7553b48d32ba3b74e72b23702))
* auth headers ([a893018](https://github.com/bffless/ce/commit/a8930187ac03d2f3a0033859df708ba05561b577))

## [0.0.110](https://github.com/bffless/ce/compare/v0.0.109...v0.0.110) (2026-03-12)


### Bug Fixes

* chat streaming ([035bf3b](https://github.com/bffless/ce/commit/035bf3bf0e06663bfe08de137da735edaf1a5c83))

## [0.0.109](https://github.com/bffless/ce/compare/v0.0.108...v0.0.109) (2026-03-12)


### Features

* adds duplicate proxy ruleset ([a73719e](https://github.com/bffless/ce/commit/a73719e889251abce586d31894fd507d0bf13d18))


### Bug Fixes

* chat ([05d4f2f](https://github.com/bffless/ce/commit/05d4f2f6f622f88bd686e8c270c2aa31b4c626e7))
* textarea changes ([f75203a](https://github.com/bffless/ce/commit/f75203ab3b05ab455c2190613f4a9c2ed9865523))

## [0.0.108](https://github.com/bffless/ce/compare/v0.0.107...v0.0.108) (2026-03-12)


### Features

* add AI chat handler for pipelines with project-level AI settings ([a402db9](https://github.com/bffless/ce/commit/a402db989e1c6c248a7227550f2a06f55410fdce))
* AI handler for pipelines with project-level provider settings ([5dd67fc](https://github.com/bffless/ce/commit/5dd67fc946c8623dfbdf31bceb2ecc2e1b31ca39))
* rename chat_handler to ai_handler with mode toggle ([b4c764f](https://github.com/bffless/ce/commit/b4c764f2d00c57b986dbf496eea2e4bda1ca5e7d))

## [0.0.107](https://github.com/bffless/ce/compare/v0.0.106...v0.0.107) (2026-03-10)


### Bug Fixes

* reset lastModifiedAt after save to clear dirty state ([0f27546](https://github.com/bffless/ce/commit/0f27546b570e68575552398e90a6356c6aba384e))

## [0.0.106](https://github.com/bffless/ce/compare/v0.0.105...v0.0.106) (2026-03-10)


### Features

* replace input with explicit request.body and request.query ([0993e26](https://github.com/bffless/ce/commit/0993e26819e484b8b7bdb52e5e97fc1f42b4f2ac))

## [0.0.105](https://github.com/bffless/ce/compare/v0.0.104...v0.0.105) (2026-03-10)


### Bug Fixes

* lint ([611e260](https://github.com/bffless/ce/commit/611e260a2a9f71aa7fcb3f8ef818e53306e9081e))

## [0.0.104](https://github.com/bffless/ce/compare/v0.0.103...v0.0.104) (2026-03-10)


### Bug Fixes

* condition negation, function debug mode, and unsaved changes indicator ([c01cc9d](https://github.com/bffless/ce/commit/c01cc9d589dfd76ee0523260f7d9ec6751f452a2))

## [0.0.103](https://github.com/bffless/ce/compare/v0.0.102...v0.0.103) (2026-03-10)


### Features

* add state schema generation and pipeline improvements ([959860a](https://github.com/bffless/ce/commit/959860af6822ca56158ae8cc39b06880226d8704))

## [0.0.102](https://github.com/bffless/ce/compare/v0.0.101...v0.0.102) (2026-03-09)


### Features

* add search and filtering to Data tab ([681decc](https://github.com/bffless/ce/commit/681decce39e92c2a22ca4129d5344fa1c6e6870c))

## [0.0.101](https://github.com/bffless/ce/compare/v0.0.100...v0.0.101) (2026-03-09)


### Features

* pipeline UX improvements and validator support ([f9d4cf7](https://github.com/bffless/ce/commit/f9d4cf72df7727e8067a6fc21f0570e6a72dc0bf))

## [0.0.100](https://github.com/bffless/ce/compare/v0.0.99...v0.0.100) (2026-03-08)


### Bug Fixes

* recordId for update and delete pipeline ([64fb6ef](https://github.com/bffless/ce/commit/64fb6efe4a75841087738fcf91da08bd943bcece))

## [0.0.99](https://github.com/bffless/ce/compare/v0.0.98...v0.0.99) (2026-03-08)


### Features

* add HTTP method filtering to proxy rules ([7308484](https://github.com/bffless/ce/commit/73084848d494cfda0d0607c0d9b3366ce44810ff))

## [0.0.98](https://github.com/bffless/ce/compare/v0.0.97...v0.0.98) (2026-03-08)


### Features

* add copyable record IDs and recordId/single query options ([90f31db](https://github.com/bffless/ce/commit/90f31dba7a78808f2bfe485689a5ad630fe3ca01))

## [0.0.97](https://github.com/bffless/ce/compare/v0.0.96...v0.0.97) (2026-03-08)


### Bug Fixes

* html default email ([cea3ff4](https://github.com/bffless/ce/commit/cea3ff41fab09539c4f9119424e72e32bb479a5c))

## [0.0.96](https://github.com/bffless/ce/compare/v0.0.95...v0.0.96) (2026-03-08)


### Bug Fixes

* honeypot ([78d02f9](https://github.com/bffless/ce/commit/78d02f9d57cf13842f4fc7a70f2e2170d0e3a499))

## [0.0.95](https://github.com/bffless/ce/compare/v0.0.94...v0.0.95) (2026-03-08)


### Bug Fixes

* pipeline execution ([a552c53](https://github.com/bffless/ce/commit/a552c5397715e355e20b9d1e7203b5725196fdf6))

## [0.0.94](https://github.com/bffless/ce/compare/v0.0.93...v0.0.94) (2026-03-08)


### Bug Fixes

* expression evaluator handles literal values and add Monaco for email body ([218dc04](https://github.com/bffless/ce/commit/218dc04d742caa4179f050697d2b4964a7c3939c))

## [0.0.93](https://github.com/bffless/ce/compare/v0.0.92...v0.0.93) (2026-03-08)


### Features

* completes test ([4637f59](https://github.com/bffless/ce/commit/4637f59a397b4329052ec4a2734fecac8ca7e1ea))
* implement function handler with sandboxed JS execution (Phase D) ([5e342e4](https://github.com/bffless/ce/commit/5e342e4d08979ee078395b2702c15f9b30ddf608))
* implement handler library for pipelines (Phase C) ([e84bc74](https://github.com/bffless/ce/commit/e84bc744dff2c3d446567b51ab2b778d0bbb39d4))


### Bug Fixes

* json parsing ([4382fbe](https://github.com/bffless/ce/commit/4382fbe174d0cd106d04ff7f53391d112e1a7446))
* tests ([ca04b02](https://github.com/bffless/ce/commit/ca04b02eaa2698098c143bd2cba86f815730a472))

## [0.0.92](https://github.com/bffless/ce/compare/v0.0.91...v0.0.92) (2026-03-07)


### Features

* add pipeline foundation and data tab (Phase B + F) ([ee5b149](https://github.com/bffless/ce/commit/ee5b149f65f6ff1aae951204c563ba7106382f4a))
* add pipeline foundation and data tab (Phase B + F) ([65d3ba7](https://github.com/bffless/ce/commit/65d3ba73de66dab56334da67f4a17bdbebe43cd5))

## [0.0.91](https://github.com/bffless/ce/compare/v0.0.90...v0.0.91) (2026-03-07)


### Features

* refactor proxy rules to full-page views with path-based routing ([2a4d984](https://github.com/bffless/ce/commit/2a4d9845435f3707211e73adf3d8bd130671469f))
* refactor proxy rules to full-page views with path-based routing ([4238e23](https://github.com/bffless/ce/commit/4238e2334c1fe23e5be65ac76a6073dee9c5fb18))

## [0.0.90](https://github.com/bffless/ce/compare/v0.0.89...v0.0.90) (2026-03-07)


### Bug Fixes

* handle custom domain relay when already logged in ([3088ee8](https://github.com/bffless/ce/commit/3088ee87c2f7d5477d61eddf944361dc290d8c53))

## [0.0.89](https://github.com/bffless/ce/compare/v0.0.88...v0.0.89) (2026-03-07)


### Bug Fixes

* update platform mode nginx template with consolidated auth routes ([a64c044](https://github.com/bffless/ce/commit/a64c0448784e42f610ef2d2ec247a090105ee7a1))

## [0.0.88](https://github.com/bffless/ce/compare/v0.0.87...v0.0.88) (2026-03-07)


### Features

* add session endpoint to nginx custom domain template ([134eb87](https://github.com/bffless/ce/commit/134eb870308a0bea57cab3d456745c3a89991ab6))

## [0.0.87](https://github.com/bffless/ce/compare/v0.0.86...v0.0.87) (2026-03-07)


### Features

* add session endpoint for custom domain authentication ([8198cab](https://github.com/bffless/ce/commit/8198cab6c116350acf21e0cdbef2b83a4c994011))

## [0.0.86](https://github.com/bffless/ce/compare/v0.0.85...v0.0.86) (2026-03-06)


### Bug Fixes

* change SameSite from strict to lax for custom domain cookies ([a9d568d](https://github.com/bffless/ce/commit/a9d568d73dcc3d5679c2432fb41d9bbfef12b17d))

## [0.0.85](https://github.com/bffless/ce/compare/v0.0.84...v0.0.85) (2026-03-06)


### Bug Fixes

* always use HTTPS for custom domain auth redirects and cookies ([26ca8be](https://github.com/bffless/ce/commit/26ca8be2eda1bbe4e1368cac6600c62b79de33a2))

## [0.0.84](https://github.com/bffless/ce/compare/v0.0.83...v0.0.84) (2026-03-06)


### Bug Fixes

* allow private visibility on custom domains in backend ([fc7a2eb](https://github.com/bffless/ce/commit/fc7a2eb6972a18f98a8a41fdbb7ad756bad460c8))

## [0.0.83](https://github.com/bffless/ce/compare/v0.0.82...v0.0.83) (2026-03-06)


### Features

* add authentication support for custom domains ([08f1857](https://github.com/bffless/ce/commit/08f1857f4ff14437c2f3b808b956915da177bcde))

## [0.0.82](https://github.com/bffless/ce/compare/v0.0.81...v0.0.82) (2026-03-05)


### Bug Fixes

* domain mappings ([40187cd](https://github.com/bffless/ce/commit/40187cd4a1fe98ec4b75aac327d19a8a1125157a))

## [0.0.81](https://github.com/bffless/ce/compare/v0.0.80...v0.0.81) (2026-03-05)


### Bug Fixes

* redirect domain ssl bug on platform ([6597d6e](https://github.com/bffless/ce/commit/6597d6e07c717eabca79467bc3d48a8ae1112d63))

## [0.0.80](https://github.com/bffless/ce/compare/v0.0.79...v0.0.80) (2026-03-05)


### Bug Fixes

* base domain for cname ([f891b44](https://github.com/bffless/ce/commit/f891b442ac82644662182d6f41a43b2723f6bf63))

## [0.0.79](https://github.com/bffless/ce/compare/v0.0.78...v0.0.79) (2026-03-05)


### Features

* adds cname instructions ([e17bac4](https://github.com/bffless/ce/commit/e17bac46320829145aaca42d270702b7f46e8e9a))

## [0.0.78](https://github.com/bffless/ce/compare/v0.0.77...v0.0.78) (2026-03-04)


### Bug Fixes

* invitation message ([8f067d9](https://github.com/bffless/ce/commit/8f067d9a67c107a3b7ecaa8e2925651649351ed3))

## [0.0.77](https://github.com/bffless/ce/compare/v0.0.76...v0.0.77) (2026-03-03)


### Features

* **invitations:** add redirect URL field to UsersPage invitations tab ([240bd77](https://github.com/bffless/ce/commit/240bd77682866febb2fd99b0af22c3d4e8fe8e9d))

## [0.0.76](https://github.com/bffless/ce/compare/v0.0.75...v0.0.76) (2026-03-03)


### Features

* **invitations:** add redirect URL support for post-signup redirects ([5caa9e9](https://github.com/bffless/ce/commit/5caa9e9becd5acdc140071d25b28658d43cf7b1d))

## [0.0.75](https://github.com/bffless/ce/compare/v0.0.74...v0.0.75) (2026-03-03)


### Bug Fixes

* clear all nginx configs on startup to prevent stale config crashes ([ab9972e](https://github.com/bffless/ce/commit/ab9972e9560a57100ff73b023739d2448a5c156b))

## [0.0.74](https://github.com/bffless/ce/compare/v0.0.73...v0.0.74) (2026-03-02)


### Bug Fixes

* redirect domain dns messaging ([7ebfbd6](https://github.com/bffless/ce/commit/7ebfbd63d2095951ad43d367c3177c37901beb00))

## [0.0.73](https://github.com/bffless/ce/compare/v0.0.72...v0.0.73) (2026-02-28)


### Bug Fixes

* restore CI uploads and chain release-please to Docker build ([5772c15](https://github.com/bffless/ce/commit/5772c1566b8d529a9ffaf080dd0cc8ce17f5df37))

## [0.0.72](https://github.com/bffless/ce/compare/v0.0.71...v0.0.72) (2026-02-28)


### Bug Fixes

* test ci ([eebb7eb](https://github.com/bffless/ce/commit/eebb7ebd49d8a3615ab26cc36ba9e34b41a7fb66))

## [0.0.71](https://github.com/bffless/ce/compare/v0.0.70...v0.0.71) (2026-02-28)


### Bug Fixes

* remove component prefix from release tags ([874cce8](https://github.com/bffless/ce/commit/874cce879b44b8588cd1477094cfd0e2eff18408))

## [0.0.70](https://github.com/bffless/ce/compare/ce-v0.0.69...ce-v0.0.70) (2026-02-28)


### Features

* add batch download endpoints for download-artifact action ([48d3d9e](https://github.com/bffless/ce/commit/48d3d9e89a9964aa851f471d7b4788a0b6905fb4))
* add batch download endpoints for download-artifact action ([730e629](https://github.com/bffless/ce/commit/730e62915b3941fffff86468d4c3bfe69cc3be0d))
* add copy buttons and timing message for SSL CNAME records ([1df5298](https://github.com/bffless/ce/commit/1df5298c4a6d4557b1bd2272447522ded21688c7))
* add email form handler proxy rule type ([52178d7](https://github.com/bffless/ce/commit/52178d78f17a61cfe63f9c634ea0ea5234f1ec9f))
* add email form handler proxy rule type ([6d9eae0](https://github.com/bffless/ce/commit/6d9eae0eeadd7b7039e4db0aac6babbe89ef7d5e))
* add pre-signed URL support for artifact uploads ([dea4a0f](https://github.com/bffless/ce/commit/dea4a0f120ad2179a9636c26b82b184e7cd596f1))
* add pre-signed URL support for artifact uploads ([4e6ad6e](https://github.com/bffless/ce/commit/4e6ad6e5aa1ca3510aadd70bcffcb2ef00724fb6))
* add two-phase SSL provisioning for externally managed domains ([3ec58c3](https://github.com/bffless/ce/commit/3ec58c3f4e5be89d0f00f85aecef4e00dd9009b3))
* add user onboarding automation rules ([7d7db40](https://github.com/bffless/ce/commit/7d7db4064465794e3327d27e1a65e2e39ec0ba4c))
* add user onboarding automation rules ([588852e](https://github.com/bffless/ce/commit/588852eb3e658cd0ef5b90a82562b11073615698))
* adds global api keys ([8ea020f](https://github.com/bffless/ce/commit/8ea020f586de229117f18ffae1c0afcc5bb8ca65))
* adds global api keys ([ba89969](https://github.com/bffless/ce/commit/ba899698ed01c62a9d2b9d0baed76bc2695d2a2f))
* adds isPublic for download asset action ([dd0e893](https://github.com/bffless/ce/commit/dd0e8932406290708ea897b43f29f93d497c48aa))
* adds path typeahead ([d00187d](https://github.com/bffless/ce/commit/d00187d4b50d1aa308718bc79e2cc7c888b4033c))
* adds pendo ([a52f08c](https://github.com/bffless/ce/commit/a52f08c40f651be922ea4c0c0b58c66c0e2f3e70))
* adds pendo ([2c2c5b1](https://github.com/bffless/ce/commit/2c2c5b1fb3df68010da1fe0e5618735d5b79171a))
* changes ci to release-please ([bb8fa58](https://github.com/bffless/ce/commit/bb8fa58b82125514f91b0e1353314c510e9b76f4))
* community app store trigger ([a674088](https://github.com/bffless/ce/commit/a67408858ad01ac35da6c0c4ef087f2e3921584e))
* display CNAME instructions for externally managed domains ([b1045e5](https://github.com/bffless/ce/commit/b1045e57e6c7c3423316e3e2a67237dfab6be52c))
* improve Cloudflare support for custom domains ([7200897](https://github.com/bffless/ce/commit/720089787352af1c4651a44c9461d7c804e2c093))
* improve Cloudflare support for custom domains ([bb97b69](https://github.com/bffless/ce/commit/bb97b69f1e16e2b7f28791b6af9d287929846af8))
* initial commit ([9268e7f](https://github.com/bffless/ce/commit/9268e7f3639e216ab9da4939340bfb4ba290148e))
* **proxy-rules:** add internal rewrite feature and fix exact match stripping ([1cf560f](https://github.com/bffless/ce/commit/1cf560fea88776ea73c95913a97b2cb5a6e19386))
* **proxy-rules:** add internal rewrite feature and fix exact match stripping ([56c2538](https://github.com/bffless/ce/commit/56c2538c49c4093f0c0c10d4e4cf84dd83a3b6a7))
* renames wsa to ce ([ecd629c](https://github.com/bffless/ce/commit/ecd629cd354a66837f9eeaa884835d2521e430f5))
* tos based on feature flag ([5547509](https://github.com/bffless/ce/commit/5547509866bf0176860b3859b27e2914d675c5b7))
* umbrel packaging ([0b05942](https://github.com/bffless/ce/commit/0b0594297198d66c60e25d88220a11875bceac23))
* umbrel packaging ([05e59fa](https://github.com/bffless/ce/commit/05e59fab63386518cb33f19a387b9a761f7ef215))
* use native ARM64 runners instead of QEMU for multi-arch builds ([33dc2ac](https://github.com/bffless/ce/commit/33dc2ac8d43a63bc111fb45f1f55f87fa2772c15))
* use native ARM64 runners instead of QEMU for multi-arch builds ([1baf578](https://github.com/bffless/ce/commit/1baf578db731eafa0a772eaa2fba4d6b40bb4a37))


### Bug Fixes

* accept email instead of UUID when granting project permissions ([4d92ae9](https://github.com/bffless/ce/commit/4d92ae9d1f87105549e1c394a8c3560dbdd24de9))
* add delay between config delete and write to avoid race condition ([7a702f1](https://github.com/bffless/ce/commit/7a702f155d2f106802031628df0d6eaddf8cf3c7))
* apply caching layer to all storage types including local ([07ec592](https://github.com/bffless/ce/commit/07ec592bb987b9bc4461be8c336d97f8e5ec6691))
* aws error message for migration to bucket ([3524fb0](https://github.com/bffless/ce/commit/3524fb076560b51fee27d443d78407f35df03569))
* clean up stale primary domain mapping when domain changes ([1a2b4d3](https://github.com/bffless/ce/commit/1a2b4d3aa1e3e3310aad871fac77b3483393885f))
* cloudflare onboarding ([7d5560d](https://github.com/bffless/ce/commit/7d5560d44116c49fa60d75eb5c53aa88caedbc2e))
* cloudflare tunnel ([5aecf55](https://github.com/bffless/ce/commit/5aecf5538baf0544c39f982d6604d73421743254))
* correct ARM64 runner label to ubuntu-24.04-arm ([c31215f](https://github.com/bffless/ce/commit/c31215f3a7ac7348aa2afd6b1e546d87e17fbc00))
* debug rewrite ([2f118fe](https://github.com/bffless/ce/commit/2f118fe70d034ab1f56846c1ca7923dbbb3fbde7))
* delegate presigned URL methods in CachingStorageAdapter ([81dc27a](https://github.com/bffless/ce/commit/81dc27af06c2facf22372f1575a6250fb4f419ab))
* delegate presigned URL methods in DynamicStorageAdapter ([1d2ee3f](https://github.com/bffless/ce/commit/1d2ee3f0c56cd4c9bbe681eed06b96267135571d))
* delegate presigned URL methods in DynamicStorageAdapter ([074d678](https://github.com/bffless/ce/commit/074d678675dc6eb31b818fd626d3628f875e9b03))
* domain aliases dropdown ([1a2dd15](https://github.com/bffless/ce/commit/1a2dd15774260b757f732d24ad9633f7456c537a))
* domain flags ([041c74a](https://github.com/bffless/ce/commit/041c74a215f5abaeffda5f5d0cbe59ec85e2eb41))
* duplicate files and path rewrite ([72acdcf](https://github.com/bffless/ce/commit/72acdcf7dfc19ff2f9d1a4a65320531c30a47746))
* email setup ([0fd5c13](https://github.com/bffless/ce/commit/0fd5c13a80fb18506c2beab4bdfcb3c8e14a5e05))
* expose TOS flags via registration-status endpoint ([9844eb6](https://github.com/bffless/ce/commit/9844eb616594c0e34d883ff49316e828eb2f1446))
* generate welcome page when disabling primary content ([97ba9b7](https://github.com/bffless/ce/commit/97ba9b7547b99270c155126ff308a3ad33ecf034))
* handle apex/www redirects in backend fallback for custom domains ([bf44251](https://github.com/bffless/ce/commit/bf44251e8fcd6cb4059429ba2d24f523ff8c6ee3))
* hide delete commit button for viewers ([e8d9741](https://github.com/bffless/ce/commit/e8d97415259520d1873908e2a6063a9ac0fce697))
* hide edit controls from viewers on repo overview page ([62b86e6](https://github.com/bffless/ce/commit/62b86e6a0a31013b2cfe9cdcfd62de4f9219a306))
* internal rewrite ([f52e77b](https://github.com/bffless/ce/commit/f52e77b7ee9cf0206782668adccfd84244eec05d))
* listen port ([936a001](https://github.com/bffless/ce/commit/936a00101f7cc7f5324686ede5b9766eb00c3a2c))
* migration ([320f777](https://github.com/bffless/ce/commit/320f777056110a3ce7b1c86306697d6be87913e8))
* minor ui bugs ([43bcf40](https://github.com/bffless/ce/commit/43bcf4040b9f788d69d2864507f9ce0e5f1409f3))
* mock useProjectRole in DeleteCommitButton tests ([d7b6a06](https://github.com/bffless/ce/commit/d7b6a060c0f1dab7fb4b3b0395c2d714464278a7))
* multi-arch build tag with umbrel ([65d97e3](https://github.com/bffless/ce/commit/65d97e35d3289ec7d9bce8546b06aa17edc0a070))
* nginx cleanup ([2a496ec](https://github.com/bffless/ce/commit/2a496ec8c9ad0e0cb3d163f4b941fc1ae4b471ce))
* nginx for umbrel ([cd5135e](https://github.com/bffless/ce/commit/cd5135e10001e9714a0f87a79c790f9825714e12))
* nginx port var ([9f3e915](https://github.com/bffless/ce/commit/9f3e915100eaf01ef8a5751382183c2f816e0403))
* package.json name ([48721bd](https://github.com/bffless/ce/commit/48721bd6825751690dd986d5e3fe7daf76f87a7b))
* path typeahead ([f819e06](https://github.com/bffless/ce/commit/f819e06b67c2b786e7c1a5705c2465f7e7f38bab))
* permissions ([691d28b](https://github.com/bffless/ce/commit/691d28bdc3f00b15c1011e2c6283add85e79988e))
* preserve wwwEnabled=false when creating primary domain mapping ([82cf776](https://github.com/bffless/ce/commit/82cf776238241fa134255d6756ccb04a575fc097))
* preview urls on upload ([27ab1ad](https://github.com/bffless/ce/commit/27ab1ad97fe1c55c31aef6af8afc0f813fd5eb93))
* re-orders public controller route ([8592796](https://github.com/bffless/ce/commit/85927967bd1b0541f3ae71c358887d79695d8fdf))
* re-orders public controller route ([204f5a1](https://github.com/bffless/ce/commit/204f5a163097b3379cbc8ae32155571067c8fed4))
* removes branch url in upload response ([e60c218](https://github.com/bffless/ce/commit/e60c218abfcd15e9071184d755b2b05824fef4c9))
* repo browswer toolbar ([cbe9bfa](https://github.com/bffless/ce/commit/cbe9bfafc6bc12bd20fe19211b31c0811cd86ffd))
* resolve member user experience and dialog component issues ([d40f1c9](https://github.com/bffless/ce/commit/d40f1c9453c96dcb2e5da477064f875cf65e2c92))
* rewrite ([a9e2587](https://github.com/bffless/ce/commit/a9e2587edc946a93a8f98b79b4cd2a52270aa0a1))
* roles for admin ([c69a961](https://github.com/bffless/ce/commit/c69a96146b7bf78f5c1c290c802fc33dc28de316))
* s3 delete ([4b6c870](https://github.com/bffless/ce/commit/4b6c87009dabfb7948b44813627c1abb3cdd3050))
* session auth guard ([f70c02f](https://github.com/bffless/ce/commit/f70c02f06b564b1975df2cffc86d170b641aa1cd))
* show DNS instructions for custom domains in platform mode ([beac873](https://github.com/bffless/ce/commit/beac873ee8d1cf0683319611134fde8da28aed48))
* spa setting ([920c07a](https://github.com/bffless/ce/commit/920c07a0f0158c63abc3bce0af2ccfe5c19da006))
* ssl banner and setup ([0ad2d73](https://github.com/bffless/ce/commit/0ad2d730330185db63e9efbd155eb624ff099e67))
* support wwwBehavior (apex redirect) in Cloudflare proxy modes ([bcfea8d](https://github.com/bffless/ce/commit/bcfea8db85effc1db2ef722d5d7e5fa8083a87ca))
* sync ([2dab297](https://github.com/bffless/ce/commit/2dab297d1a76df2cb5d92a4af771d7b1406f31b9))
* test ([c9aa41e](https://github.com/bffless/ce/commit/c9aa41e021cebd8009113e2f08d7487aa7865475))
* test ([2970376](https://github.com/bffless/ce/commit/2970376a9f081ae86397931611464eff15bff08b))
* testing deploy ([a85daf0](https://github.com/bffless/ce/commit/a85daf0d391a9e4ff369b8cbe5655812b8ab80e0))
* umbrel build ([af02fe7](https://github.com/bffless/ce/commit/af02fe73bf58e4c88af3715f4b9019227468b66c))
* update tests for storage error handling and delete path changes ([e524db4](https://github.com/bffless/ce/commit/e524db46203c4dcb33382480575ef07649e90350))
* use dynamic matrix generation for platform selection ([744cf3f](https://github.com/bffless/ce/commit/744cf3fd6cc08e7d1f1f72a03b956ddd7baa8c2d))

## [0.0.69](https://github.com/bffless/ce/compare/v0.0.68...v0.0.69) (2024)

### Bug Fixes

* preview urls on upload

## [0.0.68](https://github.com/bffless/ce/compare/v0.0.67...v0.0.68) (2024)

### Bug Fixes

* repo browser toolbar

## [0.0.67](https://github.com/bffless/ce/compare/v0.0.66...v0.0.67) (2024)

### Bug Fixes

* roles for admin

## [0.0.66](https://github.com/bffless/ce/compare/v0.0.65...v0.0.66) (2024)

### Bug Fixes

* permissions

## [0.0.65](https://github.com/bffless/ce/compare/v0.0.64...v0.0.65) (2024)

### Bug Fixes

* cloudflare onboarding

## 0.0.64 and earlier

Initial releases with core platform features:

- **Core Platform**: Asset upload from GitHub Actions, web-based asset browser, project management
- **Authentication**: SuperTokens integration, API key authentication, role-based access control
- **Storage**: Pluggable storage adapters (MinIO, S3, GCS, Azure, Local)
- **Domain Management**: Custom domain mapping, subdomain routing, SSL certificates
- **Proxy Rules**: Reverse proxy configuration, path-based routing
- **Infrastructure**: Docker Compose deployment, nginx reverse proxy, PostgreSQL with Drizzle ORM
