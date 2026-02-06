import { NestFactory } from '@nestjs/core';
import { ValidationPipe, LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: (process.env.LOG_LEVEL?.split(',') as LogLevel[]) || ['error', 'warn', 'log'],
  });

  // Security headers (production only)
  // In local dev, helmet's CSP causes issues with iframe previews due to port handling
  const isProduction = process.env.NODE_ENV === 'production';
  const frontendUrl = process.env.FRONTEND_URL;
  const adminDomain = process.env.ADMIN_DOMAIN;

  // Skip helmet for localhost (CSP frame-ancestors doesn't work with ports)
  const isLocalDev = frontendUrl?.includes('localhost') || frontendUrl?.includes('127.0.0.1');

  if ((isProduction || frontendUrl || adminDomain) && !isLocalDev) {
    // Build frame ancestors for CSP (allows preview iframes)
    const frameAncestors: string[] = ["'self'"];
    if (frontendUrl) {
      frameAncestors.push(frontendUrl);
    }
    if (adminDomain) {
      // Support both http and https for the admin domain
      if (!adminDomain.startsWith('http')) {
        frameAncestors.push(`https://${adminDomain}`, `http://${adminDomain}`);
      } else {
        frameAncestors.push(adminDomain);
      }
    }

    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Swagger UI needs these
            styleSrc: ["'self'", "'unsafe-inline'"], // Swagger UI uses inline styles
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameAncestors,
          },
        },
        // Disable X-Frame-Options since we're using CSP frame-ancestors
        frameguard: false,
      }),
    );

    // Remove CSP for public routes - hosted sites should control their own security policy.
    // Other Helmet headers (HSTS, X-Content-Type-Options, etc.) are kept.
    // Nginx still sets frame-ancestors CSP for wildcard subdomain iframing.
    app.use('/public', (req, res, next) => {
      res.removeHeader('Content-Security-Policy');
      next();
    });
  }

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
