/**
 * Regression guard for file-level import cycles between Nest modules.
 *
 * Loading `AppModule` requires every module file in production order. When a
 * module file is required while one of its own imports is still mid-evaluation
 * (a CommonJS cycle), the decorator sees `undefined` instead of the class and
 * Nest refuses to boot with "The module at index [n] of the X imports array is
 * undefined". Unit tests never load the whole graph, so this walks it: every
 * `@Module({ imports })` entry reachable from `AppModule` must be a class, a
 * `forwardRef`, or a (possibly async) dynamic module — never `undefined`.
 */
import 'reflect-metadata';
import { AppModule } from './app.module';

type ModuleRef = (new (...args: unknown[]) => unknown) & { name: string };
type ImportEntry =
  | ModuleRef
  | { forwardRef: () => ModuleRef }
  | { module: ModuleRef }
  | Promise<{ module: ModuleRef }>
  | undefined;

async function unwrap(entry: ImportEntry): Promise<ModuleRef | undefined> {
  if (!entry) return undefined;
  if (typeof entry === 'function') return entry;
  if (entry instanceof Promise) return (await entry).module;
  if ('forwardRef' in entry) return entry.forwardRef();
  if ('module' in entry) return entry.module;
  return undefined;
}

describe('AppModule import graph', () => {
  it('has no undefined entries in any reachable @Module imports array', async () => {
    const seen = new Set<ModuleRef>();
    const problems: string[] = [];
    const queue: ModuleRef[] = [AppModule as unknown as ModuleRef];
    while (queue.length) {
      const mod = queue.shift()!;
      if (seen.has(mod)) continue;
      seen.add(mod);
      const imports = (Reflect.getMetadata('imports', mod) as ImportEntry[] | undefined) ?? [];
      for (const [index, entry] of imports.entries()) {
        const target = await unwrap(entry);
        if (!target) {
          problems.push(`${mod.name}.imports[${index}] is ${String(entry)}`);
          continue;
        }
        queue.push(target);
      }
    }
    expect(problems).toEqual([]);
    // Sanity: the walk actually covered the graph and did not stop at AppModule.
    expect(seen.size).toBeGreaterThan(20);
  });
});
