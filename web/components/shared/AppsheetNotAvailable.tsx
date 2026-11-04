// Explicit "no AppSheet-side data" notice, used wherever a page's content
// has no corresponding AppSheet sheet (sessions, measurements — mobile-app
// -only capture with no equivalent in the workbook per
// docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §1) or hasn't been wired up
// yet. Deliberately not a silent empty state — an empty Supabase query
// against an AppSheet Object ID would look identical to "zero real rows"
// and mislead the user (this was the original bug behind the contact card).
export function AppsheetNotAvailable({ items }: { items: string[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-medium text-amber-700 mb-2">Not available for AppSheet-sourced data yet</p>
      <ul className="text-xs text-gray-500 list-disc list-inside space-y-1">
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
