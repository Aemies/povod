// Запуск прокси как обычного сервера: node proxy/server.js (порт PORT, по умолчанию 8787).
// Подходит для проверки на своём компьютере или для любого сервера с Node.js 22.
'use strict';
const http = require('node:http');
const { handle } = require('./index.js');

const port = Number(process.env.PORT || 8787);
http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      const out = await handle({ method: req.method, headers, body: Buffer.concat(chunks).toString('utf8'), ip: req.socket.remoteAddress || 'unknown' });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    });
  })
  .listen(port, () => console.log(`Прокси «Повода» слушает http://localhost:${port}`));
