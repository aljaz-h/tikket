<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Bell from '@lucide/svelte/icons/bell';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Copy from '@lucide/svelte/icons/copy';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Rocket from '@lucide/svelte/icons/rocket';
	import { Popover } from 'bits-ui';
	import { toast } from 'svelte-sonner';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import LinkifiedText from '$lib/components/LinkifiedText.svelte';
	import AttachmentGallery from '$lib/components/AttachmentGallery.svelte';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import StatusControl from '$lib/components/ticket/StatusControl.svelte';
	import CommentForm from '$lib/components/ticket/CommentForm.svelte';
	import CommentItem from '$lib/components/ticket/CommentItem.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import NativeSelect from '$lib/components/ui/native-select.svelte';
	import PopoverContent from '$lib/components/ui/popover-content.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import { describeActivity } from '$lib/shared/activity';
	import {
		CONTEXT_FIELDS,
		CONTEXT_LABELS,
		PRIORITY_META,
		STATUS_META,
		TICKET_PRIORITIES,
		type ContextKey
	} from '$lib/shared/constants';
	import {
		formatDate,
		formatDateTime,
		projectPath,
		ticketPath,
		ticketRef
	} from '$lib/shared/format';
	import { cn } from '$lib/utils';

	let { data } = $props();
	const t = $derived(data.ticket);
	const d = $derived(data.detail);
	const perms = $derived(data.permissions);
	const key = $derived(data.project.key);

	let removeAttachment = $state<{ id: string; originalName: string } | null>(null);
	let removeOpen = $state(false);

	onMount(() => {
		if (data.created) {
			toast.success(`${t.ref} was created`, { description: 'You will be notified about updates.' });
			const url = new URL(page.url);
			url.searchParams.delete('created');
			replaceState(url, page.state);
		}
	});

	// Timeline: comments interleaved with significant activity, chronologically.
	const timeline = $derived(
		[
			...d.comments.map((c) => ({
				kind: 'comment' as const,
				at: new Date(c.createdAt).getTime(),
				comment: c
			})),
			...d.activity
				.filter((a) => a.type !== 'created')
				.map((a) => ({
					kind: 'activity' as const,
					at: new Date(a.createdAt).getTime(),
					activity: a
				}))
		].sort((a, b) => a.at - b.at)
	);

	const contextEntries = $derived(
		(Object.entries(t.context) as [ContextKey, string][]).filter(
			([k, v]) => v && k !== 'affectedUrl'
		)
	);
	const fieldLabel = (k: ContextKey) =>
		CONTEXT_FIELDS[t.type].find((f) => f.key === k)?.label ?? CONTEXT_LABELS[k];

	let selectedLabels = $derived(d.labels.map((l) => l.id));

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(page.url.origin + ticketPath(key, t.number));
			toast.success('Link copied');
		} catch {
			toast.error('Could not copy the link');
		}
	}
</script>

<div class="grid gap-6">
	<nav aria-label="Breadcrumb" class="flex items-center gap-2 text-sm text-muted-foreground">
		<a
			href={projectPath(key, 'tickets')}
			class="inline-flex items-center gap-1.5 hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			<ProjectIcon project={data.project} size="xs" />
			{data.project.name}
		</a>
		<span aria-hidden="true">/</span>
		<span class="font-mono">{t.ref}</span>
	</nav>

	<header class="grid gap-3">
		<div class="flex flex-wrap items-center gap-2">
			<StatusBadge status={t.status} />
			<TypeBadge type={t.type} short={false} />
			{#if perms.isStaff || t.priority !== 'medium'}<PriorityBadge priority={t.priority} />{/if}
			{#each d.labels as label (label.id)}
				<span class="swatch-bg swatch-{label.color} rounded-md px-1.5 py-0.5 text-xs font-medium"
					>{label.name}</span
				>
			{/each}
		</div>
		<h1
			class="text-xl font-semibold tracking-tight text-balance [overflow-wrap:anywhere] sm:text-2xl"
		>
			<span class="mr-1.5 font-mono font-normal text-muted-foreground">{t.ref}</span>{t.title}
		</h1>
		<p class="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
			<UserAvatar user={d.reporter} size="xs" />
			<span class="font-medium text-foreground">{d.reporter.displayName}</span> reported
			<TimeAgo date={t.createdAt} />
			{#if new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime() > 60000}· updated <TimeAgo
					date={t.updatedAt}
				/>{/if}
		</p>
	</header>

	{#if t.status === 'duplicate' && d.duplicateOf}
		<FormMessage
			variant="info"
			message="This ticket is a duplicate of {ticketRef(key, d.duplicateOf.number)} — {d.duplicateOf
				.title}. Please follow and vote on the original."
		/>
	{/if}

	<div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
		<div class="grid min-w-0 content-start gap-8">
			<!-- Main content -->
			<Card class="p-5">
				{#if t.status !== 'open' && t.resolutionNote}
					<div class={cn('tone mb-4 rounded-lg border p-3 text-sm', STATUS_META[t.status].tone)}>
						<p class="text-xs font-semibold">
							{t.status === 'completed'
								? 'Resolution'
								: `${STATUS_META[t.status].label} — note from the team`}
						</p>
						<LinkifiedText text={t.resolutionNote} class="mt-1 text-foreground" />
					</div>
				{/if}
				<RichText html={t.descriptionHtml} class="text-[0.9375rem]" />

				{#if t.context.affectedUrl}
					<div class="mt-5 flex items-center gap-2 text-sm">
						<Link2 class="size-4 shrink-0 text-muted-foreground" />
						<span class="text-muted-foreground">Affected URL:</span>
						<a
							href={t.context.affectedUrl}
							target="_blank"
							rel="noopener noreferrer nofollow ugc"
							class="truncate text-primary hover:underline">{t.context.affectedUrl}</a
						>
					</div>
				{/if}

				{#if contextEntries.length}
					<dl class="mt-5 grid gap-4 border-t border-border pt-5">
						{#each contextEntries as [k, v] (k)}
							<div>
								<dt class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									{fieldLabel(k)}
								</dt>
								<dd class="mt-1 text-sm"><LinkifiedText text={v} /></dd>
							</div>
						{/each}
					</dl>
				{/if}

				{#if d.attachments.length}
					<div class="mt-5 border-t border-border pt-5">
						<h2 class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							Screenshots
						</h2>
						<AttachmentGallery items={d.attachments}>
							{#snippet removeControl(item)}
								{#if data.canEdit}
									<button
										type="button"
										class="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-destructive"
										aria-label="Remove {item.originalName}"
										onclick={() => {
											removeAttachment = item;
											removeOpen = true;
										}}><Trash2 class="size-3.5" /></button
									>
								{/if}
							{/snippet}
						</AttachmentGallery>
					</div>
				{/if}

				{#if d.duplicates.length}
					<div class="mt-5 border-t border-border pt-5">
						<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							Duplicates of this ticket
						</h2>
						<ul class="grid gap-1">
							{#each d.duplicates as dup (dup.number)}
								<li>
									<a href={ticketPath(key, dup.number)} class="text-sm hover:underline"
										><span class="font-mono text-muted-foreground"
											>{ticketRef(key, dup.number)}</span
										>
										{dup.title}</a
									>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</Card>

			<!-- Discussion -->
			<section aria-labelledby="discussion" class="grid gap-4">
				<h2 id="discussion" class="text-sm font-semibold">Discussion</h2>
				<ol class="grid gap-4">
					{#each timeline as item (item.kind === 'comment' ? `c${item.comment.id}` : `a${item.activity.id}`)}
						<li>
							{#if item.kind === 'comment'}
								<CommentItem
									comment={item.comment}
									isReporter={item.comment.author.id === d.reporter.id}
									currentUserId={data.user?.id ?? null}
								/>
							{:else}
								{@const a = item.activity}
								<div class="flex items-start gap-3 pl-1.5 text-sm text-muted-foreground">
									<span class="mt-1 flex size-5 shrink-0 items-center justify-center">
										{#if a.type === 'status' && a.data.to}
											<StatusBadge status={a.data.to as typeof t.status} iconOnly />
										{:else}
											<span class="size-1.5 rounded-full bg-border-strong"></span>
										{/if}
									</span>
									<div class="min-w-0">
										<span class="font-medium text-foreground"
											>{a.actor?.displayName ?? 'Someone'}</span
										>
										{describeActivity(a.type, a.data)}
										{#if a.type === 'status' && a.data.duplicateOf}
											{@const dup = a.data.duplicateOf as { number: number; title: string }}
											of
											<a href={ticketPath(key, dup.number)} class="text-primary hover:underline"
												>{ticketRef(key, dup.number)}</a
											>
										{/if}
										· <TimeAgo date={a.createdAt} />
										{#if a.type === 'status' && a.data.note}
											<LinkifiedText
												text={String(a.data.note)}
												class="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-foreground"
											/>
										{/if}
									</div>
								</div>
							{/if}
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">No comments yet.</li>
					{/each}
				</ol>

				{#if data.user && perms.canComment}
					<CommentForm
						user={data.user}
						allowAttachments={perms.canAttach}
						limits={{
							maxFiles: data.app.maxAttachments,
							maxSize: data.app.maxAttachmentSize,
							accept: data.app.allowedImageTypes
						}}
						draftKey="tikket:comment:{data.user.id}:{t.id}"
					/>
				{:else if !data.user}
					<Card class="flex items-center justify-between gap-3 p-4 text-sm">
						<span class="text-muted-foreground">Sign in to join the discussion.</span>
						<Button href="/login?next={encodeURIComponent(page.url.pathname)}" size="sm"
							>Sign in</Button
						>
					</Card>
				{:else if perms.archived}
					<p class="text-sm text-muted-foreground">
						This project is archived; new comments are disabled.
					</p>
				{:else if !data.project.commentsEnabled}
					<p class="text-sm text-muted-foreground">Comments are disabled for this project.</p>
				{/if}
			</section>
		</div>

		<!-- Metadata sidebar -->
		<aside class="grid content-start gap-4" aria-label="Ticket details">
			<Card class="grid gap-3 p-4">
				<div class="flex gap-2">
					{#if data.project.votingEnabled}
						<form method="POST" action="?/vote" class="flex-1" use:enhance={quickSubmit()}>
							<input type="hidden" name="on" value={d.hasVoted ? '0' : '1'} />
							<Button
								type="submit"
								variant={d.hasVoted ? 'default' : 'secondary'}
								class="w-full"
								disabled={!perms.canVote}
								aria-pressed={d.hasVoted}
								title={perms.canVote
									? undefined
									: data.user
										? 'Voting is not available'
										: 'Sign in to vote'}
							>
								<ArrowBigUp class={cn('size-5', d.hasVoted && 'fill-current')} />
								<span class="tabular-nums">{t.voteCount}</span>
								<span class="sr-only">votes,</span>{d.hasVoted ? 'Voted' : 'Upvote'}
							</Button>
						</form>
					{/if}
					{#if data.user}
						<form
							method="POST"
							action="?/follow"
							class={data.project.votingEnabled ? '' : 'flex-1'}
							use:enhance={quickSubmit({
								success: d.isFollowing ? 'Unfollowed' : 'You will be notified about updates'
							})}
						>
							<input type="hidden" name="on" value={d.isFollowing ? '0' : '1'} />
							<Button type="submit" variant="secondary" class="w-full" aria-pressed={d.isFollowing}>
								{#if d.isFollowing}<BellOff /> Unfollow{:else}<Bell /> Follow{/if}
							</Button>
						</form>
					{/if}
				</div>
				<div class="flex gap-2">
					{#if data.canEdit}
						<Button
							href="{ticketPath(key, t.number)}/edit"
							variant="outline"
							size="sm"
							class="flex-1"><Pencil /> Edit</Button
						>
					{/if}
					<Button variant="outline" size="sm" class="flex-1" onclick={copyLink}
						><Copy /> Copy link</Button
					>
				</div>
				{#if data.voters.length}
					<div class="flex items-center gap-2">
						<div class="flex -space-x-1.5">
							{#each data.voters as v (v.id)}<UserAvatar
									user={v}
									size="xs"
									class="ring-2 ring-surface"
								/>{/each}
						</div>
						<span class="text-xs text-muted-foreground">{d.followerCount} following</span>
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">{d.followerCount} following</p>
				{/if}
			</Card>

			<Card class="grid gap-4 p-4 text-sm">
				<div class="grid gap-1.5">
					<p class="text-xs font-medium text-muted-foreground">Status</p>
					{#if perms.isStaff}
						<StatusControl status={t.status} projectKey={key} />
					{:else}
						<div><StatusBadge status={t.status} /></div>
						<p class="text-xs text-muted-foreground">{STATUS_META[t.status].description}</p>
					{/if}
				</div>

				<div class="grid gap-1.5">
					<p class="text-xs font-medium text-muted-foreground">Priority</p>
					{#if perms.isStaff}
						<form
							method="POST"
							action="?/priority"
							use:enhance={quickSubmit({ success: 'Priority updated' })}
						>
							<NativeSelect
								name="priority"
								value={t.priority}
								aria-label="Priority"
								onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}
							>
								{#each TICKET_PRIORITIES as p (p)}<option value={p}>{PRIORITY_META[p].label}</option
									>{/each}
							</NativeSelect>
							<noscript
								><Button type="submit" size="xs" variant="outline" class="mt-1.5"
									>Save priority</Button
								></noscript
							>
						</form>
					{:else}
						<PriorityBadge priority={t.priority} />
					{/if}
				</div>

				<div class="grid gap-1.5">
					<p class="text-xs font-medium text-muted-foreground">Assignee</p>
					{#if perms.isStaff}
						<form
							method="POST"
							action="?/assign"
							use:enhance={quickSubmit({ success: 'Assignee updated' })}
						>
							<NativeSelect
								name="assigneeId"
								value={t.assigneeId ? String(t.assigneeId) : 'none'}
								aria-label="Assignee"
								onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}
							>
								<option value="none">Unassigned</option>
								{#each data.assignable as u (u.id)}<option value={String(u.id)}
										>{u.displayName}</option
									>{/each}
							</NativeSelect>
							<noscript
								><Button type="submit" size="xs" variant="outline" class="mt-1.5"
									>Save assignee</Button
								></noscript
							>
						</form>
						{#if data.user && t.assigneeId !== data.user.id && data.assignable.some((u) => u.id === data.user?.id)}
							<form
								method="POST"
								action="?/assign"
								use:enhance={quickSubmit({ success: 'Assigned to you' })}
							>
								<input type="hidden" name="assigneeId" value={data.user.id} />
								<button type="submit" class="text-xs text-primary hover:underline"
									>Assign to me</button
								>
							</form>
						{/if}
					{:else if d.assignee}
						<span class="flex items-center gap-2"
							><UserAvatar user={d.assignee} size="sm" />{d.assignee.displayName}</span
						>
					{:else}
						<span class="text-muted-foreground">Unassigned</span>
					{/if}
				</div>

				{#if perms.isStaff && data.labels.length}
					<div class="grid gap-1.5">
						<p class="text-xs font-medium text-muted-foreground">Labels</p>
						<Popover.Root>
							<Popover.Trigger
								class="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-left text-xs text-muted-foreground hover:border-border-strong"
							>
								{#if d.labels.length}
									{#each d.labels as label (label.id)}<span
											class="swatch-bg swatch-{label.color} rounded px-1.5 py-0.5 font-medium"
											>{label.name}</span
										>{/each}
								{:else}<Tag class="size-3.5" /> Add labels{/if}
							</Popover.Trigger>
							<PopoverContent class="w-60">
								<form
									method="POST"
									action="?/labels"
									class="grid gap-2"
									use:enhance={quickSubmit({ success: 'Labels updated' })}
								>
									<fieldset class="grid max-h-60 gap-1 overflow-y-auto">
										<legend class="sr-only">Labels</legend>
										{#each data.labels as label (label.id)}
											<label
												class="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-hover"
											>
												<input
													type="checkbox"
													name="labelId"
													value={label.id}
													bind:group={selectedLabels}
													class="size-4 accent-[var(--primary)]"
												/>
												<span class="swatch-{label.color} swatch-solid size-2.5 rounded-full"
												></span>{label.name}
											</label>
										{/each}
									</fieldset>
									<Button type="submit" size="sm">Apply</Button>
								</form>
							</PopoverContent>
						</Popover.Root>
					</div>
				{/if}

				<dl class="grid gap-2.5 border-t border-border pt-4 text-sm">
					<div class="flex justify-between gap-2">
						<dt class="text-muted-foreground">Type</dt>
						<dd><TypeBadge type={t.type} short={false} /></dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-muted-foreground">Reporter</dt>
						<dd class="flex items-center gap-1.5 truncate">
							<UserAvatar user={d.reporter} size="xs" />{d.reporter.displayName}
						</dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-muted-foreground">Created</dt>
						<dd title={formatDateTime(t.createdAt)}>{formatDate(t.createdAt)}</dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-muted-foreground">Updated</dt>
						<dd><TimeAgo date={t.updatedAt} /></dd>
					</div>
					{#if t.completedAt && t.status === 'completed'}
						<div class="flex justify-between gap-2">
							<dt class="text-muted-foreground">Completed</dt>
							<dd class="flex items-center gap-1">
								<CircleCheck class="tone-completed tone-text size-3.5" />{formatDate(t.completedAt)}
							</dd>
						</div>
					{/if}
					{#if data.project.votingEnabled}
						<div class="flex justify-between gap-2">
							<dt class="text-muted-foreground">Votes</dt>
							<dd class="tabular-nums">{t.voteCount}</dd>
						</div>
					{/if}
					{#each d.releases as release (release.id)}
						<div class="flex justify-between gap-2">
							<dt class="text-muted-foreground">Released in</dt>
							<dd>
								<a
									href={projectPath(key, 'changelog')}
									class="inline-flex items-center gap-1 text-primary hover:underline"
									><Rocket class="size-3.5" />{release.version}</a
								>
							</dd>
						</div>
					{/each}
				</dl>
			</Card>
		</aside>
	</div>
</div>

{#if removeAttachment}
	<ConfirmDialog
		bind:open={removeOpen}
		title="Remove this screenshot?"
		description="“{removeAttachment.originalName}” will be removed from the ticket."
		confirmLabel="Remove"
		destructive
		action="?/removeAttachment"
		fields={{ attachmentId: removeAttachment.id }}
		successMessage="Screenshot removed"
	/>
{/if}
