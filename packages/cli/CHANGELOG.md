# Changelog

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
