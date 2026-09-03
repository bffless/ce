import { AuthRequiredValidator } from './auth-required.validator';
import { ValidatorRegistry } from '../validator.registry';
import { PipelineContext, PipelineUser } from '../pipeline-context.interface';
import { ValidatorConfig } from '../../types';
import { AuthenticationRequiredError, AuthorizationError, ConfigurationError } from '../../errors';

function makeValidator() {
  const registry = { register: jest.fn() } as unknown as ValidatorRegistry;
  return new AuthRequiredValidator(registry);
}

function ctx(user?: PipelineUser, projectId = 'proj-1'): PipelineContext {
  return {
    request: {} as never,
    user,
    stepOutputs: {},
    projectId,
    pipelineId: 'pipe-1',
    metadata: { path: '/x', method: 'POST', headers: {}, query: {}, body: {} },
  };
}

const cfg = (config: Record<string, unknown>): ValidatorConfig =>
  ({ type: 'auth_required', config }) as ValidatorConfig;

describe('AuthRequiredValidator', () => {
  describe('validateConfig', () => {
    it('accepts requiredScopes of namespace:verb strings', () => {
      expect(() =>
        makeValidator().validateConfig({ requiredScopes: ['workflow:run', 'a-b:c_d'] }),
      ).not.toThrow();
    });
    it('rejects a non-array and a badly shaped scope', () => {
      expect(() => makeValidator().validateConfig({ requiredScopes: 'x' as never })).toThrow(
        ConfigurationError,
      );
      expect(() => makeValidator().validateConfig({ requiredScopes: ['Bad Scope'] })).toThrow(
        ConfigurationError,
      );
      expect(() => makeValidator().validateConfig({ requiredScopes: ['noverb'] })).toThrow(
        ConfigurationError,
      );
    });
  });

  describe('validate', () => {
    it('still requires a user', async () => {
      await expect(makeValidator().validate(ctx(undefined), cfg({}))).rejects.toThrow(
        AuthenticationRequiredError,
      );
    });

    it('never scope-checks a session, a custom-domain cookie, an API key, or a pre-tokens caller', async () => {
      const v = makeValidator();
      const config = cfg({ requiredScopes: ['workflow:run'] });
      await expect(
        v.validate(ctx({ id: 'u', credential: 'session' }), config),
      ).resolves.toBeUndefined();
      await expect(
        v.validate(ctx({ id: 'u', credential: 'custom_domain' }), config),
      ).resolves.toBeUndefined();
      await expect(
        v.validate(ctx({ id: 'u', credential: 'api_key' }), config),
      ).resolves.toBeUndefined();
      await expect(v.validate(ctx({ id: 'u' }), config)).resolves.toBeUndefined();
    });

    it('refuses a token missing a required scope, naming it', async () => {
      const user: PipelineUser = {
        id: 'u',
        credential: 'app_token',
        scopes: ['workflow:read'],
        tokenProjectId: 'proj-1',
      };
      const err = await makeValidator()
        .validate(ctx(user), cfg({ requiredScopes: ['workflow:run', 'workflow:read'] }))
        .catch((e) => e);
      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.message).toBe('insufficient_scope: missing workflow:run');
      expect(err.details).toEqual({ code: 'insufficient_scope', missingScopes: ['workflow:run'] });
      expect(err.getStatus()).toBe(403);
    });

    it('admits a token carrying every required scope, and any token when none is required', async () => {
      const v = makeValidator();
      const user: PipelineUser = {
        id: 'u',
        credential: 'app_token',
        scopes: ['workflow:read', 'workflow:run'],
        tokenProjectId: 'proj-1',
      };
      await expect(
        v.validate(ctx(user), cfg({ requiredScopes: ['workflow:run'] })),
      ).resolves.toBeUndefined();
      await expect(
        v.validate(ctx({ ...user, scopes: [] }), cfg({ requiredScopes: [] })),
      ).resolves.toBeUndefined();
      await expect(v.validate(ctx({ ...user, scopes: [] }), cfg({}))).resolves.toBeUndefined();
    });

    it('refuses a token bound to another project', async () => {
      const user: PipelineUser = {
        id: 'u',
        credential: 'app_token',
        scopes: ['workflow:run'],
        tokenProjectId: 'proj-2',
      };
      const err = await makeValidator()
        .validate(ctx(user, 'proj-1'), cfg({}))
        .catch((e) => e);
      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.details).toEqual({ code: 'token_project_mismatch' });
    });

    it('keeps the role check for tokens too (a token never elevates)', async () => {
      const user: PipelineUser = {
        id: 'u',
        role: 'user',
        credential: 'app_token',
        scopes: ['x:y'],
      };
      await expect(makeValidator().validate(ctx(user), cfg({ roles: ['admin'] }))).rejects.toThrow(
        AuthorizationError,
      );
    });
  });
});
