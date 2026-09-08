import type { Readable, Writable } from 'node:stream';
import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/** Own the shim's pipe lifetime. The SDK only listens for stdin errors: it
 * neither handles stdout EPIPE nor turns stdin EOF into transport.onclose. */
export function manageStdio(
  transport: StdioServerTransport,
  input: Readable,
  output: Writable,
  disconnected: (error?: Error) => void,
) {
  let closed = false;
  let resolveClosed!: () => void;
  const whenClosed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const close = (error?: Error) => {
    if (closed) return;
    closed = true;
    resolveClosed();
    void transport.close().catch(() => undefined);
    disconnected(error);
  };
  // Keep stream error listeners installed until the shim exits: a final write
  // error may arrive after EOF/close, and must still be handled.
  input.on('end', () => close());
  input.on('close', () => close());
  input.on('error', close);
  output.on('close', () => close());
  output.on('error', close);
  transport.onclose = () => close();

  return {
    get closed() {
      return closed;
    },
    close,
    async send(message: JSONRPCMessage): Promise<void> {
      if (closed) return;
      try {
        // SDK send waits forever for drain when an errored pipe cannot drain.
        await Promise.race([transport.send(message), whenClosed]);
      } catch (err) {
        close(err instanceof Error ? err : new Error(String(err)));
      }
    },
  };
}
