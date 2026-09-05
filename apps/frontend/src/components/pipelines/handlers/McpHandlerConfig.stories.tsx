import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { api } from '@/services/api';
import { McpHandlerConfig } from './McpHandlerConfig';
import workflow from './mcp/__fixtures__/workflow.json';

const createStore = () =>
  configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });

const siblingRules = {
  rules: [
    {
      id: 'self',
      pathPattern: '/api/workflow/mcp',
      method: null,
      methods: ['GET', 'POST', 'DELETE'],
      isEnabled: true,
    },
    ...[
      'list',
      'describe',
      'start',
      'status',
      'await',
      'runs',
      'submitStep',
      'outputs',
      'sign',
      'cancel',
      'resume',
      'submit',
      'annotate',
      'pipeline',
      'stepView',
    ].map((n) => ({
      id: `t-${n}`,
      pathPattern: `/api/workflow/mcp-tools/${n}`,
      method: null,
      methods: ['POST'],
      isEnabled: true,
    })),
    {
      id: 'res',
      pathPattern: '/api/workflow/mcp-resources',
      method: 'GET',
      methods: null,
      isEnabled: true,
    },
    {
      id: 'sv',
      pathPattern: '/api/workflow/mcp-resources/step-view',
      method: 'GET',
      methods: null,
      isEnabled: true,
    },
    { id: 'w', pathPattern: '/w/*', method: 'GET', methods: null, isEnabled: true },
  ],
};

function Stateful({ initial }: { initial: Record<string, unknown> }) {
  const [config, setConfig] = useState(initial);
  return (
    <div className="max-w-4xl p-4">
      <McpHandlerConfig config={config} onChange={setConfig} />
    </div>
  );
}

const meta: Meta<typeof Stateful> = {
  title: 'Pipelines/Handlers/McpHandlerConfig',
  component: Stateful,
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get('*/api/proxy-rule-sets/:id/rules', () => HttpResponse.json(siblingRules)),
      ],
    },
  },
  decorators: [
    (Story) => (
      <Provider store={createStore()}>
        <MemoryRouter initialEntries={['/repo/bffless/workflow/proxy-rules/set-1/self']}>
          <Routes>
            <Route path="/repo/:owner/:repo/proxy-rules/:ruleSetId/:ruleId" element={<Story />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Stateful>;

export const WorkflowServer: Story = { args: { initial: workflow } };
export const Empty: Story = { args: { initial: {} } };
export const WithProblems: Story = {
  args: {
    initial: {
      serverInfo: { name: 'demo', version: '' },
      tools: [
        { name: 'a', description: '', inputSchema: { type: 'object' }, rule: { path: 'relative' } },
        { name: 'a', description: '', inputSchema: { type: 'object' }, rule: { path: '/ok' } },
      ],
      resources: { templates: [{ uriTemplate: 'ui://plain', name: 'p', rule: { path: '/p' } }] },
    },
  },
};
