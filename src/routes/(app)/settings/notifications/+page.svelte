<script lang="ts">
	import { enhance } from '$app/forms';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import { NOTIFICATION_PREF_META, NOTIFICATION_TYPES } from '$lib/shared/constants';

	let { data } = $props();
</script>

<Card class="p-5 sm:p-6">
	<h2 class="text-base font-semibold">In-app notifications</h2>
	<p class="text-sm text-muted-foreground">
		Choose what appears under the bell. You automatically follow tickets you create or comment on.
	</p>
	<form
		method="POST"
		class="mt-5 grid gap-4"
		use:enhance={quickSubmit({ success: 'Preferences saved' })}
	>
		{#each NOTIFICATION_TYPES as type (type)}
			<label class="flex items-start gap-3">
				<Switch name={type} checked={data.prefs[type]} class="mt-0.5" />
				<span>
					<span class="block text-sm font-medium">{NOTIFICATION_PREF_META[type].label}</span>
					<span class="block text-xs text-muted-foreground"
						>{NOTIFICATION_PREF_META[type].hint}</span
					>
				</span>
			</label>
		{/each}
		<div class="flex justify-end border-t border-border pt-4">
			<Button type="submit">Save preferences</Button>
		</div>
	</form>
</Card>
