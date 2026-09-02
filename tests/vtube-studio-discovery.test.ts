import { describe, expect, it } from 'vitest';

import { parseVTubeStudioApiBroadcast } from '../src/main/vtube-studio/vtube-studio-discovery';

const broadcast = (data: Record<string, unknown>): Buffer =>
  Buffer.from(
    JSON.stringify({
      apiName: 'VTubeStudioPublicAPI',
      apiVersion: '1.0',
      messageType: 'VTubeStudioAPIStateBroadcast',
      data,
    }),
  );

describe('VTube Studio API discovery', () => {
  it('reads only the active state and actual port from a local broadcast', () => {
    expect(
      parseVTubeStudioApiBroadcast(
        broadcast({
          active: true,
          port: 8_002,
          instanceID: 'private-instance-id',
          windowTitle: 'private-window-title',
        }),
        { address: '127.0.0.1' },
      ),
    ).toEqual({ found: true, active: true, port: 8_002 });
  });

  it('rejects malformed, out-of-range, and non-local broadcasts', () => {
    expect(
      parseVTubeStudioApiBroadcast(broadcast({ active: true, port: 80 }), {
        address: '127.0.0.1',
      }),
    ).toEqual({ found: false });
    expect(
      parseVTubeStudioApiBroadcast(broadcast({ active: false, port: 8_001 }), {
        address: '203.0.113.10',
      }),
    ).toEqual({ found: false });
    expect(
      parseVTubeStudioApiBroadcast(Buffer.from('{not-json'), { address: '127.0.0.1' }),
    ).toEqual({ found: false });
  });
});
