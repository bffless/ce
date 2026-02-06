import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { api } from '@/services/api';
import { EmailSettings } from './EmailSettings';

// Create a fresh store for each story
const createStore = () =>
  configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
  });

// Mock email status - SMTP configured
const mockEmailStatusSmtp = {
  isConfigured: true,
  provider: 'smtp',
  providerName: 'SMTP',
  fromAddress: 'noreply@example.com',
  fromName: 'My App',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'smtp-user',
};

// Mock email status - SendGrid configured
const mockEmailStatusSendGrid = {
  isConfigured: true,
  provider: 'sendgrid',
  providerName: 'SendGrid',
  fromAddress: 'noreply@example.com',
  fromName: 'My App',
  apiKey: 'SG.xxxxxxx...xxx',
};

// Mock email status - Managed Email
const mockEmailStatusManaged = {
  isConfigured: true,
  provider: 'managed',
  providerName: 'Managed Email',
  fromAddress: 'platform@example.com',
  fromName: 'Platform',
};

// Mock email status - Not configured
const mockEmailStatusNotConfigured = {
  isConfigured: false,
};

// Mock providers list
const mockProviders = {
  providers: [
    {
      id: 'smtp',
      name: 'SMTP',
      description: 'Traditional email server',
      implemented: true,
      recommended: false,
      requiresPorts: true,
      warning: 'SMTP ports (25, 465, 587) may be blocked on cloud platforms',
      docsUrl: 'https://nodemailer.com/smtp/',
    },
    {
      id: 'sendgrid',
      name: 'SendGrid',
      description: 'HTTP-based email API',
      implemented: true,
      recommended: true,
      requiresPorts: false,
      docsUrl: 'https://docs.sendgrid.com/',
    },
    {
      id: 'resend',
      name: 'Resend',
      description: 'Modern developer email API',
      implemented: true,
      recommended: false,
      requiresPorts: false,
      docsUrl: 'https://resend.com/docs',
    },
  ],
};

// Mock available options for CE mode
const mockAvailableOptionsCE = {
  storage: {
    managed: false,
    s3: true,
    gcs: true,
    azure: true,
    minio: true,
    local: true,
  },
  cache: {
    lru: true,
    managedRedis: false,
    localRedis: true,
    externalRedis: true,
  },
  email: {
    managed: false,
    smtp: true,
    sendgrid: true,
    resend: true,
    skipAllowed: true,
  },
};

// Mock available options for Platform mode
const mockAvailableOptionsPlatform = {
  storage: {
    managed: true,
    s3: true,
    gcs: false,
    azure: false,
    minio: false,
    local: false,
  },
  cache: {
    lru: true,
    managedRedis: true,
    localRedis: false,
    externalRedis: true,
  },
  email: {
    managed: true,
    smtp: true,
    sendgrid: true,
    resend: true,
    skipAllowed: false,
  },
};

// Mock available options for Platform mode with only managed email
const mockAvailableOptionsPlatformManagedOnly = {
  storage: {
    managed: true,
    s3: false,
    gcs: false,
    azure: false,
    minio: false,
    local: false,
  },
  cache: {
    lru: true,
    managedRedis: true,
    localRedis: false,
    externalRedis: false,
  },
  email: {
    managed: true,
    smtp: false,
    sendgrid: false,
    resend: false,
    skipAllowed: false,
  },
};

const meta: Meta<typeof EmailSettings> = {
  title: 'Settings/EmailSettings',
  component: EmailSettings,
  parameters: {
    layout: 'padded',
    // Force iframe rendering on docs page to avoid MSW conflicts with inline stories
    docs: {
      story: {
        inline: false,
        iframeHeight: 600,
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => {
      const store = createStore();
      return (
        <Provider store={store}>
          <div className="w-full max-w-2xl mx-auto">
            <Story />
          </div>
        </Provider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Default: SMTP configured (CE Mode)
export const Default: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/email', () => HttpResponse.json(mockEmailStatusSmtp)),
        http.get('/api/setup/email/providers', () => HttpResponse.json(mockProviders)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.put('/api/settings/email', () =>
          HttpResponse.json({ success: true, message: 'Email settings updated' })
        ),
        http.post('/api/settings/email/test', () =>
          HttpResponse.json({ success: true, message: 'Connection successful' })
        ),
        http.post('/api/settings/email/send-test', () =>
          HttpResponse.json({ success: true, message: 'Test email sent', messageId: 'msg-123' })
        ),
      ],
    },
  },
};

// SendGrid Configured
export const SendGridConfigured: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/email', () => HttpResponse.json(mockEmailStatusSendGrid)),
        http.get('/api/setup/email/providers', () => HttpResponse.json(mockProviders)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.put('/api/settings/email', () =>
          HttpResponse.json({ success: true, message: 'Email settings updated' })
        ),
        http.post('/api/settings/email/test', () =>
          HttpResponse.json({ success: true, message: 'Connection successful' })
        ),
        http.post('/api/settings/email/send-test', () =>
          HttpResponse.json({ success: true, message: 'Test email sent', messageId: 'msg-123' })
        ),
      ],
    },
  },
};

// Managed Email (Platform Mode)
export const ManagedEmail: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/email', () => HttpResponse.json(mockEmailStatusManaged)),
        http.get('/api/setup/email/providers', () => HttpResponse.json(mockProviders)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsPlatform)),
        http.put('/api/settings/email', () =>
          HttpResponse.json({ success: true, message: 'Email settings updated' })
        ),
        http.post('/api/settings/email/test', () =>
          HttpResponse.json({ success: true, message: 'Connection successful' })
        ),
        http.post('/api/settings/email/send-test', () =>
          HttpResponse.json({ success: true, message: 'Test email sent', messageId: 'msg-123' })
        ),
      ],
    },
  },
};

// Managed Email Only (No BYOB options)
export const ManagedEmailOnly: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/email', () => HttpResponse.json(mockEmailStatusManaged)),
        http.get('/api/setup/email/providers', () => HttpResponse.json(mockProviders)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsPlatformManagedOnly)),
        http.put('/api/settings/email', () =>
          HttpResponse.json({ success: true, message: 'Email settings updated' })
        ),
        http.post('/api/settings/email/test', () =>
          HttpResponse.json({ success: true, message: 'Connection successful' })
        ),
        http.post('/api/settings/email/send-test', () =>
          HttpResponse.json({ success: true, message: 'Test email sent', messageId: 'msg-123' })
        ),
      ],
    },
  },
};

// Not Configured (CE Mode)
export const NotConfigured: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/email', () => HttpResponse.json(mockEmailStatusNotConfigured)),
        http.get('/api/setup/email/providers', () => HttpResponse.json(mockProviders)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.put('/api/settings/email', () =>
          HttpResponse.json({ success: true, message: 'Email settings updated' })
        ),
        http.post('/api/settings/email/test', () =>
          HttpResponse.json({ success: true, message: 'Connection successful' })
        ),
      ],
    },
  },
};

// Not Configured with Managed Email Available (Platform Mode)
export const NotConfiguredPlatform: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/email', () => HttpResponse.json(mockEmailStatusNotConfigured)),
        http.get('/api/setup/email/providers', () => HttpResponse.json(mockProviders)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsPlatform)),
        http.put('/api/settings/email', () =>
          HttpResponse.json({ success: true, message: 'Email settings updated' })
        ),
        http.post('/api/settings/email/test', () =>
          HttpResponse.json({ success: true, message: 'Connection successful' })
        ),
      ],
    },
  },
};

// Connection Test Failed
export const ConnectionTestFailed: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/email', () => HttpResponse.json(mockEmailStatusSmtp)),
        http.get('/api/setup/email/providers', () => HttpResponse.json(mockProviders)),
        http.get('/api/setup/available-options', () => HttpResponse.json(mockAvailableOptionsCE)),
        http.put('/api/settings/email', () =>
          HttpResponse.json({ success: true, message: 'Email settings updated' })
        ),
        http.post('/api/settings/email/test', () =>
          HttpResponse.json({
            success: false,
            message: 'Connection failed',
            error: 'ECONNREFUSED: Unable to connect to SMTP server',
          })
        ),
        http.post('/api/settings/email/send-test', () =>
          HttpResponse.json({
            success: false,
            message: 'Failed to send test email',
            error: 'Connection timed out',
          })
        ),
      ],
    },
  },
};

// Loading State
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/settings/email', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100000));
          return HttpResponse.json(mockEmailStatusSmtp);
        }),
        http.get('/api/setup/email/providers', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100000));
          return HttpResponse.json(mockProviders);
        }),
        http.get('/api/setup/available-options', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100000));
          return HttpResponse.json(mockAvailableOptionsCE);
        }),
      ],
    },
  },
};
