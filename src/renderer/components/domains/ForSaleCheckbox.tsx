import { useState } from 'react';
import { toast } from 'sonner';
import { toAscii } from '../../../shared/domain-name';
import { useAppStore } from '../../store/app';
import { Checkbox } from '@/components/ui/checkbox';

export function ForSaleCheckbox({ domainName }: { domainName: string }) {
  const checked = useAppStore((s) => s.forSale[toAscii(domainName)] === true);
  const setForSale = useAppStore((s) => s.setForSale);
  const [saving, setSaving] = useState(false);
  return (
    <Checkbox
      aria-label={`For sale: ${domainName}`}
      checked={checked}
      disabled={saving}
      onCheckedChange={async (value) => {
        setSaving(true);
        try {
          await setForSale([domainName], value === true);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : 'Could not save for-sale status',
          );
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}
