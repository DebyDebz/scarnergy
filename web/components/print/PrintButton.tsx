'use client';

// The print trigger needs an onClick handler, which can't be passed straight
// onto a DOM element from the print pages' Server Components (they do async
// DB reads) — split out into its own Client Component instead. `hint` and
// `padding` are parametrised so each page keeps its exact existing copy/layout.
export function PrintButton({ hint, padding = '10px' }: { hint: string; padding?: string }) {
  return (
    <div className="no-print" style={{ padding, background: '#f0f4f8', borderBottom: '1px solid #ddd', display: 'flex', gap: '8px', alignItems: 'center' }}>
      <button onClick={() => window.print()} style={{ padding: '6px 16px', background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
        Print / Save as PDF
      </button>
      <span style={{ fontSize: '12px', color: '#666' }}>{hint}</span>
    </div>
  );
}
