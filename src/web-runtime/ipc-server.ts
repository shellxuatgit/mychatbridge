// browser/src/ipc-server.ts
import * as readline from 'readline';
import { encodeBinaryFrame, IpcRequest, IpcResponse, Methods } from './ipc-protocol';
import { BrowserManager } from './browser-manager';

export class IpcServer {
  private buffer = Buffer.alloc(0);
  private handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>> = new Map();

  constructor(private browserManager: BrowserManager) {}

  /** Register a method handler */
  register(method: string, handler: (params: Record<string, unknown>) => Promise<unknown>) {
    this.handlers.set(method, handler);
  }

  /** Start listening on stdin and the binary pipe (fd 3) */
  start() {
    const rl = readline.createInterface({ input: process.stdin });
    const binaryFd = 3;

    rl.on('line', (line) => {
      if (line.trim()) {
        this.handleLine(line);
      }
    });

    // Binary pipe for SSE streaming (fd 3)
    if (this.fdIsOpen(binaryFd)) {
      const fs = require('fs');
      const binaryStream = fs.createReadStream(binaryFd);
      binaryStream.on('data', (chunk: Buffer) => {
        this.handleBinaryData(chunk);
      });
    }

  }

  private fdIsOpen(fd: number): boolean {
    try {
      const fs = require('fs');
      fs.fstatSync(fd);
      return true;
    } catch {
      return false;
    }
  }

  /** Handle a JSON-RPC line from stdin */
  private async handleLine(line: string) {
    let request: IpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      this.writeResponse({
        id: -1,
        error: { code: 'PARSE_ERROR', message: 'Invalid JSON' },
      });
      return;
    }

    try {
      const handler = this.handlers.get(request.method);
      if (!handler) {
        this.writeResponse({
          id: request.id,
          error: { code: 'METHOD_NOT_FOUND', message: `Unknown method: ${request.method}` },
        });
        return;
      }
      const result = await handler(request.params ?? {});
      this.writeResponse({ id: request.id, result });
    } catch (err) {
      this.writeResponse({
        id: request.id,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  /** Handle binary data on fd 3 (not used for requests, but keep for future) */
  private handleBinaryData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // Binary data on fd 3 is primarily SSE responses Rust→Node,
    // but we also support request frames here for symmetry.
  }

  /** Write a JSON-RPC response to stdout */
  writeResponse(response: IpcResponse) {
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  /** Stream an SSE chunk to Rust via binary pipe (fd 3) */
  streamChunk(requestId: string, delta: string, finishReason: string | null) {
    const data = JSON.stringify({
      request_id: requestId,
      delta,
      finish_reason: finishReason,
    });
    const frame = encodeBinaryFrame(data);
    try {
      const fs = require('fs');
      fs.writeSync(3, frame);
    } catch (err) {
      // fd 3 not available (e.g., running in test), fallback to stdout
      process.stdout.write(JSON.stringify({
        event: 'chunk',
        request_id: requestId,
        delta,
        finish_reason: finishReason,
      }) + '\n');
    }
  }
}