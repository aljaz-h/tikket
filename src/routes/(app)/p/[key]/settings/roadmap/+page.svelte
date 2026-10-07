<script lang="ts">
	import { enhance } from '$app/forms';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import {
		ROADMAP_AUDIENCE_LABEL,
		ROADMAP_AUDIENCES,
		type RoadmapAudience
	} from '$lib/shared/constants';
	import { projectPath } from '$lib/shared/format';

	let { data } = $props();
	let audience = $state<RoadmapAudience>('viewers');
	let showReleases = $state(false);
	let showReleaseDates = $state(false);
	let showMilestones = $state(false);
	let showPriorities = $state(false);
	let showVotes = $state(true);
	let showAssignees = $state(false);
	$effect.pre(() => {
		const s = data.settings;
		audience = s.audience;
		showReleases = s.showReleases;
		showReleaseDates = s.showReleaseDates;
		showMilestones = s.showMilestones;
		showPriorities = s.showPriorities;
		showVotes = s.showVotes;
		showAssignees = s.showAssignees;
	});
	const audienceHint: Record<RoadmapAudience, string> = {
		staff: 'Only owners, moderators and administrators see the Roadmap tab.',
		members: 'Project members and staff see the roadmap; other visitors don’t see the tab.',
		viewers:
			'Everyone who can open this project sees the roadmap (for public projects, every signed-in user – and visitors if anonymous reading is on).'
	};
	const toggles = $derived([
		{
			name: 'showVotes',
			label: 'Vote counts',
			hint: data.votingEnabled
				? 'How many people want each item.'
				: 'Voting is off for this project.',
			get: () => showVotes,
			set: (v: boolean) => (showVotes = v)
		},
		{
			name: 'showPriorities',
			label: 'Ticket priorities',
			hint: 'Low, Medium, High or Critical on each item.',
			get: () => showPriorities,
			set: (v: boolean) => (showPriorities = v)
		},
		{
			name: 'showAssignees',
			label: 'Assignees',
			hint: 'Who is working on an item.',
			get: () => showAssignees,
			set: (v: boolean) => (showAssignees = v)
		},
		{
			name: 'showReleases',
			label: 'Planned releases',
			hint: 'Upcoming releases with their progress, and the target release of each item.',
			get: () => showReleases,
			set: (v: boolean) => {
				showReleases = v;
				if (!v) showReleaseDates = false;
			}
		},
		{
			name: 'showReleaseDates',
			label: 'Target dates',
			hint: 'Target dates of releases and milestones. Requires planned releases.',
			disabled: !showReleases,
			get: () => showReleaseDates,
			set: (v: boolean) => (showReleaseDates = v)
		},
		{
			name: 'showMilestones',
			label: 'Milestones',
			hint: 'Active milestones with their progress, and the milestone of each item.',
			get: () => showMilestones,
			set: (v: boolean) => (showMilestones = v)
		}
	]);
</script>

<Card class="p-5 sm:p-6">
	<h2 class="text-base font-semibold">Roadmap visibility</h2>
	<p class="mb-5 text-sm text-muted-foreground">
		The roadmap groups tickets into Planned, In Progress and Recently completed. Choose who can see
		it and which planning details are included. Staff always see everything; hidden details are
		never sent to other visitors.
	</p>
	<form
		method="POST"
		class="grid gap-6"
		use:enhance={quickSubmit({ success: 'Roadmap visibility saved' })}
	>
		<Field label="Who can see the roadmap" for="audience" hint={audienceHint[audience]}>
			<Select
				id="audience"
				name="audience"
				bind:value={audience}
				items={ROADMAP_AUDIENCES.map((a) => ({ value: a, label: ROADMAP_AUDIENCE_LABEL[a] }))}
			/>
		</Field>
		<fieldset class="grid gap-4">
			<legend class="mb-3 text-sm font-medium">
				Show to {audience === 'members' ? 'project members' : 'visitors'}
				{#if audience === 'staff'}<span class="font-normal text-muted-foreground"
						>– only staff can see the roadmap</span
					>{/if}
			</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				{#each toggles as t (t.name)}
					<label
						class="flex items-start gap-3"
						class:opacity-60={t.disabled || audience === 'staff'}
					>
						<Switch
							name={t.name}
							checked={t.get()}
							onchange={(e) => t.set(e.currentTarget.checked)}
							disabled={t.disabled}
							class="mt-0.5"
						/>
						<span>
							<span class="block text-sm font-medium">{t.label}</span>
							<span class="block text-xs text-muted-foreground">{t.hint}</span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>
		<div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
			<a href={projectPath(data.project.key, 'roadmap')} class="text-sm text-link hover:underline"
				>Open the roadmap</a
			>
			<Button type="submit">Save visibility</Button>
		</div>
	</form>
</Card>
