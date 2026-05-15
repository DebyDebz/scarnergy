"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-3">
        <p className="text-sm font-semibold text-gray-700">Something went wrong</p>
        <p className="text-xs text-red-500 font-mono">{error.message}</p>
        <button
          onClick={reset}
          className="text-xs text-brand-700 underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
