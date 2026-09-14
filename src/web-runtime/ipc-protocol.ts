// browser/src/ipc-protocol.ts

/** JSON-RPC request from Rust Core */
export interface IpcRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/** JSON-RPC response to Rust Core */
export interface IpcResponse {
  id: number;
  result?: unknown;
  error?: { code: string; message: string };
}

/** SSE streaming binary frame (fd 3) */
export interface BinaryFrame {
  length: number;
  data: Buffer;
}

/** Encode a binary frame: [length: 4 bytes BE][data] */
export function encodeBinaryFrame(data: Buffer | string): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(buf.length, 0);
  return Buffer.concat([header, buf]);
}

/** Decode a binary frame from a buffer (returns frame + remaining) */
export function decodeBinaryFrame(buffer: Buffer): { frame: BinaryFrame | null; remaining: Buffer } {
  if (buffer.length < 4) {
    return { frame: null, remaining: buffer };
  }
  const length = buffer.readUInt32BE(0);
  if (buffer.length < 4 + length) {
    return { frame: null, remaining: buffer };
  }
  const data = buffer.subarray(4, 4 + length);
  return {
    frame: { length, data: Buffer.from(data) },
    remaining: buffer.subarray(4 + length),
  };
}

/** IPC method names (must match Rust side) */
export const Methods = {
  BROWSER_INVOKE: 'browser.invoke',
  BROWSER_HEALTH: 'browser.health',
  SESSION_SAVE: 'session.save',
  SESSION_RESTORE: 'session.restore',
  PROVIDER_LOAD: 'provider.load',
  PROVIDER_RELOAD: 'provider.reload',
  FILE_UPLOAD: 'file.upload',
} as const;