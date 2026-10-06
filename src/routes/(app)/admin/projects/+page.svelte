<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import { projectPath } from '$lib/shared/format';

	let { data } = $props();
</script>

<div class="grid gap-4">
	<div class="flex justify-end"><Button href="/projects/new"><Plus /> New project</Button></div>
	<div class="relative overflow-x-auto rounded-xl border border-border bg-surface">
		<table class="w-full text-sm">
			<thead class="border-b border-border text-left text-xs text-muted-foreground">
				<tr
					><th class="px-4 py-2.5 font-medium">Project</th><th class="px-4 py-2.5 font-medium"
						>Owners</th
					><th class="hidden px-4 py-2.5 font-medium sm:table-cell">Members</th><th
						class="hidden px-4 py-2.5 font-medium sm:table-cell">Tickets</th
					><th class="px-4 py-2.5 font-medium">State</th><th class="px-4 py-2.5"
						><span class="sr-only">Actions</span></th
					></tr
				>
			</thead>
			<tbody class="divide-y divide-border">
				{#each data.projects as p (p.id)}
					<tr class="hover:bg-hover">
						<td class="px-4 py-2.5"
							><a href={projectPath(p.key)} class="flex items-center gap-2.5 font-medium"
								><ProjectIcon project={p} />{p.name}<span
									class="font-mono text-xs font-normal text-muted-foreground">{p.key}</span
								></a
							></td
						>
						<td class="px-4 py-2.5 text-muted-foreground">{p.owners.join(', ') || '—'}</td>
						<td class="hidden px-4 py-2.5 tabular-nums sm:table-cell">{p.members}</td>
						<td class="hidden px-4 py-2.5 tabular-nums sm:table-cell"
							>{p.openCount} open / {p.totalCount}</td
						>
						<td class="px-4 py-2.5">
							<div class="flex flex-wrap gap-1">
								<Badge>{p.visibility === 'public' ? 'Public' : 'Private'}</Badge>
								{#if p.archivedAt}<Badge variant="muted">Archived</Badge>{/if}
							</div>
						</td>
						<td class="px-4 py-2.5 text-right"
							><Button href={projectPath(p.key, 'settings')} size="xs" variant="outline"
								>Manage</Button
							></td
						>
					</tr>
				{:else}
					<tr
						><td colspan="6" class="px-4 py-8 text-center text-muted-foreground"
							>No projects yet.</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
</div>
