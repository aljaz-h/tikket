<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Check from '@lucide/svelte/icons/check';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import History from '@lucide/svelte/icons/history';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import Send from '@lucide/svelte/icons/send';
	import ImageIcon from '@lucide/svelte/icons/image';
	import TicketFields, { type TicketDraft } from '$lib/components/TicketFields.svelte';
	import TemplateQuestions from '$lib/components/TemplateQuestions.svelte';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import Kbd from '$lib/components/ui/kbd.svelte';
	import { TYPE_ICONS, TYPE_TONES } from '$lib/components/icons';
	import {
		CONTEXT_FIELDS,
		TICKET_TYPES,
		TYPE_META,
		type TicketStatus,
		type TicketType
	} from '$lib/shared/constants';
	import { ticketPath, ticketRef } from '$lib/shared/format';
	import { cn } from '$lib/utils';

	let { data, form } = $props();

	const errors = $derived((form?.errors ?? {}) as Record<string, string>);

	let projectKey = $state('');
	let type = $state<TicketType | ''>('');
	let draft = $state<TicketDraft>({ title: '', description: '', context: {}, attachments: [] });
	let editorKey = $state(0);
	let pending = $state(false);
	let restored = $state(false);
	let mounted = $state(false);
	let formEl: HTMLFormElement | undefined = $state();
	let similar = $state<
		{ number: number; title: string; status: TicketStatus; voteCount: number }[]
	>([]);

	// Initial state from the URL or a failed submission (server-rendered, works without JS).
	$effect.pre(() => {
		if (mounted) return;
		const v = (form?.values ?? {}) as Record<string, string>;
		projectKey = v.project ?? data.preselected;
		type = (v.type as TicketType) || data.initialType || '';
		draft = {
			title: v.title ?? data.prefill.title,
			description: v.description ?? plainToHtml(data.prefill.description),
			context: Object.fromEntries(
				Object.entries(v)
					.filter(([k]) => k.startsWith('ctx_'))
					.map(([k, val]) => [k.slice(4), val])
			),
			attachments: (form?.attachments as TicketDraft['attachments']) ?? []
		};
	});

	const project = $derived(data.projects.find((p) => p.key === projectKey));

	// Custom ticket template for the chosen project and type (the default one unless picked).
	let templateId = $state<number | null>(null);
	let answers = $state<Record<string, string | boolean>>({});
	$effect.pre(() => {
		if (mounted) return;
		const v = (form?.values ?? {}) as Record<string, string>;
		templateId = Number(v.templateId) || null;
		answers = Object.fromEntries(
			Object.entries(v)
				.filter(([k]) => k.startsWith('tpl_'))
				.map(([k, val]) => [k, val === 'on' ? true : val])
		);
	});
	const templates = $derived(
		project && type ? project.templates.filter((t) => t.type === type) : []
	);
	const template = $derived(
		templates.find((t) => t.id === templateId) ??
			templates.find((t) => t.isDefault) ??
			templates[0] ??
			null
	);

	function plainToHtml(text: string) {
		if (!text) return '';
		const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return esc
			.split(/\n{2,}/)
			.map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
			.join('');
	}
	const projectLocked = $derived(
		!!data.preselected && data.projects.length > 0 && projectKey === data.preselected
	);
	let changingProject = $state(false);
	const limits = $derived({
		maxFiles: data.app.maxAttachments,
		maxSize: data.app.maxAttachmentSize,
		accept: data.app.allowedImageTypes
	});

	// ── Drafts (localStorage, scoped to user + project) ───────────────────
	const draftKey = (key: string) => `tikket:draft:${data.user?.id}:${key || 'none'}`;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function isEmpty(d: TicketDraft) {
		return (
			!d.title.trim() &&
			!d.description.replace(/<[^>]*>/g, '').trim() &&
			!d.attachments.length &&
			!Object.values(d.context).some(Boolean)
		);
	}

	function saveDraft() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			try {
				const key = draftKey(projectKey);
				if (isEmpty(draft)) localStorage.removeItem(key);
				else
					localStorage.setItem(
						key,
						JSON.stringify({ type, draft: $state.snapshot(draft), savedAt: Date.now() })
					);
			} catch {
				/* storage full or unavailable */
			}
		}, 400);
	}

	function loadDraft(key: string) {
		try {
			const raw = localStorage.getItem(draftKey(key));
			if (!raw) return false;
			const saved = JSON.parse(raw) as {
				type: TicketType | '';
				draft: TicketDraft;
				savedAt: number;
			};
			if (Date.now() - saved.savedAt > 30 * 24 * 60 * 60 * 1000) return false;
			draft = Object.assign(
				{ title: '', description: '', context: {}, attachments: [] },
				saved.draft
			);
			if (saved.type && TICKET_TYPES.includes(saved.type)) type = saved.type;
			editorKey++;
			return true;
		} catch {
			return false;
		}
	}

	function discardDraft() {
		try {
			localStorage.removeItem(draftKey(projectKey));
		} catch {
			/* ignore */
		}
		for (const a of draft.attachments) void fetch(`/api/uploads/${a.id}`, { method: 'DELETE' });
		draft = { title: '', description: '', context: {}, attachments: [] };
		editorKey++;
		restored = false;
	}

	onMount(() => {
		mounted = true;
		if (!form && projectKey) restored = loadDraft(projectKey);
	});

	function selectProject(key: string) {
		if (key === projectKey) return;
		if (!isEmpty(draft)) saveDraft();
		projectKey = key;
		changingProject = false;
		if (isEmpty(draft)) restored = loadDraft(key);
	}

	async function chooseType(next: TicketType) {
		type = next;
		saveDraft();
		await tick();
		document.getElementById('title')?.focus({ preventScroll: true });
		document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// ── Similar tickets (debounced, permission-aware endpoint) ─────────────
	let similarTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const title = draft.title.trim();
		const key = projectKey;
		const kind = type;
		// A few words of the description sharpen the match without sending the whole text.
		const text = draft.description
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 300);
		clearTimeout(similarTimer);
		if (!mounted || title.length < 5 || !key) {
			similar = [];
			return;
		}
		similarTimer = setTimeout(async () => {
			try {
				const res = await fetch(
					`/api/similar?project=${encodeURIComponent(key)}&q=${encodeURIComponent(title)}&text=${encodeURIComponent(text)}&type=${kind}`
				);
				if (res.ok) similar = (await res.json()).items;
			} catch {
				/* offline */
			}
		}, 400);
	});

	const contextFilled = $derived(
		type ? CONTEXT_FIELDS[type].filter((f) => draft.context[f.key]?.trim()).map((f) => f.label) : []
	);
	const descriptionFilled = $derived(!!draft.description.replace(/<[^>]*>/g, '').trim());
	const ready = $derived(
		!!project && !!type && draft.title.trim().length >= 4 && descriptionFilled
	);
</script>

<div class="mx-auto max-w-5xl">
	<div class="mb-6">
		<h1 class="text-xl font-semibold tracking-tight sm:text-2xl">New ticket</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Tell us what’s going on. Only a title and a short description are required.
		</p>
	</div>

	{#if !data.projects.length}
		<EmptyState
			icon={FolderKanban}
			title="No projects available"
			description="You are not a member of any project that accepts tickets yet. Ask a project owner to invite you."
		/>
	{:else}
		<form
			bind:this={formEl}
			method="POST"
			enctype="multipart/form-data"
			class="group/form grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]"
			use:enhance={() => {
				pending = true;
				return async ({ result, update }) => {
					pending = false;
					if (result.type === 'redirect') {
						try {
							localStorage.removeItem(draftKey(projectKey));
						} catch {
							/* ignore */
						}
						toast.success('Thanks! Your ticket was submitted.');
					} else if (result.type === 'failure') {
						toast.error('Please check the highlighted fields.');
					}
					await update({ reset: false });
					if (result.type === 'failure') editorKey++;
				};
			}}
		>
			<div class="grid min-w-0 grid-cols-1 content-start gap-6">
				<FormMessage message={errors.form} />

				<!-- Step 1: project -->
				<section aria-labelledby="step-project" class="grid gap-3">
					<h2 id="step-project" class="flex items-center gap-2 text-sm font-semibold">
						<span
							class="flex size-5 items-center justify-center rounded-full bg-primary-soft text-xs text-link"
							>1</span
						>
						Project
					</h2>
					{#if projectLocked && project && !changingProject}
						<input type="hidden" name="project" value={project.key} />
						<div
							class="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
						>
							<ProjectIcon {project} size="md" />
							<div class="min-w-0 flex-1">
								<p class="font-medium">{project.name}</p>
								<p class="truncate text-xs text-muted-foreground">
									{project.description ?? project.key}
								</p>
							</div>
							{#if data.projects.length > 1}
								<Button variant="ghost" size="sm" onclick={() => (changingProject = true)}
									>Change</Button
								>
							{/if}
						</div>
					{:else if data.projects.length <= 6}
						<div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Project">
							{#each data.projects as p (p.key)}
								<label
									class="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong has-[:checked]:border-primary-border has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
								>
									<input
										type="radio"
										name="project"
										value={p.key}
										checked={projectKey === p.key}
										onchange={() => selectProject(p.key)}
										class="sr-only"
										required
									/>
									<ProjectIcon project={p} size="md" />
									<span class="min-w-0 flex-1">
										<span class="block truncate font-medium">{p.name}</span>
										<span class="block truncate font-mono text-xs text-muted-foreground"
											>{p.key}</span
										>
									</span>
									{#if projectKey === p.key}<Check class="size-4 text-link" />{/if}
								</label>
							{/each}
						</div>
					{:else}
						<Select
							name="project"
							aria-label="Project"
							required
							placeholder="Choose a project…"
							searchable
							value={projectKey}
							onchange={(v) => selectProject(v)}
							items={data.projects.map((p) => ({ value: p.key, label: `${p.name} (${p.key})` }))}
						/>
					{/if}
					{#if errors.project}<p class="text-xs text-destructive" role="alert">
							{errors.project}
						</p>{/if}
				</section>

				<!-- Step 2: type -->
				<section aria-labelledby="step-type" class="grid gap-3">
					<h2 id="step-type" class="flex items-center gap-2 text-sm font-semibold">
						<span
							class="flex size-5 items-center justify-center rounded-full bg-primary-soft text-xs text-link"
							>2</span
						>
						What would you like to report?
					</h2>
					<div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Ticket type">
						{#each TICKET_TYPES as t (t)}
							{@const Icon = TYPE_ICONS[t]}
							<label
								class={cn(
									'flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-border-strong has-[:checked]:border-primary-border has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
									t === 'feedback' && 'sm:col-span-2 sm:py-2.5'
								)}
							>
								<input
									type="radio"
									name="type"
									value={t}
									checked={type === t}
									onchange={() => chooseType(t)}
									class="sr-only"
									required
								/>
								<span
									class={cn(
										'tone flex size-9 shrink-0 items-center justify-center rounded-lg border',
										TYPE_TONES[t],
										t === 'feedback' && 'size-7'
									)}
								>
									<Icon class={t === 'feedback' ? 'size-4' : 'size-[1.125rem]'} />
								</span>
								<span class="min-w-0">
									<span class="block font-medium">{TYPE_META[t].label}</span>
									<span class="block text-sm text-muted-foreground">{TYPE_META[t].tagline}</span>
								</span>
							</label>
						{/each}
					</div>
					{#if errors.type}<p class="text-xs text-destructive" role="alert">{errors.type}</p>{/if}
				</section>

				<!-- Step 3: details (revealed once a type is chosen; CSS-only so it also works without JS) -->
				<section
					id="details"
					aria-labelledby="step-details"
					class={cn(
						'min-w-0 scroll-mt-20 grid-cols-1 gap-3',
						type ? 'grid' : 'hidden group-has-[input[name=type]:checked]/form:grid'
					)}
				>
					<div class="flex items-center justify-between gap-2">
						<h2 id="step-details" class="flex items-center gap-2 text-sm font-semibold">
							<span
								class="flex size-5 items-center justify-center rounded-full bg-primary-soft text-xs text-link"
								>3</span
							>
							Describe it
						</h2>
						{#if restored}
							<span class="flex items-center gap-2 text-xs text-muted-foreground" role="status">
								<History class="size-3.5" /> Draft restored
								<button
									type="button"
									class="font-medium text-foreground underline-offset-2 hover:underline"
									onclick={discardDraft}>Discard</button
								>
							</span>
						{/if}
					</div>
					<Card class="p-4 sm:p-5">
						<TicketFields
							type={type || 'feedback'}
							bind:draft
							{errors}
							{editorKey}
							allowAttachments={project?.canAttach ?? true}
							{limits}
							onchange={saveDraft}
							onsubmitshortcut={() => formEl?.requestSubmit()}
						>
							{#snippet extra()}
								{#if template}
									<div
										class="grid gap-4 rounded-lg border border-border p-3"
										role="group"
										aria-label="{template.name} questions"
									>
										<input type="hidden" name="templateId" value={template.id} />
										{#if templates.length > 1}
											<div class="grid gap-1.5 text-[0.8125rem] font-medium">
												Form
												<Select
													aria-label="Form"
													value={String(template.id)}
													onchange={(v) => (templateId = Number(v))}
													items={templates.map((t) => ({ value: String(t.id), label: t.name }))}
												/>
											</div>
										{/if}
										<TemplateQuestions fields={template.fields} bind:values={answers} {errors} />
									</div>
								{/if}
							{/snippet}
							{#snippet afterTitle()}
								{#if similar.length}
									<div
										class="-mt-2 rounded-lg border border-border bg-muted/60 p-3"
										role="status"
										aria-live="polite"
									>
										<p class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
											<Lightbulb class="size-3.5" /> Similar reports already exist — maybe add your vote
											instead?
										</p>
										<ul class="mt-2 grid gap-1">
											{#each similar as s (s.number)}
												<li>
													<a
														href={ticketPath(projectKey, s.number)}
														target="_blank"
														rel="noopener"
														class="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-hover"
													>
														<StatusBadge status={s.status} iconOnly />
														<span class="font-mono text-xs text-muted-foreground"
															>{ticketRef(projectKey, s.number)}</span
														>
														<span class="min-w-0 flex-1 truncate">{s.title}</span>
														{#if s.voteCount}<span class="text-xs text-muted-foreground"
																>{s.voteCount} votes</span
															>{/if}
													</a>
												</li>
											{/each}
										</ul>
									</div>
								{/if}
							{/snippet}
						</TicketFields>
					</Card>
				</section>
			</div>

			<!-- Review summary: confirms the submission without an extra step. -->
			<aside class="lg:sticky lg:top-6 lg:self-start" aria-label="Review">
				<Card class="grid gap-4 p-4">
					<h2 class="text-sm font-semibold">Review</h2>
					<dl class="grid gap-3 text-sm">
						<div>
							<dt class="text-xs text-muted-foreground">Project</dt>
							<dd class="mt-0.5 flex items-center gap-2">
								{#if project}<ProjectIcon {project} size="xs" />{project.name}{:else}<span
										class="text-subtle-foreground">Not selected</span
									>{/if}
							</dd>
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">Type</dt>
							<dd class="mt-0.5">{type ? TYPE_META[type].label : 'Not selected'}</dd>
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">Title</dt>
							<dd class="mt-0.5 [overflow-wrap:anywhere]">{draft.title.trim() || '—'}</dd>
						</div>
						<div class="flex flex-wrap gap-1.5">
							<span
								class={cn(
									'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
									descriptionFilled ? 'tone tone-completed' : 'border-border text-muted-foreground'
								)}
							>
								<Check class="size-3" /> Description
							</span>
							{#each contextFilled as label (label)}
								<span
									class="tone tone-completed inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
									><Check class="size-3" />{label.replace(/\?$/, '')}</span
								>
							{/each}
							{#if draft.attachments.length}
								<span
									class="tone tone-completed inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
									><ImageIcon class="size-3" />{draft.attachments.length} image{draft.attachments
										.length > 1
										? 's'
										: ''}</span
								>
							{/if}
						</div>
					</dl>
					<Button
						type="submit"
						size="lg"
						class="w-full"
						loading={pending}
						disabled={mounted && !ready}
					>
						<Send /> Submit ticket
					</Button>
					<p class="text-center text-xs text-muted-foreground">
						{#if mounted && !ready}Add a title and description to submit.{:else}<Kbd>Ctrl</Kbd> + <Kbd
								>Enter</Kbd
							> to submit{/if}
					</p>
					<p class="text-xs text-muted-foreground">
						Your draft is saved automatically on this device. You’ll follow the ticket and get
						notified about updates.
					</p>
				</Card>
			</aside>
		</form>
	{/if}
</div>
