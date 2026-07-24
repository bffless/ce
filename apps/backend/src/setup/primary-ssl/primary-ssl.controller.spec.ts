import { PrimarySslController } from './primary-ssl.controller';

const makeSvc = () => ({
  getStatus: jest.fn().mockResolvedValue({ domain: 'a.com' }),
  preflight: jest.fn().mockResolvedValue({ ok: true, checks: [] }),
  stagePaste: jest.fn().mockReturnValue({ sans: [], wildcardCovered: true }),
  issueLetsEncrypt: jest.fn().mockResolvedValue({ issued: true, sans: [] }),
  apply: jest.fn().mockResolvedValue({ applied: true, kind: 'cert-only' }),
  confirm: jest.fn(),
  rollback: jest.fn(),
  discardStaged: jest.fn().mockReturnValue({ discarded: true }),
});

describe('PrimarySslController', () => {
  it('delegates each route to the service', async () => {
    const svc = makeSvc();
    const c = new PrimarySslController(svc as any);
    expect(await c.status()).toEqual({ domain: 'a.com' });
    await c.preflight();
    c.certificate({ certificatePem: 'C', privateKeyPem: 'K', servingMode: 'none' } as any);
    await c.letsencrypt();
    await c.apply({ proxyMode: 'none', sslMode: 'paste' } as any);
    c.confirm();
    c.rollback();
    expect(svc.preflight).toHaveBeenCalled();
    expect(svc.stagePaste).toHaveBeenCalled();
    expect(svc.issueLetsEncrypt).toHaveBeenCalled();
    expect(svc.apply).toHaveBeenCalled();
    expect(svc.confirm).toHaveBeenCalled();
    expect(svc.rollback).toHaveBeenCalled();
  });

  it('DELETE staged delegates to discardStaged', () => {
    const svc = makeSvc();
    const c = new PrimarySslController(svc as any);
    expect(c.discardStaged()).toEqual({ discarded: true });
    expect(svc.discardStaged).toHaveBeenCalled();
  });
});
