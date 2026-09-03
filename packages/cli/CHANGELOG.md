# Changelog

## [0.3.6](https://github.com/bffless/ce/compare/bffless-v0.3.5...bffless-v0.3.6) (2026-09-03)


### Added

* **auth:** app tokens, auth_required requiredScopes, per-rule bypassVisibility ([#730](https://github.com/bffless/ce/issues/730)) ([aff3180](https://github.com/bffless/ce/commit/aff318089cc8308c71642bcbccfcaa71c674b3f6))

## [0.3.5](https://github.com/bffless/ce/compare/bffless-v0.3.4...bffless-v0.3.5) (2026-08-29)


### Added

* **proxy-rules:** adopt additive schema fields on sync (opt-in, owner-scoped) ([#722](https://github.com/bffless/ce/issues/722)) ([269c5ea](https://github.com/bffless/ce/commit/269c5eabc37cf86e4bf0dce9327a73b80f24ca11))

## [0.3.4](https://github.com/bffless/ce/compare/bffless-v0.3.3...bffless-v0.3.4) (2026-08-29)


### Added

* **pipelines:** return the execution-log id as X-Pipeline-Log-Id on debug-enabled proxy-rule responses ([#717](https://github.com/bffless/ce/issues/717)) ([04f6c9f](https://github.com/bffless/ce/commit/04f6c9f41ce426222ccd03fbd535f75932d45256))

## [0.3.3](https://github.com/bffless/ce/compare/bffless-v0.3.2...bffless-v0.3.3) (2026-08-27)


### Added

* **cli:** --path-prefix for rules build, push and diff ([#704](https://github.com/bffless/ce/issues/704)) ([bbc63cd](https://github.com/bffless/ce/commit/bbc63cdc43dc347efd49a3dba4e468e0454cae4c))

## [0.3.2](https://github.com/bffless/ce/compare/bffless-v0.3.1...bffless-v0.3.2) (2026-08-05)


### Features

* declare what a pipeline schema is for with a kind column ([#635](https://github.com/bffless/ce/issues/635)) ([c580fea](https://github.com/bffless/ce/commit/c580fea89891e0f4c94448fbb7921e65172bbf55))

## [0.3.1](https://github.com/bffless/ce/compare/bffless-v0.3.0...bffless-v0.3.1) (2026-07-27)


### Features

* **cli:** bffless login credential store + auth commands ([#555](https://github.com/bffless/ce/issues/555)) ([e89f822](https://github.com/bffless/ce/commit/e89f822f83ae3603b6eab1e4d313ece2aaa801fe))

## [0.3.0](https://github.com/bffless/ce/compare/bffless-v0.2.7...bffless-v0.3.0) (2026-07-25)


### ⚠ BREAKING CHANGES

* `git pull` is a required upgrade step for this release. v0.3.0 adds compose mounts (bootstrap/), an ONBOARDING_TOKEN passthrough, and a rebuilt nginx image — pulling only the Docker images leaves the new day-2 SSL management silently inert (settings apply but never reach nginx) and breaks automatic renewal takeover for migrated Let's Encrypt installs. Upgrade with: cd /opt/bffless && git pull && ./stop.sh && docker compose pull && ./start.sh

### Miscellaneous Chores

* git pull is a required upgrade step for 0.3.0 ([281a259](https://github.com/bffless/ce/commit/281a2592d012c289973bc5eb77ebc3757656ebc9))
* release 0.3.0 ([c9fe396](https://github.com/bffless/ce/commit/c9fe396efe5b3eb4cc45142b58f100da5df041cd))

## [0.2.7](https://github.com/bffless/ce/compare/bffless-v0.2.6...bffless-v0.2.7) (2026-07-17)


### Bug Fixes

* **cli:** treat pipeline step name as optional, matching the server ([#491](https://github.com/bffless/ce/issues/491)) ([f3f3729](https://github.com/bffless/ce/commit/f3f3729cef320265c724389a37baf7d45290e4ec))

## [0.2.6](https://github.com/bffless/ce/compare/bffless-v0.2.5...bffless-v0.2.6) (2026-07-14)


### Features

* **cli:** add rules init --schema scaffold command ([#486](https://github.com/bffless/ce/issues/486)) ([04a35f2](https://github.com/bffless/ce/commit/04a35f2f3f79c73850fb656b4235e4146d6bfe9d))

## [0.2.5](https://github.com/bffless/ce/compare/bffless-v0.2.4...bffless-v0.2.5) (2026-07-14)


### Features

* **cli:** action-friendly lib — overridable remediation, applyNameSuffix, name on PushOutcome ([#478](https://github.com/bffless/ce/issues/478)) ([adc74b3](https://github.com/bffless/ce/commit/adc74b34e70e765c9c31fa0c58fd0bfa62b11e1d))

## [0.2.4](https://github.com/bffless/ce/compare/bffless-v0.2.3...bffless-v0.2.4) (2026-07-14)


### Bug Fixes

* **cli:** resolve owner/name projects via the access-scoped endpoint ([#477](https://github.com/bffless/ce/issues/477)) ([07fafac](https://github.com/bffless/ce/commit/07fafacfc4eb770f72938dc5874e1a22481d6e44))

## [0.2.3](https://github.com/bffless/ce/compare/bffless-v0.2.2...bffless-v0.2.3) (2026-07-14)


### Bug Fixes

* **backend:** capture a revision when a schema generator writes proxy rules ([#475](https://github.com/bffless/ce/issues/475)) ([480fb74](https://github.com/bffless/ce/commit/480fb747534a10fd2701da5252814f4a27fd1490))

## [0.2.2](https://github.com/bffless/ce/compare/bffless-v0.2.1...bffless-v0.2.2) (2026-07-13)


### Bug Fixes

* **cli:** let `rules rollback --to` accept the short revision ids the table prints ([#472](https://github.com/bffless/ce/issues/472)) ([fc2ff96](https://github.com/bffless/ce/commit/fc2ff964f41bfd0869c135a26ce9be4188235937)), closes [#465](https://github.com/bffless/ce/issues/465)

## [0.2.1](https://github.com/bffless/ce/compare/bffless-v0.2.0...bffless-v0.2.1) (2026-07-13)


### Bug Fixes

* **cli:** decompile a dual method/methods rule under the any stem ([#470](https://github.com/bffless/ce/issues/470)) ([dd9474b](https://github.com/bffless/ce/commit/dd9474bf85853142085d8ebb9aab71b8e80a60f3)), closes [#469](https://github.com/bffless/ce/issues/469)

## [0.2.0](https://github.com/bffless/ce/compare/bffless-v0.1.0...bffless-v0.2.0) (2026-07-12)


### Features

* **cli:** proxy-rules-as-code — Phase 0 (bffless CLI compiler/decompiler + harness) ([#449](https://github.com/bffless/ce/issues/449)) ([469e35d](https://github.com/bffless/ce/commit/469e35d68159c647ea1812e5ca5ef6d4266bc591))
* proxy-rules-as-code — Phase 1 (CE sync surface: export + sync endpoints, source tracking, live CLI) ([#451](https://github.com/bffless/ce/issues/451)) ([e884652](https://github.com/bffless/ce/commit/e88465215d2edfbbc285fa9ec2f7ecf714a7e584))
* proxy-rules-as-code — Phase 3 — revisions/rollback, TS handlers, rules dev, CLI publish ([#463](https://github.com/bffless/ce/issues/463)) ([901bd82](https://github.com/bffless/ce/commit/901bd823ebd69726eb7079b592c132a8bfd01b00))
* proxy-rules-as-code Phase 2 — CLI npm publish prep, bffless/lib entry, plural DTO normalize ([#454](https://github.com/bffless/ce/issues/454)) ([fae7d33](https://github.com/bffless/ce/commit/fae7d33d7e6191c8be778e8338784f2cf8724cc9))


### Miscellaneous Chores

* release 0.2.0 ([2a670dd](https://github.com/bffless/ce/commit/2a670dd2ddae9296441fa7e4dbd307228cc4efc9))
