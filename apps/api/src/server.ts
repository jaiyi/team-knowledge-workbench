import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type ApiHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

const healthResponse = JSON.stringify({ status: 'ok' });

const requestHandler = (request: IncomingMessage, response: ServerResponse): void => {
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(healthResponse);
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'not_found' }));
};

export const createApiServer = (identity?: ApiHandler) => createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    requestHandler(request, response);
    return;
  }
  try {
    if (identity && await identity(request, response)) return;
    requestHandler(request, response);
  } catch {
    if (!response.headersSent) response.writeHead(503, { 'cache-control': 'no-store', 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'unavailable' }));
  }
});

const port = Number(process.env.PORT ?? 3000);

if (process.argv[1]?.endsWith('/apps/api/src/server.ts')) {
  createApiServer().listen(port, () => {
    process.stdout.write(`API listening on ${port}\n`);
  });
}
