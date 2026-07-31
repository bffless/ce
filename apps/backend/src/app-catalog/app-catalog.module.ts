import { Module } from '@nestjs/common';
import { AppCatalogController } from './app-catalog.controller';
import { AppCatalogService } from './app-catalog.service';

@Module({
  imports: [],
  controllers: [AppCatalogController],
  providers: [AppCatalogService],
})
export class AppCatalogModule {}
