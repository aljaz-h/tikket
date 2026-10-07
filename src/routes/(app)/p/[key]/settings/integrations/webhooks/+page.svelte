<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import HookManager from '$lib/components/integrations/HookManager.svelte';
	import IntegrationBack from '$lib/components/integrations/IntegrationBack.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { WEBHOOK_EVENT_META, WEBHOOK_EVENTS } from '$lib/shared/constants';

	let { data, form } = $props();
	const verify = `// Node.js – verify a Tikket webhook (raw request body!)
import crypto from 'node:crypto';

function verify(rawBody, headers, secret) {
  const timestamp = Number(headers['tikket-timestamp']);
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false; // replay window
  const expected = 'v1=' + crypto
    .createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex');
  const given = headers['tikket-signature'] ?? '';
  return given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}`;
	async function copy() {
		try {
			await navigator.clipboard.writeText(verify);
			toast.success('Example copied');
		} catch {
			toast.error('Copy failed – select the code manually');
		}
	}
</script>

<IntegrationBack project={data.project.key} title="Webhooks" />
<HookManager
	kind="webhook"
	hooks={data.hooks}
	events={WEBHOOK_EVENTS}
	eventLabels={WEBHOOK_EVENT_META}
	defaultEvents={['ticket.created', 'ticket.status_changed']}
	encryptionAvailable={data.encryptionAvailable}
	archived={data.archived}
	{form}
	noun="webhook"
	urlLabel="Endpoint URL"
	urlPlaceholder="https://automation.example.com/hooks/tikket"
	urlHint={data.privateNetworksAllowed
		? 'Any http(s) URL. The administrator allowed private network destinations.'
		: 'A public http(s) address. Private, loopback and cloud-metadata addresses are refused.'}
>
	{#snippet intro()}
		<div>
			<h2 class="text-base font-semibold">Webhooks</h2>
			<p class="text-sm text-muted-foreground">
				Send signed JSON events to your own automation. Each request is a POST with a versioned
				envelope (<code class="text-xs">version: "1"</code>). Failed deliveries (timeouts, 429, 5xx)
				are retried with increasing delays; other 4xx answers are not retried. Redirects are not
				followed. Internal notes are never sent.
			</p>
		</div>
		<details class="group rounded-lg border border-border">
			<summary
				class="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden"
			>
				<ChevronDown class="size-4 transition-transform group-open:rotate-180" /> Advanced: verifying
				signatures
			</summary>
			<div class="grid gap-3 border-t border-border p-3 text-sm text-muted-foreground">
				<p>
					Every request carries <code class="text-xs">Tikket-Event</code>,
					<code class="text-xs">Tikket-Delivery</code> (the event id – the same for retries, use it
					to ignore duplicates), <code class="text-xs">Tikket-Timestamp</code> and
					<code class="text-xs">Tikket-Signature: v1=&lt;hex&gt;</code>, an HMAC-SHA256 of
					<code class="text-xs">timestamp + "." + body</code> with the webhook's signing secret. Reject
					requests older than five minutes.
				</p>
				<div class="relative">
					<pre
						class="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 pr-12 text-xs text-foreground"><code
							>{verify}</code
						></pre>
					<Button
						variant="ghost"
						size="icon-sm"
						class="absolute top-1.5 right-1.5"
						onclick={copy}
						aria-label="Copy verification example"><Copy /></Button
					>
				</div>
				<p>Full payload reference: docs/webhooks.md.</p>
			</div>
		</details>
	{/snippet}
</HookManager>
