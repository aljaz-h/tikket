<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
</script>

<Card class="grid gap-4 p-5 sm:p-6">
	<div>
		<h2 class="text-base font-semibold">Export your submissions</h2>
		<p class="text-sm text-muted-foreground">
			Download the tickets you reported and the comments you wrote, in projects you can still
			access. The JSON file contains everything; the CSV lists your tickets for spreadsheets.
		</p>
	</div>
	<div class="flex flex-wrap justify-end gap-2">
		<Button variant="outline" href="/settings/data/download?format=csv" download
			><Download /> Download CSV</Button
		>
		<Button href="/settings/data/download?format=json" download><Download /> Download JSON</Button>
	</div>
</Card>
