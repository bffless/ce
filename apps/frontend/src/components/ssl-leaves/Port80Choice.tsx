export function Port80Choice({
  value,
  onChange,
}: {
  value: 'closed' | 'redirect';
  onChange: (v: 'closed' | 'redirect') => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Port 80 (HTTP)</p>
      <label className="flex items-start text-sm cursor-pointer">
        <input
          type="radio"
          name="port80"
          checked={value === 'redirect'}
          onChange={() => onChange('redirect')}
          className="mt-0.5 mr-2"
        />
        <span>Redirect to HTTPS — plain HTTP requests are redirected to the secure origin</span>
      </label>
      <label className="flex items-start text-sm cursor-pointer">
        <input
          type="radio"
          name="port80"
          checked={value === 'closed'}
          onChange={() => onChange('closed')}
          className="mt-0.5 mr-2"
        />
        <span>Close port 80 — my CDN connects to this origin over HTTPS only</span>
      </label>
    </div>
  );
}
