import { Test, TestingModule } from '@nestjs/testing';
import { SetupService } from './setup.service';

describe('SetupService', () => {
  let service: SetupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SetupService,
          useValue: {
            getSetupStatus: jest.fn(),
            initialize: jest.fn(),
            configureStorage: jest.fn(),
            testStorageConnection: jest.fn(),
            completeSetup: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SetupService>(SetupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSetupStatus', () => {
    it('should return setup status', () => {
      const mockStatus = { isSetupComplete: false };
      jest.spyOn(service, 'getSetupStatus').mockResolvedValue(mockStatus);

      expect(service.getSetupStatus()).resolves.toEqual(mockStatus);
    });
  });

  describe('initialize', () => {
    it('should initialize the system', () => {
      const mockResult = { success: true };
      jest.spyOn(service, 'initialize').mockResolvedValue(mockResult as any);

      expect(service.initialize({} as any)).resolves.toEqual(mockResult);
    });
  });

  describe('configureStorage', () => {
    it('should configure storage', () => {
      const mockResult = { success: true };
      jest.spyOn(service, 'configureStorage').mockResolvedValue(mockResult as any);

      expect(service.configureStorage({} as any)).resolves.toEqual(mockResult);
    });
  });
});
