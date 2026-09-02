import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

import { MAX_VTUBE_STUDIO_PORT, MIN_VTUBE_STUDIO_PORT } from '../../shared/vtube-studio-ipc';

const DISCOVERY_PORT = 47_779;
const DISCOVERY_TIMEOUT_MS = 2_500;
const MAX_DISCOVERY_DATAGRAM_BYTES = 16 * 1_024;

export type VTubeStudioApiDiscoveryResult =
  { found: true; active: boolean; port: number } | { found: false };

export type VTubeStudioApiDiscovery = () => Promise<VTubeStudioApiDiscoveryResult>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeAddress = (address: string): string => address.replace(/^::ffff:/u, '');

const isLocalAddress = (address: string): boolean => {
  const normalized = normalizeAddress(address);
  if (normalized === '127.0.0.1' || normalized === '::1') return true;
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .some((candidate) => normalizeAddress(candidate.address) === normalized);
};

export const parseVTubeStudioApiBroadcast = (
  datagram: Buffer,
  remote: Pick<RemoteInfo, 'address'>,
): VTubeStudioApiDiscoveryResult => {
  if (!isLocalAddress(remote.address) || datagram.byteLength > MAX_DISCOVERY_DATAGRAM_BYTES) {
    return { found: false };
  }
  try {
    const payload: unknown = JSON.parse(datagram.toString('utf8'));
    const data = isRecord(payload) ? payload.data : undefined;
    if (
      !isRecord(payload) ||
      payload.apiName !== 'VTubeStudioPublicAPI' ||
      payload.messageType !== 'VTubeStudioAPIStateBroadcast' ||
      !isRecord(data) ||
      typeof data.active !== 'boolean' ||
      !Number.isInteger(data.port) ||
      Number(data.port) < MIN_VTUBE_STUDIO_PORT ||
      Number(data.port) > MAX_VTUBE_STUDIO_PORT
    ) {
      return { found: false };
    }
    return { found: true, active: data.active, port: Number(data.port) };
  } catch {
    return { found: false };
  }
};

export const discoverVTubeStudioApi: VTubeStudioApiDiscovery = () =>
  new Promise<VTubeStudioApiDiscoveryResult>((resolve) => {
    let socket: Socket | undefined;
    let settled = false;
    const finish = (result: VTubeStudioApiDiscoveryResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Discovery is optional; the configured loopback port remains the fallback.
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ found: false }), DISCOVERY_TIMEOUT_MS);
    timer.unref?.();
    try {
      socket = createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('message', (message, remote) => {
        const result = parseVTubeStudioApiBroadcast(message, remote);
        if (result.found) finish(result);
      });
      socket.once('error', () => finish({ found: false }));
      socket.bind(DISCOVERY_PORT, '0.0.0.0');
    } catch {
      finish({ found: false });
    }
  });
