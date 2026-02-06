import { memo } from 'react';
import { cn } from '@/lib/utils';

interface GraphNodeProps {
  color: string;
  isSelected: boolean;
}

export const GraphNode = memo(function GraphNode({ color, isSelected }: GraphNodeProps) {
  return (
    <div
      className={cn(
        'w-3 h-3 rounded-full border-2 transition-all',
        isSelected && 'ring-2 ring-offset-1 ring-primary',
      )}
      style={{
        borderColor: color,
        backgroundColor: isSelected ? color : 'transparent',
      }}
    />
  );
});
