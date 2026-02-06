import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHealth: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return health status', () => {
      const mockHealth = {
        status: 'ok',
        message: 'Static Asset Hosting Platform API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        cache: {
          type: 'memory',
          connected: true,
        },
      };

      jest.spyOn(service, 'getHealth').mockReturnValue(mockHealth);

      const result = controller.getHealth();

      expect(result).toEqual(mockHealth);
      expect(service.getHealth).toHaveBeenCalled();
    });
  });
});
