import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { setClaimToken, nextWizardStep } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ClaimStep() {
  const dispatch = useDispatch();
  const [token, setToken] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(setClaimToken(token.trim()));
    dispatch(nextWizardStep());
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Claim this instance</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the claim token for this server. On DigitalOcean, open your droplet&apos;s{' '}
          <strong>Console</strong> from the control panel — the token is shown in the login
          banner.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <Label htmlFor="claim-token">Claim token</Label>
          <Input
            id="claim-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Claim token"
            className="mt-1"
            autoFocus
            autoComplete="off"
          />
        </div>

        <Button type="submit" className="w-full" disabled={!token.trim()}>
          Continue
        </Button>
      </form>
    </div>
  );
}
