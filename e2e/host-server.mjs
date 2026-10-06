// Minimal third-party "customer website" used by the widget end-to-end tests.
// Serves a page on its own origin that embeds the Tikket widget loader.
// Usage: TIKKET_URL=http://localhost:4173 PORT=4300 node e2e/host-server.mjs
import http from 'node:http';

const tikket = process.env.TIKKET_URL ?? 'http://localhost:4173';
const port = Number(process.env.PORT ?? 4300);
const project = process.env.WIDGET_PROJECT ?? 'SPL';

const page = (key) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spool – Shows</title></head>
<body style="font-family:system-ui;margin:2rem">
<h1>Spool</h1><p>A customer website embedding the Tikket feedback widget.</p>
<form><label>Secret field <input name="secret" value="do-not-collect"></label></form>
<script src="${tikket}/widget.js" data-project="${key}" async></script>
</body></html>`;

http
	.createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://localhost:${port}`);
		if (url.pathname === '/health') return res.end('ok');
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(page(url.searchParams.get('project') ?? project));
	})
	.listen(port, '127.0.0.1', () => console.log(`host page on http://127.0.0.1:${port}`));
