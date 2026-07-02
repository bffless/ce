import { NestFactory } from '@nestjs/core';
import { ValidationPipe, LogLevel } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { createTrafficObserver } from './traffic/traffic-observer.middleware';
import { TrafficEventsService } from './traffic/traffic-events.service';
import { BlocklistService } from './traffic/blocklist.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: (process.env.LOG_LEVEL?.split(',') as LogLevel[]) || ['error', 'warn', 'log'],
    rawBody: true, // Needed for Stripe webhook signature verification
  });

  // Traffic observation + Blocklist enforcement seam (ADR-0003): registered
  // with app.use() so it sits above ALL Nest module middleware and observes
  // every request that reaches the app — including ones ProxyMiddleware
  // short-circuits before a controller. Blocklisted requests are refused
  // here with a bare 403 before any routing (issue #391).
  app.use(createTrafficObserver(app.get(TrafficEventsService), app.get(BlocklistService)));

  // Raise the request body limit above body-parser's 100kb default. Pipeline
  // endpoints (e.g. studio's /api/projects/save) POST large JSON documents that
  // otherwise fail with PayloadTooLargeError -> 500. Re-registering the parsers
  // here keeps the rawBody capture enabled above.
  const bodyLimit = process.env.BODY_LIMIT || '10mb';
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  // Parse cookies (populates req.cookies)
  app.use(cookieParser());

  // Enable CORS
  app.enableCors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:3000', // Allow Swagger UI to send cookies
    ],
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Static Asset Hosting Platform API')
    .setDescription('API for hosting and managing static assets from CI/CD pipelines')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      withCredentials: true, // Enable sending cookies with requests
    },
    customSiteTitle: 'Static Asset Hosting Platform API',
    customfavIcon: '/favicon.ico',
    customCssUrl: undefined,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
