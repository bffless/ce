// Side-effect module: importing this file hydrates process.env from
// bootstrap/instance.json (when present and applied) as an import-time side
// effect, BEFORE any other module in the app is evaluated.
//
// Why this has to be a side-effect import rather than a plain function call
// in main.ts's body: ES import statements (and their CommonJS/tsc-compiled
// `require` equivalents) are hoisted and execute in source order BEFORE any
// of main.ts's own top-level statements. main.ts imports AppModule, whose
// `@Module({ imports: [AuthModule.forRoot(), ...] })` decorator evaluates
// `AuthModule.forRoot()` at import time (decorator arguments are evaluated
// as part of class definition, i.e. at module-evaluation time) — and
// `AuthModule.forRoot()` calls `initSuperTokens()` synchronously, which
// reads `process.env.FRONTEND_URL` / `API_DOMAIN` / `COOKIE_DOMAIN` right
// then (see auth/supertokens.config.ts). So by the time a statement placed
// in main.ts's function body would run, SuperTokens has already captured
// process.env — too late for bootstrap-mode identity to have any effect.
//
// The fix: make hydration itself a side effect of an import, and place that
// import as the literal FIRST line of main.ts, above `import { AppModule }`.
// Side-effect imports execute in source order, so this import's body runs
// to completion before main.ts's next import (AppModule) is even resolved,
// guaranteeing hydrated identity vars are in process.env before
// AuthModule.forRoot()/initSuperTokens() ever reads them.
//
// DO NOT let an import-sorter or linter move this below other imports in
// main.ts, and do not reorder this import below `./app.module` — either
// would silently break bootstrap mode (env-only installs are unaffected
// either way, so the regression would only surface on bootstrapped
// instances). This repo has no import-order eslint rule as of this writing;
// if one is added later, pin this import's position explicitly.
import { adoptOrResyncEnvInstall, hydrateProcessEnv } from './instance-config';

// Legacy env-install adoption/re-sync must run before hydration so the file
// hydrate reads is never stale relative to .env (spec §3).
adoptOrResyncEnvInstall();
const instanceCfg = hydrateProcessEnv();
if (instanceCfg?.state === 'applied') {
  // eslint-disable-next-line no-console
  console.log(
    `[bootstrap] identity hydrated from instance.json: ${instanceCfg.primaryDomain}` +
      (instanceCfg.origin === 'env' ? ' (env-adopted; .env remains authoritative)' : ''),
  );
}
