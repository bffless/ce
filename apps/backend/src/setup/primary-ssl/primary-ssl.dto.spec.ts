import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrimarySslApplyDto, PrimarySslPasteDto } from './primary-ssl.dto';

describe('PrimarySslApplyDto', () => {
  it('rejects an unknown sslMode', () => {
    const dto = plainToInstance(PrimarySslApplyDto, { proxyMode: 'none', sslMode: 'bogus' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
  it('accepts a valid serving config', () => {
    const dto = plainToInstance(PrimarySslApplyDto, {
      proxyMode: 'proxy',
      sslMode: 'selfsigned',
      port80: 'redirect',
    });
    expect(validateSync(dto)).toHaveLength(0);
  });
});

describe('PrimarySslPasteDto', () => {
  it('requires cert + key', () => {
    const dto = plainToInstance(PrimarySslPasteDto, { certificatePem: '', privateKeyPem: '' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
