# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
