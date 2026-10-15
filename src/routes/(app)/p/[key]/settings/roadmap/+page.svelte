<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import {
		ROADMAP_IMAGE_LAYOUTS,
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
	let showOpen = $state(false);
	let imagePublic = $state(false);
	let imageLayout = $state<'full' | 'compact'>('full');
	let imageShowLogo = $state(true);
	let imageShowTimestamp = $state(true);
	$effect.pre(() => {
		const s = data.settings;
		audience = s.audience;
		showReleases = s.showReleases;
		showReleaseDates = s.showReleaseDates;
		showMilestones = s.showMilestones;
		showPriorities = s.showPriorities;
		showVotes = s.showVotes;
		showAssignees = s.showAssignees;
		showOpen = s.showOpen;
		imagePublic = s.image.public;
		imageLayout = s.image.layout;
		imageShowLogo = s.image.showLogo;
		imageShowTimestamp = s.image.showTimestamp;
	});
	// The image only exists for a roadmap that anonymous visitors can open.
	const imageAvailable = $derived(audience === 'viewers' && data.projectIsPublic);
	const imageUrl = $derived(`${data.baseUrl}/public/projects/${data.project.key}/roadmap.png`);
	const roadmapUrl = $derived(`${data.baseUrl}/p/${data.project.key}/roadmap`);
	const markdown = $derived(`![${data.project.name} roadmap](${imageUrl})`);
	const linkedMarkdown = $derived(`[![${data.project.name} roadmap](${imageUrl})](${roadmapUrl})`);
	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${what} copied`);
		} catch {
			toast.error('Could not copy to the clipboard');
		}
	}
	const audienceHint: Record<RoadmapAudience, string> = {
		staff: 'Only owners, moderators and administrators see the Roadmap tab.',
		members: 'Project members and staff see the roadmap; other visitors don’t see the tab.',
		viewers:
			'Everyone who can open this project sees the roadmap (for public projects, every signed-in user – and visitors if anonymous reading is on).'
	};
	const toggles = $derived([
		{
			name: 'showOpen',
			label: 'Open / Unplanned column',
			hint: 'Tickets that are Open and not yet planned. Staff always see this column.',
			get: () => showOpen,
			set: (v: boolean) => (showOpen = v)
		},
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
		The roadmap groups tickets into Open / Unplanned, Planned, In Progress and Recently completed.
		Choose who can see it and which planning details are included. Staff always see everything;
		hidden details are never sent to other visitors.
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
		<fieldset class="grid gap-4 border-t border-border pt-5" aria-labelledby="image-legend">
			<div>
				<legend id="image-legend" class="text-sm font-semibold">Shareable roadmap image</legend>
				<p class="text-xs text-muted-foreground">
					Staff can always download the roadmap as a PNG from the roadmap page. Switch the public
					image on to embed an always-current picture in a README, website or forum. It shows
					exactly what anonymous visitors see on the roadmap above – never internal notes, comments
					or staff-only details.
				</p>
			</div>
			<label class="flex items-start gap-3" class:opacity-60={!imageAvailable}>
				<Switch
					name="imagePublic"
					checked={imagePublic && imageAvailable}
					onchange={(e) => (imagePublic = e.currentTarget.checked)}
					disabled={!imageAvailable}
					class="mt-0.5"
				/>
				<span>
					<span class="block text-sm font-medium">Allow public roadmap image</span>
					<span class="block text-xs text-muted-foreground">
						{#if imageAvailable}
							Anyone with the link can load the image. Off by default.
						{:else}
							Needs a public project and the roadmap set to “Anyone who can view the project”.
						{/if}
					</span>
				</span>
			</label>
			<div class="grid gap-4 sm:grid-cols-2">
				<Field label="Layout" for="imageLayout" hint="Compact shows fewer lines per card.">
					<Select
						id="imageLayout"
						name="imageLayout"
						bind:value={imageLayout}
						items={ROADMAP_IMAGE_LAYOUTS.map((l) => ({
							value: l,
							label: l === 'full' ? 'Full' : 'Compact'
						}))}
					/>
				</Field>
				<div class="grid content-start gap-3">
					<label class="flex items-center gap-3">
						<Switch
							name="imageShowLogo"
							checked={imageShowLogo}
							onchange={(e) => (imageShowLogo = e.currentTarget.checked)}
						/>
						<span class="text-sm">Show project logo</span>
					</label>
					<label class="flex items-center gap-3">
						<Switch
							name="imageShowTimestamp"
							checked={imageShowTimestamp}
							onchange={(e) => (imageShowTimestamp = e.currentTarget.checked)}
						/>
						<span class="text-sm">Show updated date</span>
					</label>
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				Vote counts and releases in the image follow the visibility switches above.
			</p>
			{#if data.imageLive}
				<div class="grid gap-3 rounded-lg border border-border bg-surface-2 p-3">
					<p class="text-xs font-medium">Live image: <span class="font-mono">{imageUrl}</span></p>
					{#each [{ label: 'Markdown', text: markdown }, { label: 'Linked Markdown', text: linkedMarkdown }] as snippet (snippet.label)}
						<div class="grid gap-1">
							<span class="text-xs text-muted-foreground">{snippet.label}</span>
							<div class="flex items-start gap-2">
								<code
									class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs [overflow-wrap:anywhere]"
									>{snippet.text}</code
								>
								<Button
									type="button"
									size="icon-sm"
									variant="outline"
									aria-label="Copy {snippet.label}"
									onclick={() => copy(snippet.text, snippet.label)}><Copy /></Button
								>
							</div>
						</div>
					{/each}
					<p class="text-xs text-muted-foreground">
						The image updates when the roadmap changes. GitHub and other sites cache remote images
						and may take a while to show the new version.
					</p>
				</div>
			{/if}
		</fieldset>
		<div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
			<a href={projectPath(data.project.key, 'roadmap')} class="text-sm text-link hover:underline"
				>Open the roadmap</a
			>
			<Button type="submit">Save visibility</Button>
		</div>
	</form>
</Card>
