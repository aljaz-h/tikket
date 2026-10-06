import type { RequestHandler } from './$types';

/**
 * Feedback widget loader. Tiny, dependency-free script embedded on third-party sites:
 *
 *   <script src="https://tikket.example.com/widget.js" data-project="SPL" async></script>
 *
 * It renders a button inside a shadow root (style isolation) and opens Tikket's own form in a sandboxed,
 * origin-restricted iframe. It never handles credentials: authentication happens inside the iframe
 * (Tikket's origin) via a first-party popup. Messages are exchanged with postMessage using exact
 * origins on both sides.
 */
const LOADER = String.raw`(function () {
	'use strict';
	var script = document.currentScript;
	if (!script) return;
	var base;
	try { base = new URL(script.src).origin; } catch (e) { return; }
	var key = (script.getAttribute('data-project') || '').toUpperCase();
	if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) { console.warn('[tikket] data-project is missing or invalid'); return; }
	var registry = (window.__tikketWidgets = window.__tikketWidgets || {});
	if (registry[key]) return;
	registry[key] = true;

	fetch(base + '/api/widget/' + key + '/config', { mode: 'cors', credentials: 'omit' })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (cfg) { if (cfg && cfg.enabled) mount(cfg); })
		.catch(function () {});

	function mount(cfg) {
		var color = /^#[0-9a-f]{6}$/i.test(cfg.accentColor) ? cfg.accentColor : '#6c68ee';
		var pos = String(cfg.position || 'bottom-right').split('-');
		var host = document.createElement('div');
		host.setAttribute('data-tikket-widget', key);
		var root = host.attachShadow({ mode: 'open' });
		var v = pos[0] === 'top' ? 'top' : 'bottom';
		var h = pos[1] === 'left' ? 'left' : 'right';
		root.innerHTML =
			'<style>' +
			':host{all:initial}' +
			'.btn{position:fixed;' + v + ':20px;' + h + ':20px;z-index:2147483646;display:flex;align-items:center;gap:8px;' +
			'padding:10px 16px;border:0;border-radius:999px;background:' + color + ';color:#fff;font:600 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;' +
			'box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}' +
			'.btn:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 6px ' + color + '}' +
			'.panel{position:fixed;' + v + ':76px;' + h + ':20px;z-index:2147483647;width:380px;height:min(620px,calc(100vh - 100px));' +
			'border:0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);background:#16171a;overflow:hidden;display:none}' +
			'.panel.open{display:block}' +
			'iframe{width:100%;height:100%;border:0;display:block;color-scheme:normal}' +
			'@media (max-width:480px){.panel{inset:0;width:100%;height:100%;border-radius:0}}' +
			'@media (prefers-reduced-motion:no-preference){.btn{transition:transform .15s}.btn:hover{transform:translateY(-1px)}}' +
			'</style>' +
			'<button class="btn" type="button" aria-haspopup="dialog" aria-expanded="false">' +
			'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
			'<span></span></button><div class="panel" role="dialog" aria-label="Feedback"></div>';
		var btn = root.querySelector('.btn');
		var panel = root.querySelector('.panel');
		btn.querySelector('span').textContent = String(cfg.buttonLabel || 'Feedback').slice(0, 30);
		var frame = null;

		function context() {
			return {
				pageUrl: location.origin + location.pathname,
				pageTitle: document.title.slice(0, 200),
				userAgent: navigator.userAgent,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				capturedAt: new Date().toISOString()
			};
		}
		function open() {
			if (!frame) {
				frame = document.createElement('iframe');
				frame.title = 'Send feedback';
				frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
				frame.src = base + '/embed/' + key + '?host=' + encodeURIComponent(location.origin);
				panel.appendChild(frame);
			}
			panel.classList.add('open');
			btn.setAttribute('aria-expanded', 'true');
			frame.focus();
		}
		function close() {
			panel.classList.remove('open');
			btn.setAttribute('aria-expanded', 'false');
			btn.focus();
		}
		btn.addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
		document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) close(); });
		window.addEventListener('message', function (e) {
			// Only our own iframe, from Tikket's exact origin.
			if (!frame || e.source !== frame.contentWindow || e.origin !== base) return;
			var d = e.data || {};
			if (d.type === 'tikket:ready') {
				frame.contentWindow.postMessage({ type: 'tikket:context', context: cfg.collectContext ? context() : null }, base);
			} else if (d.type === 'tikket:close') {
				close();
			}
		});
		(document.body || document.documentElement).appendChild(host);
	}
})();
`;

export const GET: RequestHandler = async () =>
	new Response(LOADER, {
		headers: {
			'content-type': 'text/javascript; charset=utf-8',
			'cache-control': 'public, max-age=3600',
			// Must be loadable from other sites (the rest of Tikket stays same-origin only).
			'cross-origin-resource-policy': 'cross-origin',
			'x-content-type-options': 'nosniff'
		}
	});
