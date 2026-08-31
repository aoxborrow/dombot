import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import RegistrarsSettings from './settings/RegistrarsSettings';
import McpClientsSettings from './settings/McpClientsSettings';
import DataSettings from './settings/DataSettings';
import FoldersSettings from './settings/FoldersSettings';

const TAB_VALUES = ['registrars', 'folders', 'mcp', 'data'];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab =
    requested && TAB_VALUES.includes(requested) ? requested : 'registrars';

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setParams({ tab: v }, { replace: true })}
      orientation="vertical"
      className="mx-auto flex max-w-4xl flex-row gap-[47px]"
    >
      <div className="w-44 shrink-0">
        <h1 className="mb-3 px-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
          Settings
        </h1>
        <TabsList className="flex h-auto w-full flex-col gap-1 bg-transparent p-0 [&_button]:text-[15px]">
          <TabsTrigger
            value="registrars"
            className="w-full justify-start data-[state=active]:bg-muted"
          >
            Registrars
          </TabsTrigger>
          <TabsTrigger
            value="folders"
            className="w-full justify-start data-[state=active]:bg-muted"
          >
            Folders
          </TabsTrigger>
          <TabsTrigger
            value="mcp"
            className="w-full justify-start data-[state=active]:bg-muted"
          >
            MCP
          </TabsTrigger>
          <TabsTrigger
            value="data"
            className="w-full justify-start data-[state=active]:bg-muted"
          >
            Cache
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="min-w-0 flex-1">
        <TabsContent value="registrars">
          <RegistrarsSettings />
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
  );
}
