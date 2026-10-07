// Minimal third-party "customer website" used by the widget end-to-end tests.
// Serves a page on its own origin that embeds the Tikket widget loader.
// Also a local mock webhook receiver (POST /hook, GET /hook/log) and a tiny SMTP sink
// (port SMTP_PORT, GET /smtp/log) for the integration tests – never real services.
// Usage: TIKKET_URL=http://localhost:4173 PORT=4300 node e2e/host-server.mjs
import http from 'node:http';
import net from 'node:net';

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

const hooks = [];
const mails = [];

http
	.createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://localhost:${port}`);
		if (url.pathname === '/health') return res.end('ok');
		if (url.pathname === '/hook' && req.method === 'POST') {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				hooks.push({ headers: req.headers, body });
				res.writeHead(204).end();
			});
			return;
		}
		if (url.pathname === '/hook/log') {
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(JSON.stringify(hooks));
		}
		if (url.pathname === '/smtp/log') {
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(JSON.stringify(mails));
		}
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(page(url.searchParams.get('project') ?? project));
	})
	.listen(port, '127.0.0.1', () => console.log(`host page on http://127.0.0.1:${port}`));

// Minimal SMTP sink: accepts every message without TLS or authentication.
const smtpPort = Number(process.env.SMTP_PORT ?? 2525);
net
	.createServer((socket) => {
		let data = null;
		let buffer = '';
		const mail = { from: '', to: [], raw: '' };
		socket.write('220 sink ESMTP\r\n');
		socket.on('data', (chunk) => {
			buffer += chunk.toString('utf8');
			let i;
			while (true) {
				if (data !== null) {
					i = buffer.indexOf('\r\n.\r\n');
					if (i < 0) return;
					mail.raw = data + buffer.slice(0, i);
					mails.push({ ...mail });
					buffer = buffer.slice(i + 5);
					data = null;
					socket.write('250 OK queued\r\n');
					continue;
				}
				i = buffer.indexOf('\r\n');
				if (i < 0) return;
				const line = buffer.slice(0, i);
				buffer = buffer.slice(i + 2);
				const cmd = line.slice(0, 4).toUpperCase();
				if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-sink\r\n250 8BITMIME\r\n');
				else if (cmd === 'MAIL') {
					mail.from = line;
					socket.write('250 OK\r\n');
				} else if (cmd === 'RCPT') {
					mail.to.push(line);
					socket.write('250 OK\r\n');
				} else if (cmd === 'DATA') {
					data = '';
					socket.write('354 go ahead\r\n');
				} else if (cmd === 'QUIT') socket.end('221 bye\r\n');
				else socket.write('250 OK\r\n');
			}
		});
	})
	.listen(smtpPort, '127.0.0.1');
