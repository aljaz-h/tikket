<script lang="ts">
	import HookManager from '$lib/components/integrations/HookManager.svelte';
	import IntegrationBack from '$lib/components/integrations/IntegrationBack.svelte';
	import { DISCORD_EVENT_META, DISCORD_EVENTS } from '$lib/shared/constants';

	let { data, form } = $props();
</script>

<IntegrationBack project={data.project.key} title="Discord" />
<HookManager
	kind="discord"
	hooks={data.hooks}
	events={DISCORD_EVENTS}
	eventLabels={DISCORD_EVENT_META}
	defaultEvents={['new_ticket', 'completed', 'release_published']}
	encryptionAvailable={data.encryptionAvailable}
	archived={data.archived}
	{form}
	noun="Discord webhook"
	urlLabel="Discord webhook URL"
	urlPlaceholder="https://discord.com/api/webhooks/…"
	urlHint="In Discord: Channel settings → Integrations → Webhooks → New webhook → Copy webhook URL. The URL is a secret: it is stored encrypted and never shown again."
>
	{#snippet intro()}
		<div>
			<h2 class="text-base font-semibold">Discord notifications</h2>
			<p class="text-sm text-muted-foreground">
				Post compact messages to Discord channels when tickets are created, change status or are
				completed, and when releases are published. Internal notes are never sent, long text is
				shortened and @mentions in user text never ping anyone.
			</p>
		</div>
	{/snippet}
</HookManager>
