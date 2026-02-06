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
      const mockStatus = { isSetupComplete: false };
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
      expect(service.initialize).toHaveBeenCalledWith(mockDto);
    });
  });
});
