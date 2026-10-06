<script lang="ts">
	import { enhance } from '$app/forms';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import { PROJECT_ROLE_META } from '$lib/shared/constants';
	import { formatDate } from '$lib/shared/format';

	let { data } = $props();
	const state = (i: (typeof data.invitations)[number]) =>
		i.usedAt
			? 'Accepted'
			: i.revokedAt
				? 'Revoked'
				: new Date(i.expiresAt) < new Date()
					? 'Expired'
					: 'Pending';
</script>

<div class="grid gap-4">
	<p class="text-sm text-muted-foreground">
		Create invitations from <a href="/admin/users" class="text-primary hover:underline">Users</a> or a
		project’s settings. Links are shown only once when created.
	</p>
	<div class="relative overflow-x-auto rounded-xl border border-border bg-surface">
		<table class="w-full text-sm">
			<thead class="border-b border-border text-left text-xs text-muted-foreground">
				<tr
					><th class="px-4 py-2.5 font-medium">Recipient</th><th class="px-4 py-2.5 font-medium"
						>Grants</th
					><th class="hidden px-4 py-2.5 font-medium md:table-cell">Created by</th><th
						class="px-4 py-2.5 font-medium">Status</th
					><th class="px-4 py-2.5"><span class="sr-only">Actions</span></th></tr
				>
			</thead>
			<tbody class="divide-y divide-border">
				{#each data.invitations as i (i.id)}
					{@const s = state(i)}
					<tr>
						<td class="px-4 py-2.5">{i.email ?? 'Anyone with the link'}</td>
						<td class="px-4 py-2.5 text-muted-foreground"
							>{i.role === 'admin' ? 'Administrator' : 'User'}{#if i.projectName}
								· {PROJECT_ROLE_META[i.projectRole ?? 'member'].label} of {i.projectName}{/if}</td
						>
						<td class="hidden px-4 py-2.5 text-muted-foreground md:table-cell"
							>{i.creatorName} · {formatDate(i.createdAt)}</td
						>
						<td class="px-4 py-2.5"
							><Badge variant={s === 'Pending' ? 'solid' : 'outline'}
								>{s}{#if s === 'Accepted' && i.usedByName}
									by {i.usedByName}{/if}</Badge
							></td
						>
						<td class="px-4 py-2.5 text-right">
							{#if s === 'Pending'}
								<form
									method="POST"
									action="?/revoke"
									use:enhance={quickSubmit({ success: 'Invitation revoked' })}
								>
									<input type="hidden" name="invitationId" value={i.id} /><Button
										type="submit"
										size="xs"
										variant="ghost">Revoke</Button
									>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr
						><td colspan="5" class="px-4 py-8 text-center text-muted-foreground"
							>No invitations yet.</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
</div>
