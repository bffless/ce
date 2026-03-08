import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Play, Plus, Trash2, Loader2 } from 'lucide-react';
import { useTestPipelineMutation, type HttpMethod, type TestPipelineResult } from '@/services/pipelinesApi';
import { TestResultsVisualization } from './TestResultsVisualization';

interface HeaderEntry {
  key: string;
  value: string;
}

interface PipelineTestPanelProps {
  pipelineId: string;
  pathPattern: string;
  httpMethods: HttpMethod[];
}

/**
 * PipelineTestPanel - Component for testing pipeline execution
 * Allows configuring test parameters and viewing detailed results
 */
export function PipelineTestPanel({
  pipelineId,
  pathPattern,
  httpMethods,
}: PipelineTestPanelProps) {
  const [testPipeline, { isLoading }] = useTestPipelineMutation();

  // Test configuration state
  const [isExpanded, setIsExpanded] = useState(false);
  const [method, setMethod] = useState<HttpMethod>(httpMethods[0] || 'POST');
  const [headers, setHeaders] = useState<HeaderEntry[]>([
    { key: 'Content-Type', value: 'application/json' },
  ]);
  const [bodyJson, setBodyJson] = useState('{\n  \n}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Mock user configuration
  const [simulateAuth, setSimulateAuth] = useState(true);
  const [useMockUser, setUseMockUser] = useState(false);
  const [mockUserId, setMockUserId] = useState('test-user-123');
  const [mockUserEmail, setMockUserEmail] = useState('test@example.com');
  const [mockUserRole, setMockUserRole] = useState('user');

  // Test results
  const [testResult, setTestResult] = useState<TestPipelineResult | null>(null);

  // Header management
  const addHeader = useCallback(() => {
    setHeaders((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const removeHeader = useCallback((index: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateHeader = useCallback((index: number, field: 'key' | 'value', value: string) => {
    setHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, [field]: value } : h))
    );
  }, []);

  // Validate JSON body
  const validateAndSetBody = useCallback((value: string) => {
    setBodyJson(value);
    if (!value.trim()) {
      setJsonError(null);
      return;
    }
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, []);

  // Run test
  const runTest = useCallback(async () => {
    // Parse body JSON
    let input: Record<string, unknown> = {};
    if (bodyJson.trim()) {
      try {
        input = JSON.parse(bodyJson);
      } catch {
        setJsonError('Invalid JSON - cannot run test');
        return;
      }
    }

    // Convert headers array to object
    const headersObj: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) {
        headersObj[h.key.trim()] = h.value;
      }
    }

    try {
      const result = await testPipeline({
        id: pipelineId,
        data: {
          method,
          path: pathPattern,
          input,
          headers: headersObj,
          simulateAuth,
          mockUser: useMockUser && simulateAuth
            ? {
                id: mockUserId,
                email: mockUserEmail || undefined,
                role: mockUserRole || undefined,
              }
            : undefined,
        },
      }).unwrap();

      setTestResult(result);
    } catch (error) {
      // RTK Query error handling
      const err = error as { data?: { message?: string } };
      setTestResult({
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: err.data?.message || 'Failed to execute test',
        },
        stepOutputs: {},
        durationMs: 0,
      });
    }
  }, [
    pipelineId,
    pathPattern,
    method,
    bodyJson,
    headers,
    simulateAuth,
    useMockUser,
    mockUserId,
    mockUserEmail,
    mockUserRole,
    testPipeline,
  ]);

  return (
    <Card>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Play className="h-4 w-4 text-green-500" />
              <CardTitle className="text-sm font-medium">Test Pipeline</CardTitle>
              <Badge variant="outline" className="ml-auto">
                {method} {pathPattern}
              </Badge>
            </div>
            <CardDescription className="text-xs mt-1">
              Test your pipeline with sample data and view step-by-step results
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6 pt-0">
            {/* Request Configuration */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Request Configuration</Label>
              </div>

              <div className="grid grid-cols-[100px_1fr] gap-4">
                <div className="space-y-2">
                  <Label htmlFor="test-method" className="text-xs text-muted-foreground">
                    Method
                  </Label>
                  <Select
                    value={method}
                    onValueChange={(v) => setMethod(v as HttpMethod)}
                  >
                    <SelectTrigger id="test-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {httpMethods.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Path</Label>
                  <Input value={pathPattern} disabled className="bg-muted" />
                </div>
              </div>

              {/* Headers */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Headers</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={addHeader}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Header
                  </Button>
                </div>
                <div className="space-y-2">
                  {headers.map((header, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder="Header name"
                        value={header.key}
                        onChange={(e) => updateHeader(index, 'key', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        placeholder="Value"
                        value={header.value}
                        onChange={(e) => updateHeader(index, 'value', e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        onClick={() => removeHeader(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Request Body */}
              <div className="space-y-2">
                <Label htmlFor="test-body" className="text-xs text-muted-foreground">
                  Request Body (JSON)
                </Label>
                <Textarea
                  id="test-body"
                  value={bodyJson}
                  onChange={(e) => validateAndSetBody(e.target.value)}
                  className={`font-mono text-sm min-h-[120px] ${jsonError ? 'border-destructive' : ''}`}
                  placeholder='{"email": "test@example.com", "name": "Test User"}'
                />
                {jsonError && (
                  <p className="text-xs text-destructive">{jsonError}</p>
                )}
              </div>
            </div>

            {/* Authentication Configuration */}
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Simulate Authentication</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Include user context in the test request
                  </p>
                </div>
                <Switch
                  checked={simulateAuth}
                  onCheckedChange={setSimulateAuth}
                />
              </div>

              {simulateAuth && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Use Mock User</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Specify custom user details instead of current user
                      </p>
                    </div>
                    <Switch
                      checked={useMockUser}
                      onCheckedChange={setUseMockUser}
                    />
                  </div>

                  {useMockUser && (
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="mock-user-id" className="text-xs text-muted-foreground">
                          User ID
                        </Label>
                        <Input
                          id="mock-user-id"
                          value={mockUserId}
                          onChange={(e) => setMockUserId(e.target.value)}
                          placeholder="user-123"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mock-user-email" className="text-xs text-muted-foreground">
                          Email (optional)
                        </Label>
                        <Input
                          id="mock-user-email"
                          value={mockUserEmail}
                          onChange={(e) => setMockUserEmail(e.target.value)}
                          placeholder="user@example.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mock-user-role" className="text-xs text-muted-foreground">
                          Role (optional)
                        </Label>
                        <Input
                          id="mock-user-role"
                          value={mockUserRole}
                          onChange={(e) => setMockUserRole(e.target.value)}
                          placeholder="admin"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Run Test Button */}
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={runTest}
                disabled={isLoading || !!jsonError}
                className="min-w-[120px]"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Test
                  </>
                )}
              </Button>
            </div>

            {/* Test Results */}
            {testResult && (
              <div className="border-t pt-4">
                <TestResultsVisualization result={testResult} />
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
