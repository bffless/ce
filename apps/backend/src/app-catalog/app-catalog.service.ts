import { Injectable } from '@nestjs/common';

@Injectable()
export class AppCatalogService {
  async listCatalog(): Promise<unknown[]> {
    return [];
  }
}
