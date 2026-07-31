import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PreflightRequestDto } from './app-catalog.dtos';

/**
 * `subdomain` is the install-time override for the manifest's
 * `install.domain.subdomain` default (live-tester feedback: the manifest
 * default must not be forced on the operator). This DTO only enforces
 * DNS-label shape — reserved-name enforcement happens in
 * `AppPreflightService` (see `app-preflight.service.spec.ts`), since it needs
 * the manifest to know what's reserved and whether a domain applies at all.
 *
 * validate() options mirror the global ValidationPipe in main.ts:
 * { whitelist: true, transform: true, forbidNonWhitelisted: true }.
 */
const VALIDATE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function build(extra: Record<string, unknown>): PreflightRequestDto {
  return plainToInstance(PreflightRequestDto, {
    projectId: '550e8400-e29b-41d4-a716-446655440000',
    ...extra,
  });
}

describe('PreflightRequestDto.subdomain', () => {
  it('is optional — absent is valid', async () => {
    const dto = build({});
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
  });

  it('accepts a valid DNS label', async () => {
    const dto = build({ subdomain: 'my-app' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
    expect(dto.subdomain).toBe('my-app');
  });

  it('accepts a single-character label', async () => {
    const dto = build({ subdomain: 'a' });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
  });

  it.each([
    ['uppercase letters', 'MyApp'],
    ['a leading hyphen', '-myapp'],
    ['a trailing hyphen', 'myapp-'],
    ['an underscore', 'my_app'],
    ['a dot', 'my.app'],
    ['a space', 'my app'],
    ['empty string', ''],
  ])('rejects a label with %s ("%s")', async (_label, value) => {
    const dto = build({ subdomain: value });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors.some((e) => e.property === 'subdomain')).toBe(true);
  });

  it('rejects a label longer than 63 characters (the DNS label cap)', async () => {
    const dto = build({ subdomain: 'a'.repeat(64) });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors.some((e) => e.property === 'subdomain')).toBe(true);
  });

  it('accepts a label exactly at the 63-character cap', async () => {
    const dto = build({ subdomain: 'a'.repeat(63) });
    const errors = await validate(dto, VALIDATE_OPTIONS);
    expect(errors).toEqual([]);
  });
});
