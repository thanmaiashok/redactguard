/**
 * Runs every scan with all network entry points booby-trapped.
 * Prints JSON { attempts, scanned } on stdout. Used by no-network.test.ts.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const attempts: string[] = [];
function trap(obj: Record<string, unknown>, key: string, label: string) {
  obj[key] = (...args: unknown[]) => {
    attempts.push(`${label}(${JSON.stringify(args[0] ?? '').slice(0, 80)})`);
    throw new Error(`redactguard offline test: blocked ${label}`);
  };
}
trap(globalThis as never, 'fetch', 'fetch');
trap(globalThis as never, 'WebSocket', 'WebSocket');
trap(globalThis as never, 'EventSource', 'EventSource');
trap(net.Socket.prototype as never, 'connect', 'net.Socket.connect');
for (const k of ['connect', 'createConnection']) trap(net as never, k, `net.${k}`);
trap(tls as never, 'connect', 'tls.connect');
for (const k of ['request', 'get']) {
  trap(http as never, k, `http.${k}`);
  trap(https as never, k, `https.${k}`);
}
trap(http2 as never, 'connect', 'http2.connect');
for (const k of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny'])
  trap(dns as never, k, `dns.${k}`);
trap(dns.promises as never, 'lookup', 'dns.promises.lookup');
trap(dgram as never, 'createSocket', 'dgram.createSocket');
syncBuiltinESMExports();

const dir = process.argv[2]!;
const { scanFile } = await import('../../src/index.js');
let scanned = 0;
for (const f of (await readdir(dir)).sort()) {
  try {
    await scanFile(path.join(dir, f));
  } catch {
    /* errors are fine here; only network attempts matter */
  }
  scanned++;
}
process.stdout.write(JSON.stringify({ attempts, scanned }));
