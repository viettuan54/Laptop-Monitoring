const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.WEB_PORT || 5173);
const API_TARGET = new URL(process.env.API_TARGET || 'http://localhost:3000');
const ROOT = __dirname;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

const staticSecurityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
};

function proxyApi(req, res) {
  const transport = API_TARGET.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: API_TARGET.host };
  delete headers.origin;

  const proxy = transport.request(
    {
      protocol: API_TARGET.protocol,
      hostname: API_TARGET.hostname,
      port: API_TARGET.port || (API_TARGET.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: `${API_TARGET.pathname.replace(/\/$/, '')}${req.url}`,
      headers,
    },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    }
  );

  proxy.on('error', (error) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        message: 'Không thể kết nối đến backend',
        detail: error.message,
      })
    );
  });
  req.pipe(proxy);
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(req.url.split('?')[0]);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT, relativePath);

  if (!resolved.startsWith(`${path.resolve(ROOT)}${path.sep}`) && resolved !== path.resolve(ROOT, 'index.html')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(resolved, (statError, stat) => {
    const isFile = !statError && stat.isFile();
    if (!isFile && path.extname(relativePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const filePath = isFile ? resolved : path.join(ROOT, 'index.html');
    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-store' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        ...staticSecurityHeaders,
      });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ status: 'ok', api_target: API_TARGET.origin }));
  }
  if (req.url.startsWith('/api/')) return proxyApi(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SafeNest dashboard: http://localhost:${PORT}`);
  console.log(`API proxy target: ${API_TARGET.origin}`);
});
