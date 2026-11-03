import { useRef, useState, type ReactNode } from 'react';
import { domainKey } from '../../../shared/account-key';
import {
  Building2,
  Calculator,
  CalendarPlus,
  CircleX,
  Ellipsis,
  KeyRound,
  Link2,
  Mail,
  PencilLine,
  Receipt,
  RefreshCw,
  Server,
  Tag,
  Trash2,
} from 'lucide-react';
import type { Domain, DomainOp, Folder } from '../../../shared/ipc';
import type { ArchiveLabel } from '../../../shared/ownership';
import { useAppStore } from '../../store/app';
import {
  reportOpResult,
  targetOf,
  useOpUnsupportedReason,
} from '../../lib/domain-ops';
import { ConfirmDialog } from '../ConfirmDialog';
import { FolderIcon } from '../icons/FolderIcon';
import { FolderMenuItems } from './FolderMenuItems';
import { MenuSub } from './MenuSub';
import { flagConfirm } from './FlagToggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StickyNoteIcon } from '../icons/StickyNoteIcon';
import { CertificateIcon } from '../icons/CertificateIcon';
import { CashIcon } from '../icons/CashIcon';
import type { MarketAction } from './MarketActionDialog';

const dots = <span className="-ml-[6px] opacity-50">…</span>;
// After a T, whose stem leaves room under its bar where the dots sit, a
// little closer, as type kerns "T.".
const dotsAfterT = <span className="-ml-[7px] opacity-50">…</span>;
const icon = 'text-muted-foreground';

/**
 * The trailing "⋯" menu on each row (pinned to the right of the Domain cell),
 * in the bulk bar's Actions order. For a name in Owned or Listings: Refresh
 * (Edit details for an imported name), Folder, Notes, Record purchase (or
 * Edit purchase or registration once one is recorded), Record sale (or Edit
 * sale, where undoing it lives); then Registrar (auto-renew, privacy and lock
 * as checkboxes, which flip with the same confirms as their cells, then
 * nameservers, forwarding, renew, auth code); then Pricing and the market
 * actions (with a market account: List at your price, Ownership verification
 * TXT, Delist); then Delete, only for a name no connected
 * account holds (imported or in Archive): a name you hold leaves by turning
 * its auto-renew off (docs/owned-and-archive.md). Otherwise every row in a
 * view gets the same items: what doesn't apply is greyed with the reason as
 * its tooltip (Registrar as a whole for an imported name). A name in Archive
 * gets a short flat menu: Notes, the two records, Delete.
 * Disabled outright while a write for this row is in flight.
 */
export function RowActionsMenu({
  domain,
  folders,
  folderId,
  onRefresh,
  onNameservers,
  onUrlForwarding,
  onEmailForwarding,
  onAuthCode,
  onRenew,
  onNotes,
  onEditPurchase,
  onEditSale,
  onEditListPrice,
  onEditDetails,
  onAssignFolder,
  archive,
  sold,
  paid,
  removable,
  onMarkSold,
  onDelete,
  onMarket,
  marketReasons,
}: {
  domain: Domain;
  folders: Folder[];
  folderId: string | undefined;
  onRefresh: () => void;
  onNameservers: () => void;
  onUrlForwarding: () => void;
  onEmailForwarding: () => void;
  onAuthCode: () => void;
  onRenew: () => void;
  onNotes: () => void;
  onEditPurchase: () => void;
  onEditSale: () => void;
  onEditListPrice: () => void;
  /** An imported name: edit its registrar, dates, and auto-renew. */
  onEditDetails: () => void;
  onAssignFolder: (folderId: string | null) => void;
  /** Why the name is in Archive, or null while you own it. */
  archive: ArchiveLabel | null;
  /** A sale is on record: Record sale edits it. */
  sold: boolean;
  /** What's recorded as paid, if anything: Record purchase edits it. */
  paid?: 'registered' | 'purchased' | null;
  /** No connected account holds it: Delete applies. */
  removable: boolean;
  onMarkSold: () => void;
  onDelete: () => void;
  /** Market actions; absent with no market account. */
  onMarket?: (action: MarketAction) => void;
  /** Why each market action can't apply here; null when it can. */
  marketReasons?: Record<MarketAction, string | null>;
}) {
  const key = domainKey(domain);
  const pending = useAppStore((s) => s.mutating[key] ?? false);
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  // An imported name isn't at a connected account: registrar actions can't run.
  const imported = domain.source === 'imported';
  // Each reason is for the change a click would make (GoDaddy can turn
  // privacy off but not on).
  const autoRenewReason = useOpUnsupportedReason(domain, {
    kind: 'autoRenew',
    enabled: !domain.autoRenew,
  });
  const privacyReason = useOpUnsupportedReason(domain, {
    kind: 'privacy',
    enabled: !domain.privacy,
  });
  const lockReason = useOpUnsupportedReason(domain, {
    kind: 'lock',
    locked: !domain.locked,
  });
  const nameserversReason = useOpUnsupportedReason(domain, {
    kind: 'nameservers',
    nameservers: [],
  });
  const urlReason = useOpUnsupportedReason(domain, {
    kind: 'urlForwarding',
    forwards: [],
  });
  const emailReason = useOpUnsupportedReason(domain, {
    kind: 'emailForwarding',
    forwards: [],
  });
  const authReason = useOpUnsupportedReason(domain, {
    kind: 'authCode',
  });
  const renewReason = useOpUnsupportedReason(domain, {
    kind: 'renew',
    years: 1,
  });

  // A privacy change or an unlock waiting on its confirm.
  const [confirming, setConfirming] = useState<{
    kind: 'privacy' | 'lock';
    next: boolean;
  } | null>(null);

  // Notes opens an editor beside the row: the menu mustn't hand focus back
  // to its trigger as it closes, or the editor's textarea loses the caret.
  const keepFocus = useRef(false);

  const write = (op: DomainOp, patch: Partial<Domain>) => {
    void applyDomainOp(targetOf(domain), op, patch).then((result) =>
      reportOpResult(op, result),
    );
  };
  const flipFlag = (kind: 'privacy' | 'lock', next: boolean) =>
    kind === 'privacy'
      ? write({ kind: 'privacy', enabled: next }, { privacy: next })
      : write({ kind: 'lock', locked: next }, { locked: next });
  const toggleFlag = (kind: 'privacy' | 'lock') => {
    const next = kind === 'privacy' ? !domain.privacy : !domain.locked;
    if (flagConfirm(domain, kind, next)) {
      setConfirming({ kind, next });
    } else {
      flipFlag(kind, next);
    }
  };
  const confirm =
    confirming && flagConfirm(domain, confirming.kind, confirming.next);

  // A registrar item, greyed with the reason when the registrar can't do it.
  const registrarItem = (
    reason: string | null,
    glyph: ReactNode,
    label: string,
    onSelect: () => void,
  ) => (
    <DropdownMenuItem
      disabled={reason !== null}
      title={reason ?? undefined}
      onSelect={onSelect}
    >
      {glyph}
      {label}
      {dots}
    </DropdownMenuItem>
  );
  const flagItem = (
    reason: string | null,
    checked: boolean,
    label: string,
    onSelect: () => void,
  ) => (
    <DropdownMenuCheckboxItem
      checked={checked}
      disabled={reason !== null}
      title={reason ?? undefined}
      onSelect={onSelect}
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
  const marketItem = (action: MarketAction, glyph: ReactNode, label: string) =>
    onMarket && (
      <DropdownMenuItem
        disabled={Boolean(marketReasons?.[action])}
        title={marketReasons?.[action] ?? undefined}
        onSelect={() => onMarket(action)}
      >
        {glyph}
        {label}
        {label.endsWith('T') ? dotsAfterT : dots}
      </DropdownMenuItem>
    );

  const notesItem = (
    <DropdownMenuItem
      onSelect={() => {
        keepFocus.current = true;
        onNotes();
      }}
    >
      <StickyNoteIcon className={icon} />
      Notes{dots}
    </DropdownMenuItem>
  );
  const purchaseItem = (
    <DropdownMenuItem onSelect={onEditPurchase}>
      <Calculator className={icon} />
      {paid === 'registered'
        ? 'Edit registration'
        : paid
          ? 'Edit purchase'
          : 'Record purchase'}
      {dots}
    </DropdownMenuItem>
  );
  const saleItem = (
    <DropdownMenuItem onSelect={sold ? onEditSale : onMarkSold}>
      <Receipt className={icon} />
      {sold ? 'Edit sale' : 'Record sale'}
      {dots}
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Actions for ${domain.domainName}`}
            // Covers the Domain cell outside the name: the cell lights, not
            // the button (index.css).
            data-cell-action
            className="-my-2 w-7 text-muted-foreground hover:bg-transparent hover:text-foreground compact:h-7 compact:w-6 dark:hover:bg-transparent"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Wide enough for "Verify ownership TXT" (about 202px) even with
          // a scrollbar showing (about 15px) when the menu is taller than
          // the window, and for the submenus a phone opens in place.
          className="w-56"
          onCloseAutoFocus={(e) => {
            if (!keepFocus.current) return;
            keepFocus.current = false;
            e.preventDefault();
          }}
        >
          {archive !== null ? (
            <>
              {notesItem}
              {purchaseItem}
              {saleItem}
            </>
          ) : (
            <>
              {imported ? (
                <DropdownMenuItem onSelect={onEditDetails}>
                  <PencilLine className={icon} />
                  Edit details{dots}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={onRefresh}>
                  <RefreshCw className={icon} />
                  Refresh
                </DropdownMenuItem>
              )}
              <MenuSub
                icon={<FolderIcon className={icon} />}
                label="Folder"
                contentClassName="max-h-[320px] w-52 overflow-y-auto"
              >
                <FolderMenuItems
                  folders={folders}
                  selected={folderId ?? null}
                  onAssign={onAssignFolder}
                />
              </MenuSub>
              {notesItem}
              {purchaseItem}
              {saleItem}
              <DropdownMenuSeparator />
              <MenuSub
                icon={<Building2 className={icon} />}
                label="Registrar"
                disabled={imported}
                title={
                  imported
                    ? 'Added by you. No connected account holds this name.'
                    : undefined
                }
              >
                {flagItem(autoRenewReason, domain.autoRenew, 'Auto-renew', () =>
                  write(
                    { kind: 'autoRenew', enabled: !domain.autoRenew },
                    { autoRenew: !domain.autoRenew },
                  ),
                )}
                {flagItem(privacyReason, domain.privacy, 'WHOIS privacy', () =>
                  toggleFlag('privacy'),
                )}
                {flagItem(lockReason, domain.locked, 'Transfer lock', () =>
                  toggleFlag('lock'),
                )}
                <DropdownMenuSeparator />
                {registrarItem(
                  nameserversReason,
                  <Server className={icon} />,
                  'Nameservers',
                  onNameservers,
                )}
                {registrarItem(
                  urlReason,
                  <Link2 className={icon} />,
                  'URL forwarding',
                  onUrlForwarding,
                )}
                {registrarItem(
                  emailReason,
                  <Mail className={icon} />,
                  'Email forwarding',
                  onEmailForwarding,
                )}
                <DropdownMenuSeparator />
                {registrarItem(
                  renewReason,
                  <CalendarPlus className={icon} />,
                  'Renew',
                  onRenew,
                )}
                {registrarItem(
                  authReason,
                  <KeyRound className={icon} />,
                  'Get auth code',
                  onAuthCode,
                )}
              </MenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onEditListPrice}>
                <CashIcon className={icon} />
                Pricing{dots}
              </DropdownMenuItem>
              {marketItem(
                'list',
                <Tag className={icon} />,
                'List at your price',
              )}
              {marketItem(
                'verificationTxt',
                <CertificateIcon className={icon} />,
                'Verify ownership TXT',
              )}
              {/* Recheck ownership is hidden for now: Afternic's relist
                  doesn't run the check, Sedo can't be asked, Atom allows
                  one request in 12 hours, and all three check on their
                  own (docs/markets.md). */}
              {marketItem('delist', <CircleX className={icon} />, 'Delist')}
            </>
          )}
          {/* Only for names no connected account holds: a name you hold
              leaves when you turn its auto-renew off. */}
          {removable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 />
                Delete{dots}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.body}
          actionLabel={confirm.action}
          destructive={confirm.destructive}
          onConfirm={() => {
            flipFlag(confirming.kind, confirming.next);
            setConfirming(null);
          }}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}
