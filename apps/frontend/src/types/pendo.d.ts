interface PendoVisitor {
  id: string;
  email?: string;
  role?: string;
}

interface PendoAccount {
  id: string;
  accountName?: string;
}

interface Pendo {
  initialize: (config: { visitor: PendoVisitor; account: PendoAccount }) => void;
  identify: (visitor: PendoVisitor, account?: PendoAccount) => void;
  track: (event: string, properties?: Record<string, unknown>) => void;
  _q?: unknown[];
}

declare global {
  interface Window {
    pendo?: Pendo;
  }
}

export {};
