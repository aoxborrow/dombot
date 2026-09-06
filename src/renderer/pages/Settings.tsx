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
    <div className="mx-auto flex max-w-4xl flex-col gap-7">
      <h1 className="text-[32px] font-bold">Settings</h1>

      <Tabs
        value={tab}
        onValueChange={(v) => setParams({ tab: v }, { replace: true })}
        orientation="vertical"
        className="flex flex-row gap-[47px]"
      >
        <div className="w-44 shrink-0">
          <TabsList className="-ml-2 flex h-auto w-full flex-col gap-1 bg-transparent p-0 [&_button]:text-[15px]">
            <TabsTrigger
              value="registrars"
              className="w-full justify-start data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
            >
              Registrars
            </TabsTrigger>
            <TabsTrigger
              value="folders"
              className="w-full justify-start data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
            >
              Folders
            </TabsTrigger>
            <TabsTrigger
              value="mcp"
              className="w-full justify-start data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
            >
              MCP
            </TabsTrigger>
            <TabsTrigger
              value="data"
              className="w-full justify-start data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
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
    </div>
  );
}
