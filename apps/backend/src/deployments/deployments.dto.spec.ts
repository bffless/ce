import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateDeploymentDto,
  CreateDeploymentZipDto,
  PrepareBatchUploadDto,
  FinalizeUploadDto,
} from './deployments.dto';

/**
 * Task A3 — plural proxy-rule-set fields (`proxyRuleSetNames` / `proxyRuleSetIds`)
 * must accept string[] (the happy path), a bare string (multer only arrays a
 * multipart field when it repeats >=2 times), and a CSV string (legacy client
 * back-compat). The `NormalizeStringArray()` @Transform below @IsArray()
 * normalizes all three shapes into string[] before validation runs.
 *
 * validate() options mirror the global ValidationPipe in main.ts:
 * { whitelist: true, transform: true, forbidNonWhitelisted: true }.
 * `transform` happens in plainToInstance; whitelist/forbidNonWhitelisted are
 * validate() options.
 */

const VALIDATE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

const UUID_1 = '550e8400-e29b-41d4-a716-446655440000';
const UUID_2 = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

// Minimum required fields for each DTO, so validation failures are scoped to
// the plural proxy-rule-set fields under test.
const baseFor = {
  CreateDeploymentDto: () => ({
    repository: 'owner/repo',
    commitSha: 'abc1234',
  }),
  CreateDeploymentZipDto: () => ({
    repository: 'owner/repo',
    commitSha: 'abc1234',
  }),
  PrepareBatchUploadDto: () => ({
    repository: 'owner/repo',
    commitSha: 'abc1234',
    files: [],
  }),
  FinalizeUploadDto: () => ({
    uploadToken: 'token-123',
  }),
};

type PluralFieldsShape = {
  proxyRuleSetNames?: string[];
  proxyRuleSetIds?: string[];
  proxyRuleSetName?: string;
  proxyRuleSetId?: string;
};

interface DtoCase {
  name: keyof typeof baseFor;
  build: (extra: Record<string, unknown>) => PluralFieldsShape;
}

function makeCase<T extends object>(name: keyof typeof baseFor, ctor: new () => T): DtoCase {
  return {
    name,
    build: (extra: Record<string, unknown>) =>
      plainToInstance(ctor, { ...baseFor[name](), ...extra }) as unknown as PluralFieldsShape,
  };
}

const dtoCases: DtoCase[] = [
  makeCase('CreateDeploymentDto', CreateDeploymentDto),
  makeCase('CreateDeploymentZipDto', CreateDeploymentZipDto),
  makeCase('PrepareBatchUploadDto', PrepareBatchUploadDto),
  makeCase('FinalizeUploadDto', FinalizeUploadDto),
];

const propertiesWithErrors = (errors: { property: string }[]) => errors.map((e) => e.property);

describe.each(dtoCases)('$name plural proxy-rule-set fields', ({ build }) => {
  it('accepts proxyRuleSetNames as a CSV string, transformed to an array', async () => {
    const dto = build({ proxyRuleSetNames: 'a,b' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetNames?: string[] }).proxyRuleSetNames).toEqual([
      'a',
      'b',
    ]);
  });

  it('accepts proxyRuleSetNames as a bare (single) string — the multer single-field case', async () => {
    const dto = build({ proxyRuleSetNames: 'solo' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetNames?: string[] }).proxyRuleSetNames).toEqual([
      'solo',
    ]);
  });

  it('accepts proxyRuleSetNames as a real array, unchanged', async () => {
    const dto = build({ proxyRuleSetNames: ['a', 'b'] });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetNames?: string[] }).proxyRuleSetNames).toEqual([
      'a',
      'b',
    ]);
  });

  it('accepts proxyRuleSetIds as a CSV string of valid UUIDs', async () => {
    const dto = build({ proxyRuleSetIds: `${UUID_1},${UUID_2}` });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetIds?: string[] }).proxyRuleSetIds).toEqual([
      UUID_1,
      UUID_2,
    ]);
  });

  it('accepts proxyRuleSetIds as a real array of valid UUIDs, unchanged', async () => {
    const dto = build({ proxyRuleSetIds: [UUID_1, UUID_2] });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetIds?: string[] }).proxyRuleSetIds).toEqual([
      UUID_1,
      UUID_2,
    ]);
  });

  it('rejects proxyRuleSetIds when a CSV segment is not a UUID', async () => {
    const dto = build({ proxyRuleSetIds: 'not-a-uuid' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(propertiesWithErrors(errors)).toContain('proxyRuleSetIds');
  });

  it('leaves proxyRuleSetNames undefined when absent', async () => {
    const dto = build({});
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetNames?: string[] }).proxyRuleSetNames).toBeUndefined();
  });

  it('normalizes an empty string proxyRuleSetNames to undefined (not [""])', async () => {
    const dto = build({ proxyRuleSetNames: '' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetNames?: string[] }).proxyRuleSetNames).toBeUndefined();
  });

  it('rejects a number for proxyRuleSetNames (helper passes non-string/array through to @IsArray)', async () => {
    const dto = build({ proxyRuleSetNames: 42 });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(propertiesWithErrors(errors)).toContain('proxyRuleSetNames');
  });
});

// Full matrix on a single representative DTO (CreateDeploymentDto), per the
// brief: "Run each of the four DTOs through at least the CSV + array cases."
// This block adds the trimming / whitespace edge cases not repeated above.
describe('CreateDeploymentDto proxy-rule-set full matrix', () => {
  const build = (extra: Record<string, unknown>) =>
    plainToInstance(CreateDeploymentDto, {
      repository: 'owner/repo',
      commitSha: 'abc1234',
      ...extra,
    });

  it('trims whitespace around CSV entries', async () => {
    const dto = build({ proxyRuleSetNames: ' a , b ,c ' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetNames?: string[] }).proxyRuleSetNames).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('drops empty segments from a CSV string with trailing/leading commas', async () => {
    const dto = build({ proxyRuleSetNames: 'a,,b,' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect((dto as unknown as { proxyRuleSetNames?: string[] }).proxyRuleSetNames).toEqual([
      'a',
      'b',
    ]);
  });

  it('does not affect the singular proxyRuleSetName field (still a plain string)', async () => {
    const dto = build({ proxyRuleSetName: 'legacy-single' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect(dto.proxyRuleSetName).toBe('legacy-single');
  });

  it('does not affect the singular proxyRuleSetId field (still validated as a UUID)', async () => {
    const dto = build({ proxyRuleSetId: 'not-a-uuid' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(propertiesWithErrors(errors)).toContain('proxyRuleSetId');
  });
});
