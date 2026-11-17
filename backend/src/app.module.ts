import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { Public } from './common/decorators';
import { AccessGuard, JwtAuthGuard } from './common/guards';
import { UploadsModule } from './common/uploads.service';
import { validateEnv } from './config';
import { ActivityModule } from './erp/activity.service';
import { DocumentsController } from './erp/documents.controller';
import { DocumentsService } from './erp/documents.service';
import { FinanceController, TreasuryService } from './erp/finance.controller';
import { InsightsController } from './erp/insights.controller';
import { ClientsController, SuppliersController } from './erp/parties.controller';
import { ProductsController } from './erp/products.controller';
import { TeamController } from './erp/team.controller';
import { PrismaModule, PrismaService } from './prisma.service';
import { SuperController } from './super/super.controller';

@Public()
@Controller('health')
class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { data: { status: 'ok', db: 'ok', time: new Date().toISOString() } };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m', algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    UploadsModule,
    ActivityModule,
  ],
  controllers: [
    HealthController, AuthController, SuperController, DocumentsController, ClientsController, SuppliersController,
    ProductsController, FinanceController, InsightsController, TeamController,
  ],
  providers: [
    AuthService, DocumentsService, TreasuryService,
    // Ordre : limitation de débit, authentification, puis entreprise + droits (relus en base).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
