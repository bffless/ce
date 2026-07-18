import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateDomainDto } from './create-domain.dto';
import { CreateRedirectDto } from './create-redirect.dto';
import { SOURCE_DOMAIN_PATTERN, HOSTNAME_PATTERN } from './domain-patterns';

describe('domain patterns', () => {
  describe('SOURCE_DOMAIN_PATTERN', () => {
    it.each([
      'example.com',
      'docs.example.com',
      'localhost',
      'a-b.example.com',
      '*.example.com',
      '*.docs.example.com',
    ])('accepts %s', (domain) => {
      expect(SOURCE_DOMAIN_PATTERN.test(domain)).toBe(true);
    });

    it.each([
      '*',
      '*example.com',
      'foo.*.example.com',
      '*.*.example.com',
      'Example.com',
      '-example.com',
      'example-.com',
      'exam ple.com',
      '',
    ])('rejects %s', (domain) => {
      expect(SOURCE_DOMAIN_PATTERN.test(domain)).toBe(false);
    });
  });

  describe('HOSTNAME_PATTERN', () => {
    it('accepts a plain hostname', () => {
      expect(HOSTNAME_PATTERN.test('example.com')).toBe(true);
    });

    it('rejects a wildcard, which is meaningless as a redirect target', () => {
      expect(HOSTNAME_PATTERN.test('*.example.com')).toBe(false);
    });
  });

  const errorsFor = async (dto: object, property: string) => {
    const errors = await validate(dto as never);
    return errors.filter((e) => e.property === property);
  };

  describe('CreateDomainDto', () => {
    const base = {
      domainType: 'redirect' as const,
      redirectTarget: 'bffless.dev',
      redirectType: '301' as const,
    };

    it('accepts a wildcard source domain for a redirect', async () => {
      const dto = plainToInstance(CreateDomainDto, { ...base, domain: '*.bffless.com' });
      expect(await errorsFor(dto, 'domain')).toHaveLength(0);
    });

    it('accepts a plain source domain for a redirect', async () => {
      const dto = plainToInstance(CreateDomainDto, { ...base, domain: 'bffless.com' });
      expect(await errorsFor(dto, 'domain')).toHaveLength(0);
    });

    it('rejects a bare asterisk source domain', async () => {
      const dto = plainToInstance(CreateDomainDto, { ...base, domain: '*' });
      expect(await errorsFor(dto, 'domain')).not.toHaveLength(0);
    });

    it('rejects a wildcard redirect target', async () => {
      const dto = plainToInstance(CreateDomainDto, {
        ...base,
        domain: 'bffless.com',
        redirectTarget: '*.bffless.dev',
      });
      expect(await errorsFor(dto, 'redirectTarget')).not.toHaveLength(0);
    });
  });

  describe('CreateRedirectDto', () => {
    it('accepts a wildcard source domain', async () => {
      const dto = plainToInstance(CreateRedirectDto, {
        sourceDomain: '*.bffless.com',
        redirectType: '301',
      });
      expect(await errorsFor(dto, 'sourceDomain')).toHaveLength(0);
    });
  });
});
