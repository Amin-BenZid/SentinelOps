import http from 'http';

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

/**
 * Executes raw HTTP request over Docker UNIX domain socket
 */
function dockerRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: DOCKER_SOCKET,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: buffer
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Strips Docker's 8-byte multiplex header (stream type + 4-byte size)
 * from stdout/stderr chunks to yield human-readable text.
 */
function demuxDockerStream(buffer) {
  let offset = 0;
  const lines = [];

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      // Non-multiplexed raw stream fallback
      lines.push(buffer.subarray(offset).toString('utf-8'));
      break;
    }

    // Bytes 4-7 contain big-endian frame size
    const frameSize = buffer.readUInt32BE(offset + 4);
    const content = buffer.subarray(offset + 8, offset + 8 + frameSize).toString('utf-8');
    lines.push(content);
    offset += 8 + frameSize;
  }

  return lines.join('');
}

export const dockerService = {
  /**
   * Fetches the last N lines of stdout and stderr
   */
  async getLogs(containerId, tail = 100) {
    try {
      const res = await dockerRequest(`/containers/${encodeURIComponent(containerId)}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`);
      if (res.statusCode === 404) {
        throw new Error('Container not found or not running');
      }
      return demuxDockerStream(res.data);
    } catch (err) {
      throw new Error(`Failed to read container logs: ${err.message}`);
    }
  },

  /**
   * Restarts the specified container with a 10s grace timeout
   */
  async restartContainer(containerId) {
    try {
      const res = await dockerRequest(`/containers/${encodeURIComponent(containerId)}/restart?t=10`, 'POST');
      if (res.statusCode === 204) {
        return { success: true, message: `Container ${containerId} restarted successfully` };
      }
      if (res.statusCode === 404) {
        throw new Error('Container not found');
      }
      throw new Error(`Docker returned status ${res.statusCode}`);
    } catch (err) {
      throw new Error(`Failed to restart container: ${err.message}`);
    }
  },

  /**
   * Inspects detailed container state
   */
  async inspect(containerId) {
    try {
      const res = await dockerRequest(`/containers/${encodeURIComponent(containerId)}/json`);
      if (res.statusCode === 200) {
        const parsed = JSON.parse(res.data.toString('utf-8'));
        return {
          id: parsed.Id?.slice(0, 12),
          name: parsed.Name?.replace(/^\//, ''),
          status: parsed.State?.Status,
          running: parsed.State?.Running,
          startedAt: parsed.State?.StartedAt,
          image: parsed.Config?.Image
        };
      }
      throw new Error('Container inspect failed');
    } catch (err) {
      return null;
    }
  }
};