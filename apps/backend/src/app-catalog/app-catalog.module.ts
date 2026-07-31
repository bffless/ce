import { Module } from '@nestjs/common';
import { AppCatalogController } from './app-catalog.controller';
import { AppCatalogService } from './app-catalog.service';
import { AppsRegistryService } from './apps-registry.service';
import { AppBundleService } from './app-bundle.service';

@Module({
  imports: [],
  controllers: [AppCatalogController],
  providers: [AppCatalogService, AppsRegistryService, AppBundleService],
})
export class AppCatalogModule {}
