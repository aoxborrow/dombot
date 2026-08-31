import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import RegistrarsSettings from './settings/RegistrarsSettings';
import McpClientsSettings from './settings/McpClientsSettings';
import DataSettings from './settings/DataSettings';

export default function Settings() {
  return (
    <Tabs
      defaultValue="registrars"
      orientation="vertical"
      className="mx-auto flex max-w-4xl flex-row gap-8"
    >
      <div className="w-44 shrink-0">
        <h1 className="mb-3 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Settings
        </h1>
        <TabsList className="flex h-auto w-full flex-col gap-1 bg-transparent p-0">
          <TabsTrigger
            value="registrars"
            className="w-full justify-start data-[state=active]:bg-muted"
          >
            Registrars
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
            Data
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="min-w-0 flex-1">
        <TabsContent value="registrars">
          <RegistrarsSettings />
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
