import 'express';

declare module 'express' {
  interface Request {
    tenantId?: string;
  }
}
