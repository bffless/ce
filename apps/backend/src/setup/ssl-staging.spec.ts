import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  sslLiveDir,
  sslStagingDir,
  stagingPopulated,
  stagingPartiallyPopulated,
  promoteStagedCertificates,
  discardStagedCertificates,
} from './ssl-staging';

describe('ssl-staging', () => {
  let liveDir: string;

  beforeEach(() => {
    liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    process.env.SSL_CERT_PATH = liveDir;
  });

  afterEach(() => {
    fs.rmSync(liveDir, { recursive: true, force: true });
    delete process.env.SSL_CERT_PATH;
  });

  const stage = (name: string, content = name) => {
    fs.mkdirSync(sslStagingDir(), { recursive: true });
    fs.writeFileSync(path.join(sslStagingDir(), name), content);
  };

  it('resolves the staging dir inside the live dir', () => {
    expect(sslStagingDir()).toBe(path.join(liveDir, 'staging'));
    expect(sslLiveDir()).toBe(liveDir);
  });

  it('stagingPopulated requires BOTH fullchain.pem and privkey.pem', () => {
    expect(stagingPopulated()).toBe(false);
    stage('fullchain.pem');
    expect(stagingPopulated()).toBe(false);
    stage('privkey.pem');
    expect(stagingPopulated()).toBe(true);
  });

  it('stagingPartiallyPopulated is true iff exactly one of the pair is staged (XOR)', () => {
    expect(stagingPartiallyPopulated()).toBe(false); // neither
    stage('fullchain.pem');
    expect(stagingPartiallyPopulated()).toBe(true); // fullchain only
    stage('privkey.pem');
    expect(stagingPartiallyPopulated()).toBe(false); // both — fully populated
  });

  it('stagingPartiallyPopulated is true when only privkey.pem is staged (the other order)', () => {
    stage('privkey.pem');
    expect(stagingPartiallyPopulated()).toBe(true);
  });

  it('promote moves every staged file into the live dir and clears staging', () => {
    stage('fullchain.pem', 'CERT');
    stage('privkey.pem', 'KEY');
    stage('wildcard.example.com.crt', 'WCERT');
    stage('wildcard.example.com.key', 'WKEY');
    const promoted = promoteStagedCertificates();
    expect(promoted.sort()).toEqual([
      'fullchain.pem', 'privkey.pem', 'wildcard.example.com.crt', 'wildcard.example.com.key',
    ]);
    expect(fs.readFileSync(path.join(liveDir, 'fullchain.pem'), 'utf8')).toBe('CERT');
    expect(fs.readFileSync(path.join(liveDir, 'wildcard.example.com.key'), 'utf8')).toBe('WKEY');
    expect(fs.existsSync(sslStagingDir())).toBe(false);
  });

  it('promote overwrites existing live files', () => {
    fs.writeFileSync(path.join(liveDir, 'fullchain.pem'), 'OLD');
    stage('fullchain.pem', 'NEW');
    stage('privkey.pem', 'KEY');
    promoteStagedCertificates();
    expect(fs.readFileSync(path.join(liveDir, 'fullchain.pem'), 'utf8')).toBe('NEW');
  });

  it('promote is a no-op returning [] when staging is absent or not populated', () => {
    expect(promoteStagedCertificates()).toEqual([]);
    stage('fullchain.pem'); // no privkey — not populated
    expect(promoteStagedCertificates()).toEqual([]);
    expect(fs.existsSync(path.join(liveDir, 'fullchain.pem'))).toBe(false);
  });

  it('promote skips leftover dotfile tmp artifacts', () => {
    stage('fullchain.pem', 'CERT');
    stage('privkey.pem', 'KEY');
    stage('.fullchain.pem.123-abcd.tmp', 'JUNK');
    const promoted = promoteStagedCertificates();
    expect(promoted).not.toContain('.fullchain.pem.123-abcd.tmp');
    expect(fs.existsSync(path.join(liveDir, '.fullchain.pem.123-abcd.tmp'))).toBe(false);
  });

  it('discard removes staging and is idempotent', () => {
    stage('fullchain.pem');
    discardStagedCertificates();
    expect(fs.existsSync(sslStagingDir())).toBe(false);
    expect(() => discardStagedCertificates()).not.toThrow();
  });
});
