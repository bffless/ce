import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Database, MessageSquare, Upload, ArrowRight } from 'lucide-react';

export type SchemaType = 'state' | 'chat' | 'upload';

interface GenerateSchemaTypeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectType: (type: SchemaType) => void;
}

/**
 * Modal for selecting between State and Chat schema generation.
 * This is the first step before showing the specific generation modal.
 */
export function GenerateSchemaTypeModal({
  open,
  onOpenChange,
  onSelectType,
}: GenerateSchemaTypeModalProps) {
  const handleSelect = (type: SchemaType) => {
    onOpenChange(false);
    onSelectType(type);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Schema</DialogTitle>
          <DialogDescription>
            Choose the type of schema to generate with pre-configured pipelines.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* State Schema Option */}
          <Card
            className="cursor-pointer hover:bg-muted/50 transition-colors border-2 hover:border-primary/50"
            onClick={() => handleSelect('state')}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Database className="h-6 w-6 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">State Schema</h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    For persistent key-value state with GET/POST endpoints.
                    Perfect for user preferences, settings, and session data.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">User-scoped</span>
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">Global</span>
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">2 pipelines</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chat Schema Option */}
          <Card
            className="cursor-pointer hover:bg-muted/50 transition-colors border-2 hover:border-primary/50"
            onClick={() => handleSelect('chat')}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-6 w-6 text-purple-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">Chat Schema</h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    For AI-powered chat conversations with message history.
                    Includes conversation management and AI response generation.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">Conversations</span>
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">Messages</span>
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">5 pipelines</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          {/* Upload Schema Option */}
          <Card
            className="cursor-pointer hover:bg-muted/50 transition-colors border-2 hover:border-primary/50"
            onClick={() => handleSelect('upload')}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                  <Upload className="h-6 w-6 text-green-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">Upload Schema</h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    For file uploads with metadata tracking and configurable access control.
                    Includes upload and serve endpoints.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">File Storage</span>
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">Date Bucketing</span>
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">2 pipelines</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
