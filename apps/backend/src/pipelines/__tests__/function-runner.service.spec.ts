import { FunctionRunnerService } from '../function-runner.service';

describe('FunctionRunnerService', () => {
  let service: FunctionRunnerService;

  beforeEach(() => {
    service = new FunctionRunnerService();
  });

  describe('validateCode', () => {
    it('should accept valid handler function with destructured params', () => {
      const result = service.validateCode('function handler({ input }) { return input.name; }');
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should accept valid handler function with data param (backward compat)', () => {
      const result = service.validateCode('function handler(data) { return data.input.name; }');
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject code with eval()', () => {
      const result = service.validateCode('function handler({ input }) { return eval("1+1"); }');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prohibited pattern detected: \\beval\\s*\\(');
    });

    it('should reject code with new Function()', () => {
      const result = service.validateCode('function handler({ input }) { return new Function("return 1")(); }');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prohibited pattern detected: \\bnew\\s+Function\\s*\\(');
    });

    it('should reject code with require()', () => {
      const result = service.validateCode('function handler({ input }) { const fs = require("fs"); return fs; }');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prohibited pattern detected: \\brequire\\s*\\(');
    });

    it('should reject code with process access', () => {
      const result = service.validateCode('function handler({ input }) { return process.env.SECRET; }');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prohibited pattern detected: \\bprocess\\s*\\.');
    });

    it('should reject code with global access', () => {
      const result = service.validateCode('function handler({ input }) { return global.process; }');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prohibited pattern detected: \\bglobal\\s*\\.');
    });

    it('should reject code with __proto__ access', () => {
      const result = service.validateCode('function handler({ input }) { return {}.__proto__; }');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prohibited pattern detected: \\.__proto__');
    });

    it('should reject code with syntax errors', () => {
      const result = service.validateCode('function handler({ input }) { return {');
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Syntax error');
    });
  });

  describe('run', () => {
    describe('handler function pattern', () => {
      it('should require a handler function', async () => {
        const result = await service.run('const x = 1;', {});
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('handler');
      });

      it('should execute handler function with destructured params', async () => {
        const result = await service.run(
          'function handler({ input }) { return input.name; }',
          { input: { name: 'test' } },
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('test');
      });

      it('should execute handler function with data param (backward compat)', async () => {
        const result = await service.run(
          'function handler(data) { return data.input.name; }',
          { input: { name: 'test' } },
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('test');
      });
    });

    describe('basic execution', () => {
      it('should execute simple return statement', async () => {
        const result = await service.run(
          'function handler({ input }) { return 42; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe(42);
      });

      it('should have access to input', async () => {
        const result = await service.run(
          'function handler({ input }) { return input.name; }',
          { input: { name: 'test' } },
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('test');
      });

      it('should have access to user', async () => {
        const result = await service.run(
          'function handler({ user }) { return user.email; }',
          {
            input: {},
            user: { id: '1', email: 'test@example.com', role: 'admin' },
          },
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('test@example.com');
      });

      it('should have access to steps', async () => {
        const result = await service.run(
          'function handler({ steps }) { return steps.form.email; }',
          {
            input: {},
            steps: { form: { email: 'test@example.com' } },
          },
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('test@example.com');
      });

      it('should have access to request', async () => {
        const result = await service.run(
          'function handler({ request }) { return request.method; }',
          {
            input: {},
            request: { method: 'POST', path: '/api/test', query: {} },
          },
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('POST');
      });
    });

    describe('data transformations', () => {
      it('should transform objects', async () => {
        const result = await service.run(
          'function handler({ input }) { return { ...input, transformed: true }; }',
          { input: { name: 'test' } },
        );
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ name: 'test', transformed: true });
      });

      it('should filter arrays', async () => {
        const result = await service.run(
          'function handler({ input }) { return input.items.filter(item => item.active); }',
          {
            input: {
              items: [
                { id: 1, active: true },
                { id: 2, active: false },
                { id: 3, active: true },
              ],
            },
          },
        );
        expect(result.success).toBe(true);
        expect(result.output).toEqual([
          { id: 1, active: true },
          { id: 3, active: true },
        ]);
      });

      it('should map arrays', async () => {
        const result = await service.run(
          'function handler({ input }) { return input.items.map(item => item.id); }',
          { input: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] } },
        );
        expect(result.success).toBe(true);
        expect(result.output).toEqual([1, 2, 3]);
      });

      it('should support reduce operations', async () => {
        const result = await service.run(
          'function handler({ input }) { return input.numbers.reduce((sum, n) => sum + n, 0); }',
          { input: { numbers: [1, 2, 3, 4, 5] } },
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe(15);
      });
    });

    describe('built-in objects', () => {
      it('should have access to Math', async () => {
        const result = await service.run(
          'function handler({ input }) { return Math.max(1, 2, 3); }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe(3);
      });

      it('should have access to Date', async () => {
        const result = await service.run(
          'function handler({ input }) { return typeof new Date().getTime(); }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('number');
      });

      it('should have access to JSON', async () => {
        const result = await service.run(
          'function handler({ input }) { return JSON.parse(JSON.stringify({ a: 1 })); }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ a: 1 });
      });

      it('should have access to Array methods', async () => {
        const result = await service.run(
          'function handler({ input }) { return Array.isArray([1, 2, 3]); }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe(true);
      });

      it('should have access to Object methods', async () => {
        const result = await service.run(
          'function handler({ input }) { return Object.keys({ a: 1, b: 2 }); }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toEqual(['a', 'b']);
      });
    });

    describe('security', () => {
      it('should not have access to require', async () => {
        const result = await service.run(
          'function handler({ input }) { return typeof require; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('undefined');
      });

      it('should not have access to process', async () => {
        const result = await service.run(
          'function handler({ input }) { return typeof process; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('undefined');
      });

      it('should not have access to global', async () => {
        const result = await service.run(
          'function handler({ input }) { return typeof global; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('undefined');
      });

      it('should not be able to modify original data (copied)', async () => {
        const originalData = { input: { name: 'original' } };
        // Even if modification succeeds in sandbox, original data is unchanged
        // because we pass a structuredClone
        const result = await service.run(
          `function handler({ input }) {
            input.name = 'modified';
            return input.name;
          }`,
          originalData,
        );
        expect(result.success).toBe(true);
        // The original data should be unchanged
        expect(originalData.input.name).toBe('original');
      });
    });

    describe('timeout', () => {
      it('should timeout on infinite loop', async () => {
        const result = await service.run(
          'function handler({ input }) { while(true) {} }',
          {},
          { timeout: 1000 },
        );
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('TIMEOUT');
      }, 10000);

      it('should respect custom timeout', async () => {
        const start = Date.now();
        const result = await service.run(
          'function handler({ input }) { while(true) {} }',
          {},
          { timeout: 1500 },
        );
        const elapsed = Date.now() - start;
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('TIMEOUT');
        // Allow some tolerance for execution
        expect(elapsed).toBeGreaterThanOrEqual(1400);
        expect(elapsed).toBeLessThan(3000);
      }, 10000);
    });

    describe('console logging', () => {
      it('should capture console.log output', async () => {
        const result = await service.run(
          'function handler({ input }) { console.log("test message"); return 1; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.logs).toContain('test message');
      });

      it('should capture console.warn output', async () => {
        const result = await service.run(
          'function handler({ input }) { console.warn("warning"); return 1; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.logs).toContain('[WARN] warning');
      });

      it('should capture console.error output', async () => {
        const result = await service.run(
          'function handler({ input }) { console.error("error"); return 1; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.logs).toContain('[ERROR] error');
      });

      it('should limit log entries to 100', async () => {
        const result = await service.run(
          'function handler({ input }) { for(let i = 0; i < 150; i++) { console.log(i); } return 1; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.logs?.length).toBeLessThanOrEqual(100);
      });
    });

    describe('async operations', () => {
      it('should support async handler function', async () => {
        const result = await service.run(
          'async function handler({ input }) { return await Promise.resolve(42); }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe(42);
      });

      it('should handle Promise chains', async () => {
        const result = await service.run(
          'function handler({ input }) { return Promise.resolve(1).then(x => x + 1).then(x => x * 2); }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe(4);
      });
    });

    describe('error handling', () => {
      it('should catch and report runtime errors', async () => {
        const result = await service.run(
          'function handler({ input }) { return nonExistentVariable; }',
          {},
        );
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('EXECUTION_ERROR');
        expect(result.error?.message).toContain('nonExistentVariable');
      });

      it('should catch and report type errors', async () => {
        const result = await service.run(
          'function handler({ input }) { return input.foo.bar; }',
          { input: {} },
        );
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('EXECUTION_ERROR');
      });
    });

    describe('execution time tracking', () => {
      it('should track execution time', async () => {
        const result = await service.run(
          'function handler({ input }) { return 1; }',
          {},
        );
        expect(result.success).toBe(true);
        expect(result.executionTime).toBeDefined();
        expect(result.executionTime).toBeGreaterThanOrEqual(0);
      });
    });

    describe('utils crypto helpers', () => {
      it('exposes utils on the handler argument and as a global', async () => {
        const viaArg = await service.run(
          'function handler({ utils }) { return typeof utils.sign; }',
          {},
        );
        expect(viaArg.success).toBe(true);
        expect(viaArg.output).toBe('function');

        const viaGlobal = await service.run(
          'function handler() { return typeof utils.sign; }',
          {},
        );
        expect(viaGlobal.success).toBe(true);
        expect(viaGlobal.output).toBe('function');
      });

      it('sha256 returns a stable lowercase hex digest', async () => {
        const result = await service.run(
          'function handler({ utils }) { return utils.sha256("hello"); }',
          {},
        );
        expect(result.success).toBe(true);
        // Known SHA-256 of "hello"
        expect(result.output).toBe(
          '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        );
      });

      it('sign + verify round-trips and rejects tampering', async () => {
        const result = await service.run(
          `function handler({ utils }) {
            var sig = utils.sign('folder:abc|user:42');
            return {
              ok: utils.verify('folder:abc|user:42', sig),
              tampered: utils.verify('folder:abc|user:99', sig),
              wrongSig: utils.verify('folder:abc|user:42', 'deadbeef'),
            };
          }`,
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toEqual({
          ok: true,
          tampered: false,
          wrongSig: false,
        });
      });

      it('the same message always signs to the same value (stable key)', async () => {
        const a = await service.run(
          'function handler({ utils }) { return utils.sign("x"); }',
          {},
        );
        const b = await service.run(
          'function handler({ utils }) { return utils.sign("x"); }',
          {},
        );
        expect(a.output).toBe(b.output);
        expect(typeof a.output).toBe('string');
      });

      it('randomToken returns distinct hex tokens of the requested length', async () => {
        const result = await service.run(
          `function handler({ utils }) {
            var a = utils.randomToken(16);
            var b = utils.randomToken(16);
            return { len: a.length, distinct: a !== b, hex: /^[0-9a-f]+$/.test(a) };
          }`,
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ len: 32, distinct: true, hex: true });
      });

      it('base64url encode/decode round-trips without padding', async () => {
        const result = await service.run(
          `function handler({ utils }) {
            var enc = utils.base64urlEncode('{"f":"abc","u":"42"}');
            return { dec: utils.base64urlDecode(enc), padless: enc.indexOf('=') === -1 };
          }`,
          {},
        );
        expect(result.success).toBe(true);
        expect(result.output).toEqual({
          dec: '{"f":"abc","u":"42"}',
          padless: true,
        });
      });
    });
  });
});
