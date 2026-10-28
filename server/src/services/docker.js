// Minimal Docker Engine API client. In docker-compose it talks to a
// docker-socket-proxy (DOCKER_HOST=tcp://docker-proxy-ops:2375) that only
// allows container read endpoints + restart; it never touches the raw socket.
import http from 'node:http';

const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function connection() {
  const host = process.env.DOCKER_HOST || '';
  if (host.startsWith('tcp://')) {
    const u = new URL(host.replace('tcp://', 'http://'));
    return { host: u.hostname, port: Number(u.port || 2375) };
  }
  return { socketPath: host.startsWith('unix://') ? host.slice(7) : (process.env.DOCKER_SOCKET || '/var/run/docker.sock') };
}

function dockerRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...connection(), path, method, timeout: 15_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, data: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('Docker API timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** Strips Docker's 8-byte stream multiplexing headers from log output. */
export function demuxDockerStream(buffer) {
  let offset = 0;
  const parts = [];
  while (offset < buffer.length) {
    const type = buffer[offset];
    if (offset + 8 > buffer.length || ![0, 1, 2].includes(type) || buffer.readUInt16BE(offset + 1) !== 0) {
      parts.push(buffer.subarray(offset).toString('utf-8')); // TTY container: raw stream
      break;
    }
    const size = buffer.readUInt32BE(offset + 4);
    parts.push(buffer.subarray(offset + 8, offset + 8 + size).toString('utf-8'));
    offset += 8 + size;
  }
  return parts.join('');
}

export function isValidContainerId(id) {
  return typeof id === 'string' && CONTAINER_ID_RE.test(id);
}

export const dockerService = {
  async getLogs(containerId, tail = 100) {
    if (!isValidContainerId(containerId)) throw Object.assign(new Error('Invalid container id'), { status: 400 });
    const n = Math.min(Math.max(parseInt(tail, 10) || 100, 1), 1000);
    const res = await dockerRequest(`/containers/${encodeURIComponent(containerId)}/logs?stdout=1&stderr=1&tail=${n}&timestamps=1`);
    if (res.statusCode === 404) throw Object.assign(new Error('Container not found'), { status: 404 });
    if (res.statusCode === 403) throw Object.assign(new Error('Blocked by Docker socket proxy'), { status: 403 });
    if (res.statusCode !== 200) throw new Error(`Docker returned ${res.statusCode}`);
    return demuxDockerStream(res.data);
  },

  async restartContainer(containerId) {
    if (!isValidContainerId(containerId)) throw Object.assign(new Error('Invalid container id'), { status: 400 });
    const res = await dockerRequest(`/containers/${encodeURIComponent(containerId)}/restart?t=10`, 'POST');
    if (res.statusCode === 204) return { success: true, message: `Container ${containerId} restarted` };
    if (res.statusCode === 404) throw Object.assign(new Error('Container not found'), { status: 404 });
    if (res.statusCode === 403) throw Object.assign(new Error('Blocked by Docker socket proxy'), { status: 403 });
    throw new Error(`Docker returned ${res.statusCode}`);
  },
};
