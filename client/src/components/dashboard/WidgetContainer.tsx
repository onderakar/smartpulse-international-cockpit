import { ReactNode } from 'react';

interface WidgetContainerProps {
  children: ReactNode;
  onRemove?: () => void;
}

export function WidgetContainer({ children, onRemove }: WidgetContainerProps) {
  return (
    <div className="h-full w-full relative group">
      {/* Drag handle — visible on hover, pointer-events disabled when hidden */}
      <div className="widget-drag-handle absolute top-1 right-8 z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity cursor-grab active:cursor-grabbing px-1.5 py-0.5 bg-dark-700/80 rounded text-gray-400 hover:text-gray-200 text-xs select-none">
        ⠿
      </div>

      {/* Remove button — visible on hover, pointer-events disabled when hidden */}
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute top-1 right-1 z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity w-6 h-6 flex items-center justify-center bg-dark-700/80 rounded text-gray-400 hover:text-red-400 text-xs"
          title="Remove widget"
        >
          ✕
        </button>
      )}

      {children}
    </div>
  );
}
