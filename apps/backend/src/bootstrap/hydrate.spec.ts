import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('bootstrap/hydrate', () => {
  describe('import ordering in main.ts (static guard)', () => {
    it('keeps the ./bootstrap/hydrate side-effect import as the literal first import', () => {
      // main.ts's hydration import must run before AppModule's import graph is
      // evaluated (AppModule's @Module() decorator calls AuthModule.forRoot() ->
      // initSuperTokens() synchronously at import time, reading process.env vars
      // that hydrate.ts is responsible for populating first). ES imports are
      // hoisted and execute in source order, so "first import in the file" is
      // the only thing that actually enforces the ordering — see hydrate.ts's
      // header comment for the full argument. Resolve relative to __dirname
      // (not cwd) so this works no matter where jest is invoked from.
      const mainTsPath = path.join(__dirname, '..', 'main.ts');
      const source = fs.readFileSync(mainTsPath, 'utf8');

      const importLines = source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^import\s/.test(line));

      const expectedFirstImport = "import './bootstrap/hydrate';";
      const firstImport = importLines[0];

      // Deliberately not a `source.includes(...)` check: that would still pass
      // if the import were present but moved further down the file (e.g. below
      // `import { AppModule } from './app.module'`), which is exactly the
      // silent-breakage scenario this guard exists to catch. We check it is
      // the FIRST import statement in source order.
      if (firstImport !== expectedFirstImport) {
        throw new Error(
          `main.ts's first import must be ${JSON.stringify(expectedFirstImport)}, but found ` +
            `${JSON.stringify(firstImport)} instead (import order found: ${JSON.stringify(importLines)}).\n\n` +
            'Why this matters: hydrate.ts populates process.env (PRIMARY_DOMAIN, FRONTEND_URL, ' +
            'API_DOMAIN, ADMIN_DOMAIN, COOKIE_DOMAIN, COOKIE_SECURE, PROXY_MODE) from ' +
            'bootstrap/instance.json as an import-time side effect. main.ts also imports AppModule, ' +
            'whose @Module({ imports: [AuthModule.forRoot(), ...] }) decorator invokes ' +
            'initSuperTokens() synchronously AT IMPORT TIME, reading those same env vars. ES imports ' +
            'are hoisted and execute in source order, so hydration MUST resolve before AppModule is ' +
            'imported, which means the hydrate import MUST be the first import in the file. If this ' +
            'moved (e.g. an "organize imports" pass or a future import/order lint rule sorted it), ' +
            'bootstrap-mode domain identity silently stops reaching SuperTokens on bootstrapped ' +
            'instances, with no other test catching it (env-only installs are unaffected, so the ' +
            'regression would only surface live, on a customer VPS). See bootstrap/hydrate.ts for the ' +
            'full ordering argument.',
        );
      }
    });
  });

  describe('behavioral coverage (both hydration paths)', () => {
    // process.env keys hydrate.ts / hydrateProcessEnv() can touch, plus the
    // BOOTSTRAP_DIR we point at a temp fixture dir for each test. Saved and
    // restored around every test so nothing leaks into the rest of the (1800+
    // test) suite.
    const touchedEnvKeys = [
      'BOOTSTRAP_DIR',
      'PRIMARY_DOMAIN',
      'FRONTEND_URL',
      'API_DOMAIN',
      'ADMIN_DOMAIN',
      'COOKIE_DOMAIN',
      'COOKIE_SECURE',
      'PROXY_MODE',
    ];

    let savedEnv: Record<string, string | undefined>;
    let dir: string;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      savedEnv = {};
      for (const key of touchedEnvKeys) savedEnv[key] = process.env[key];
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-hydrate-'));
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      jest.resetModules();
    });

    afterEach(() => {
      for (const key of touchedEnvKeys) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      logSpy.mockRestore();
      jest.resetModules();
    });

    it('applied fixture: hydrates process.env and logs the [bootstrap] line', () => {
      fs.writeFileSync(
        path.join(dir, 'instance.json'),
        JSON.stringify({ version: 1, state: 'applied', primaryDomain: 'example.com' }),
      );
      process.env.BOOTSTRAP_DIR = dir;

      // hydrate.ts is a side-effect module (it runs hydrateProcessEnv() at
      // import time), so it must be re-imported fresh per test to pick up the
      // BOOTSTRAP_DIR set above. isolateModules gives it its own module
      // registry for this require; resetModules (beforeEach/afterEach) keeps
      // that isolation from leaking into other spec files.
      jest.isolateModules(() => {
        require('./hydrate');
      });

      expect(process.env.PRIMARY_DOMAIN).toBe('example.com');
      expect(process.env.FRONTEND_URL).toBe('https://www.example.com');
      expect(process.env.API_DOMAIN).toBe('https://www.example.com');
      expect(process.env.ADMIN_DOMAIN).toBe('admin.example.com');
      expect(process.env.COOKIE_DOMAIN).toBe('.example.com');
      expect(process.env.COOKIE_SECURE).toBe('true');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[bootstrap] identity hydrated from instance.json: example.com'),
      );
    });

    it('no instance.json: leaves process.env untouched and logs nothing (byte-identical to an env-only install today)', () => {
      // dir exists (mkdtemp) but deliberately has no instance.json written to it.
      process.env.BOOTSTRAP_DIR = dir;

      const before: Record<string, string | undefined> = {};
      for (const key of touchedEnvKeys) before[key] = process.env[key];

      jest.isolateModules(() => {
        require('./hydrate');
      });

      for (const key of touchedEnvKeys) {
        expect(process.env[key]).toBe(before[key]);
      }
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
