import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { EmailFormHandlerService } from './email-form-handler.service';
import { EmailService } from '../email/email.service';
import { ProxyRule } from '../db/schema/proxy-rules.schema';

// Mock the database module
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
  },
}));

// Mock SuperTokens. The handler must use getSession (never the express verifySession
// middleware, which writes its own 401 on a missing session and never calls back,
// leaving validateSession pending forever - issue #777).
jest.mock('supertokens-node/recipe/session', () => ({ getSession: jest.fn() }));

import { getSession } from 'supertokens-node/recipe/session';
import { db } from '../db/client';

const mockGetSession = getSession as jest.Mock;

/** The handler's documented 401 body for a form that requires auth. */
const UNAUTHORIZED_BODY = {
  success: false,
  error: 'Unauthorized',
  message: 'Authentication required to submit this form',
};

function makeRule(
  overrides: Partial<NonNullable<ProxyRule['emailHandlerConfig']>> = {},
): ProxyRule {
  return {
    id: 'rule-1',
    pathPattern: '/api/contact',
    proxyType: 'email_form_handler',
    emailHandlerConfig: {
      destinationEmail: 'owner@example.com',
      subject: 'Contact form',
      requireAuth: true,
      ...overrides,
    },
  } as unknown as ProxyRule;
}

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://site.example.com' },
    body: { name: 'Ada', message: 'hello' },
    ip: '203.0.113.7',
    socket: { remoteAddress: '203.0.113.7' },
    ...overrides,
  } as unknown as Request;
}

function makeResponse(): Response & { headersSent: boolean } {
  const res: any = {
    headersSent: false,
    status: jest.fn(),
    json: jest.fn(),
    redirect: jest.fn(),
    setHeader: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockImplementation(() => {
    res.headersSent = true;
    return res;
  });
  return res;
}

function mockUserLookup(rows: Array<{ id: string; email: string | null }>): void {
  (db.select as jest.Mock).mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

describe('EmailFormHandlerService', () => {
  let service: EmailFormHandlerService;
  let emailService: { isConfigured: jest.Mock; sendEmail: jest.Mock };
  let setIntervalSpy: jest.SpyInstance;

  beforeEach(async () => {
    // The constructor schedules a rate-limit cache sweep; keep it off the event loop.
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockReturnValue(0 as unknown as NodeJS.Timeout);

    emailService = {
      isConfigured: jest.fn().mockReturnValue(true),
      sendEmail: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailFormHandlerService, { provide: EmailService, useValue: emailService }],
    }).compile();

    service = module.get(EmailFormHandlerService);
    mockGetSession.mockReset();
    (db.select as jest.Mock).mockReset();
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
  });

  describe('handleSubmission with requireAuth', () => {
    it('answers a missing session with the handler 401 body and stops processing', async () => {
      mockGetSession.mockResolvedValue(undefined);
      const rateLimitSpy = jest.spyOn(service as any, 'isRateLimited');
      const req = makeRequest();
      const res = makeResponse();

      // Would hang (and time the test out) with the old verifySession() wrapper.
      await expect(service.handleSubmission(req, res, makeRule())).resolves.toBeUndefined();

      expect(mockGetSession).toHaveBeenCalledWith(req, res, { sessionRequired: false });
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ ...UNAUTHORIZED_BODY, reason: 'unauthorised' });
      expect(rateLimitSpy).not.toHaveBeenCalled();
      expect(emailService.isConfigured).not.toHaveBeenCalled();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      expect(db.select).not.toHaveBeenCalled();
    });

    it('answers an expired access token with the handler 401 body and reason "try refresh token"', async () => {
      mockGetSession.mockRejectedValue({ type: 'TRY_REFRESH_TOKEN', message: 'try refresh token' });
      const res = makeResponse();

      await service.handleSubmission(makeRequest(), res, makeRule());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ ...UNAUTHORIZED_BODY, reason: 'try refresh token' });
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('answers any other getSession rejection with the handler 401 body and reason "unauthorised"', async () => {
      mockGetSession.mockRejectedValue(new Error('token theft detected'));
      const res = makeResponse();

      await service.handleSubmission(makeRequest(), res, makeRule());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ ...UNAUTHORIZED_BODY, reason: 'unauthorised' });
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('does not write a second response when something upstream already answered', async () => {
      mockGetSession.mockResolvedValue(undefined);
      const res = makeResponse();
      res.headersSent = true;

      await expect(
        service.handleSubmission(makeRequest(), res, makeRule()),
      ).resolves.toBeUndefined();

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('proceeds with the submission for a valid session', async () => {
      const session = { getUserId: () => 'user-123', getHandle: () => 'session-handle' };
      mockGetSession.mockResolvedValue(session);
      mockUserLookup([{ id: 'user-123', email: 'ada@example.com' }]);
      const req = makeRequest();
      const res = makeResponse();

      await service.handleSubmission(req, res, makeRule());

      expect((req as Request & { session?: unknown }).session).toBe(session);
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      const sent = emailService.sendEmail.mock.calls[0][0];
      expect(sent.to).toBe('owner@example.com');
      expect(sent.subject).toBe('Contact form');
      expect(sent.text).toContain('ada@example.com');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Form submitted successfully',
      });
    });

    it('rejects a session whose user no longer exists', async () => {
      mockGetSession.mockResolvedValue({ getUserId: () => 'gone', getHandle: () => 'h' });
      mockUserLookup([]);
      const res = makeResponse();

      await service.handleSubmission(makeRequest(), res, makeRule());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Unauthorized',
        message: 'User not found',
      });
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('handleSubmission without requireAuth', () => {
    it('never consults the session and sends the email', async () => {
      const res = makeResponse();

      await service.handleSubmission(makeRequest(), res, makeRule({ requireAuth: false }));

      expect(mockGetSession).not.toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
