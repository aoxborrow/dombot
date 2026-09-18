import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import GeneralSettings from './settings/GeneralSettings';
import RegistrarsSettings from './settings/RegistrarsSettings';
import McpClientsSettings from './settings/McpClientsSettings';
import DataSettings from './settings/DataSettings';
import FoldersSettings from './settings/FoldersSettings';
import ProxySettings from './settings/ProxySettings';

// One row per section: the URL `tab` value and its label. Both the desktop
// sidebar and the phone picker render from this, so adding a section (which will
// happen) needs no layout change and can't outgrow either control.
const SECTIONS = [
  { value: 'general', label: 'General' },
  { value: 'registrars', label: 'Registrars' },
  { value: 'proxy', label: 'Proxy' },
  { value: 'data', label: 'Sync' },
  { value: 'folders', label: 'Folders' },
  { value: 'mcp', label: 'MCP' },
] as const;

const TAB_VALUES = SECTIONS.map((s) => s.value);

// The phone section picker's options: the selected one gets the brand-green
// fill (matching the desktop sidebar's active pill), and its check moves to the
// left — overriding the default right-aligned indicator on the shared SelectItem.
const PICKER_ITEM_CLASS = cn(
  'py-2 pr-2! pl-8!',
  '[&_[data-slot=select-item-indicator]]:right-auto [&_[data-slot=select-item-indicator]]:left-2',
  'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
  'data-[state=checked]:focus:bg-primary data-[state=checked]:focus:text-primary-foreground',
  'data-[state=checked]:[&_svg]:text-primary-foreground!',
);

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab =
    requested && TAB_VALUES.includes(requested as (typeof TAB_VALUES)[number])
      ? requested
      : SECTIONS[0].value;
  const setTab = (v: string) => setParams({ tab: v }, { replace: true });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:gap-7">
      <h1 className="text-2xl font-bold sm:text-[32px]">Settings</h1>

      <Tabs
        value={tab}
        onValueChange={setTab}
        orientation="vertical"
        className="flex flex-col gap-4 md:flex-row md:gap-[47px]"
      >
        <div className="w-full md:w-44 md:shrink-0">
          {/* Phones: a compact section picker that stays one line no matter how
              many sections there are. Desktop: the vertical sidebar list. */}
          <Select value={tab} onValueChange={setTab}>
            <SelectTrigger className="w-full md:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTIONS.map((s) => (
                <SelectItem
                  key={s.value}
                  value={s.value}
                  className={PICKER_ITEM_CLASS}
                >
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TabsList className="hidden h-auto w-full flex-col gap-1 bg-transparent p-0 md:-ml-2 md:flex [&_button]:text-[15px]">
            {SECTIONS.map((s) => (
              <TabsTrigger
                key={s.value}
                value={s.value}
                className="w-full justify-start data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
              >
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-w-0 flex-1">
          <TabsContent value="general">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="registrars">
            <RegistrarsSettings />
          </TabsContent>
          <TabsContent value="proxy">
            <ProxySettings />
          </TabsContent>
          <TabsContent value="folders">
            <FoldersSettings />
          </TabsContent>
          <TabsContent value="mcp">
            <McpClientsSettings />
          </TabsContent>
          <TabsContent value="data">
            <DataSettings />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
