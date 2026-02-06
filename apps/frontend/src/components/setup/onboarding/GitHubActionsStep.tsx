import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, CheckCircle } from 'lucide-react';

interface GitHubActionsStepProps {
  apiKey: string | null;
  onComplete: () => void;
}

const workflowTemplate = `name: Deploy to Asset Host

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Deploy to Asset Host
        uses: toshimoto821/asset-host-action@v1
        with:
          api-url: \${{ secrets.ASSET_HOST_URL }}
          api-key: \${{ secrets.ASSET_HOST_API_KEY }}
          source-dir: dist
          owner: \${{ github.repository_owner }}
          repo: \${{ github.event.repository.name }}
          commit-sha: \${{ github.sha }}
          branch: \${{ github.ref_name }}
`;

export function GitHubActionsStep({ apiKey, onComplete }: GitHubActionsStepProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(workflowTemplate);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add this workflow file to your GitHub repository to enable automatic deployments.
      </p>

      <div className="bg-zinc-900 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-800">
          <span className="text-sm text-zinc-300">.github/workflows/deploy.yml</span>
          <Button
            size="sm"
            variant="ghost"
            className="text-zinc-300 hover:text-white hover:bg-zinc-700"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <CheckCircle className="w-4 h-4 mr-1" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1" />
                Copy
              </>
            )}
          </Button>
        </div>
        <pre className="p-4 text-sm text-zinc-100 overflow-x-auto max-h-64">
          <code>{workflowTemplate}</code>
        </pre>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 dark:text-blue-400">Add Repository Secrets</h4>
        <p className="text-sm text-blue-700 dark:text-blue-500 mt-1">
          In your GitHub repository settings, add these secrets:
        </p>
        <ul className="text-sm text-blue-700 dark:text-blue-500 mt-2 space-y-1">
          <li>
            <code className="bg-blue-500/20 px-1 rounded">ASSET_HOST_URL</code> - Your
            platform URL (e.g., https://assets.example.com)
          </li>
          <li>
            <code className="bg-blue-500/20 px-1 rounded">ASSET_HOST_API_KEY</code> -{' '}
            {apiKey ? 'The key you just generated' : 'Your API key'}
          </li>
        </ul>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={onComplete}>Done</Button>
      </div>
    </div>
  );
}
