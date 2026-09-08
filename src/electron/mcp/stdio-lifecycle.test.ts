import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { manageStdio } from './stdio-lifecycle';

const message = { jsonrpc: '2.0' as const, id: 1, result: {} };

describe('MCP stdio pipe lifecycle', () => {
  it('handles the reported EPIPE from the real SDK without an uncaught error or hung send', async () => {
    const input = new PassThrough();
    const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(error);
      },
    });
    const transport = new StdioServerTransport(input, output);
    const disconnected = vi.fn();
    const lifecycle = manageStdio(transport, input, output, disconnected);
    await transport.start();
    await lifecycle.send(message);
    expect(lifecycle.closed).toBe(true);
    expect(disconnected).toHaveBeenCalledExactlyOnceWith(error);
    await lifecycle.send(message);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('stops on client stdin EOF and never writes a late HTTP reply', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const write = vi.spyOn(output, 'write');
    const transport = new StdioServerTransport(input, output);
    const disconnected = vi.fn();
    const lifecycle = manageStdio(transport, input, output, disconnected);
    await transport.start();
    const ended = new Promise((resolve) => input.once('end', resolve));
    input.end();
    await ended;
    await lifecycle.send(message);
    expect(write).not.toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalledTimes(1);
    output.emit(
      'error',
      Object.assign(new Error('late EPIPE'), { code: 'EPIPE' }),
    );
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('preserves normal replies and respects backpressure', async () => {
    const input = new PassThrough();
    let finish!: () => void;
    const chunks: string[] = [];
    const output = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        finish = callback;
      },
    });
    const transport = new StdioServerTransport(input, output);
    const disconnected = vi.fn();
    const lifecycle = manageStdio(transport, input, output, disconnected);
    await transport.start();
    let completed = false;
    const sending = lifecycle.send(message).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish();
    await sending;
    expect(chunks).toEqual([JSON.stringify(message) + '\n']);
    expect(disconnected).not.toHaveBeenCalled();
    lifecycle.close();
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('consumes rejected sends and closes once', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = new StdioServerTransport(input, output);
    const error = new Error('send failed');
    vi.spyOn(transport, 'send').mockRejectedValue(error);
    const disconnected = vi.fn();
    const lifecycle = manageStdio(transport, input, output, disconnected);
    await lifecycle.send(message);
    expect(disconnected).toHaveBeenCalledExactlyOnceWith(error);
    lifecycle.close();
    expect(disconnected).toHaveBeenCalledTimes(1);
  });
});
