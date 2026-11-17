import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { trustProxy } from './common/client-ip';
import { AllExceptionsFilter, requestId } from './common/http';
import { UPLOADS_URL, UploadsService } from './common/uploads.service';
import { validateEnv } from './config';
import { pinPrismaEngine } from './prisma-engine';

async function bootstrap() {
  pinPrismaEngine();
  const env = validateEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  if (env.NODE_ENV === 'production') app.set('trust proxy', trustProxy);
  app.useBodyParser('json', { limit: '1mb' });
  // cPanel (Passenger) monte l'API sur /api et peut retirer ce préfixe : on le rétablit.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!req.url.startsWith('/api/') && req.url !== '/api') req.url = '/api' + (req.url.startsWith('/') ? '' : '/') + req.url;
    next();
  });
  app.use(compression());
  app.use(requestId, helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }), cookieParser());
  app.enableCors({ origin: env.FRONTEND_URL, credentials: true });
  app.useStaticAssets(app.get(UploadsService).root, { prefix: UPLOADS_URL + '/', maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  Logger.log(`API MizanFlow prête sur http://localhost:${env.PORT}/api/v1`, 'Bootstrap');
}
bootstrap();
