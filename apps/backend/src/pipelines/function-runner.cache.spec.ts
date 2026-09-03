import { FunctionRunnerService, SCRIPT_CACHE_MAX } from './function-runner.service';

describe('FunctionRunnerService — compiled-script cache', () => {
  const code = (n: number) => `function handler(data) { return { n: ${n}, echo: data.request } }`;

  it('compiles the same code once across runs and reuses the Script', async () => {
    const service = new FunctionRunnerService();
    const a = await service.run(code(1), { request: 'a' });
    const b = await service.run(code(1), { request: 'b' });
    expect(a.output).toEqual({ n: 1, echo: 'a' });
    expect(b.output).toEqual({ n: 1, echo: 'b' });
    expect(service.cachedScripts()).toBe(1);
    expect(service.hasCachedScript(code(1))).toBe(true);
    await service.run(code(2), { request: 'c' });
    expect(service.cachedScripts()).toBe(2);
  });

  it('memoises validation, including a failure', () => {
    const service = new FunctionRunnerService();
    const bad = 'function handler() { return eval("1") }';
    expect(service.validateCode(bad).valid).toBe(false);
    expect(service.validateCode(bad)).toBe(service.validateCode(bad));
  });

  it('evicts the least recently inserted entry past the cap', async () => {
    const service = new FunctionRunnerService();
    for (let i = 0; i < SCRIPT_CACHE_MAX + 1; i += 1) await service.run(code(1000 + i), {});
    expect(service.cachedScripts()).toBe(SCRIPT_CACHE_MAX);
    expect(service.hasCachedScript(code(1000))).toBe(false);
    expect(service.hasCachedScript(code(1000 + SCRIPT_CACHE_MAX))).toBe(true);
  });
});
