import { Test, TestingModule } from '@nestjs/testing';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { AuthService } from '../auth/auth.service';

describe('SetupController', () => {
  let controller: SetupController;
  let service: SetupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [
        {
          provide: SetupService,
          useValue: {
            getSetupStatus: jest.fn(),
            initialize: jest.fn(),
            configureStorage: jest.fn(),
            updateStorageCredentials: jest.fn(),
            testStorageConnection: jest.fn(),
            completeSetup: jest.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            getUserById: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<SetupController>(SetupController);
    service = module.get<SetupService>(SetupService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStatus', () => {
    it('should return setup status', async () => {
      const mockStatus = { isSetupComplete: false, bootstrapMode: false, claimRequired: false };
      jest.spyOn(service, 'getSetupStatus').mockResolvedValue(mockStatus);

      const result = await controller.getStatus();

      expect(result).toEqual(mockStatus);
      expect(service.getSetupStatus).toHaveBeenCalled();
    });
  });

  describe('initialize', () => {
    it('should initialize the system', async () => {
      const mockDto = {
        email: 'admin@example.com',
        password: 'SecurePass123!',
        username: 'admin',
      };
      const mockResult = { success: true, message: 'System initialized' };

      jest.spyOn(service, 'initialize').mockResolvedValue(mockResult as any);

      const result = await controller.initialize(mockDto);

      expect(result).toEqual(mockResult);
      // m5: initialize() now also forwards the client IP via extractClientIp();
      // the test doesn't pass a mock request, so it's undefined here.
      expect(service.initialize).toHaveBeenCalledWith(mockDto, undefined);
    });

    it('forwards the X-Forwarded-For-derived IP, not the raw socket peer (req.ip)', async () => {
      // Only nginx ever connects directly to the backend (no exposed ports),
      // so req.ip/req.socket.remoteAddress is always nginx's own address —
      // using it for rate limiting would collapse every client into one
      // bucket. extractClientIp() must be used instead, which reads the
      // client IP nginx forwards in X-Forwarded-For.
      const mockDto = {
        email: 'admin@example.com',
        password: 'SecurePass123!',
        username: 'admin',
      };
      const mockResult = { success: true, message: 'System initialized' };
      jest.spyOn(service, 'initialize').mockResolvedValue(mockResult as any);

      const mockReq = {
        headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.5' },
        ip: '10.0.0.5',
        socket: { remoteAddress: '10.0.0.5' },
      };

      await controller.initialize(mockDto, mockReq as any);

      expect(service.initialize).toHaveBeenCalledWith(mockDto, '203.0.113.7');
    });
  });

  describe('getReady', () => {
    it('returns ready with wide-open CORS and no-store caching', () => {
      const res = { setHeader: jest.fn() };

      const result = controller.getReady(res as any);

      expect(result).toEqual({ ready: true });
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });
});
