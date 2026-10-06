<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Link from '@lucide/svelte/icons/link';
	import Archive from '@lucide/svelte/icons/archive';
	import ProjectFields from '$lib/components/ProjectFields.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import NativeSelect from '$lib/components/ui/native-select.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import {
		EDIT_POLICIES,
		EDIT_POLICY_META,
		LABEL_COLORS,
		PROJECT_ROLES,
		PROJECT_ROLE_META
	} from '$lib/shared/constants';
	import { formatDate } from '$lib/shared/format';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const p = $derived(data.project);
	let removeTarget = $state<{ userId: number; displayName: string } | null>(null);
	let removeOpen = $state(false);
	let archiveOpen = $state(false);
	let voting = $state(true);
	let attachments = $state(true);
	let comments = $state(true);
	$effect.pre(() => {
		voting = p.votingEnabled;
		attachments = p.attachmentsEnabled;
		comments = p.commentsEnabled;
	});

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success('Invitation link copied');
		} catch {
			toast.error('Copy failed – select the link manually');
		}
	}
	const sections = ['General', 'Members', 'Labels', 'Danger zone'];
</script>

<div class="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
	<nav class="hidden lg:block" aria-label="Settings sections">
		<ul class="sticky top-6 grid gap-0.5 text-sm">
			{#each sections as s (s)}
				<li>
					<a
						href="#{s.toLowerCase().replace(' ', '-')}"
						class="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-hover hover:text-foreground"
						>{s}</a
					>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="grid gap-8">
		<section id="general" class="scroll-mt-6">
			<Card class="p-5 sm:p-6">
				<h2 class="text-base font-semibold">General</h2>
				<p class="mb-5 text-sm text-muted-foreground">
					Basic information, visibility and contribution rules.
				</p>
				<form
					method="POST"
					action="?/update"
					class="grid gap-5"
					use:enhance={quickSubmit({ success: 'Project settings saved' })}
				>
					<FormMessage message={errors.form} />
					<ProjectFields {errors} values={form?.values ?? p} keyLocked />
					<div class="grid gap-4 border-t border-border pt-5">
						<h3 class="text-sm font-semibold">Member permissions</h3>
						<Field
							label="Who can submit tickets?"
							for="submissionPolicy"
							hint="Applies to public projects. Private projects only accept members."
						>
							<NativeSelect
								id="submissionPolicy"
								name="submissionPolicy"
								value={p.submissionPolicy}
							>
								<option value="any_user">Any signed-in user</option>
								<option value="members">Project members only</option>
							</NativeSelect>
						</Field>
						<Field label="Editing own submissions" for="editPolicy">
							<NativeSelect id="editPolicy" name="editPolicy" value={p.editPolicy}>
								{#each EDIT_POLICIES as e (e)}<option value={e}>{EDIT_POLICY_META[e]}</option
									>{/each}
							</NativeSelect>
						</Field>
						{#each [{ name: 'votingEnabled', label: 'Voting', hint: 'Let users upvote tickets they care about.' }, { name: 'attachmentsEnabled', label: 'Screenshots & attachments', hint: 'Allow images on tickets and comments.' }, { name: 'commentsEnabled', label: 'Comments', hint: 'When off, only project staff can comment.' }] as opt (opt.name)}
							<label class="flex items-start gap-3">
								{#if opt.name === 'votingEnabled'}<Switch
										name={opt.name}
										bind:checked={voting}
										class="mt-0.5"
									/>{:else if opt.name === 'attachmentsEnabled'}<Switch
										name={opt.name}
										bind:checked={attachments}
										class="mt-0.5"
									/>{:else}<Switch name={opt.name} bind:checked={comments} class="mt-0.5" />{/if}
								<span
									><span class="block text-sm font-medium">{opt.label}</span><span
										class="block text-xs text-muted-foreground">{opt.hint}</span
									></span
								>
							</label>
						{/each}
					</div>
					<div class="flex justify-end border-t border-border pt-5">
						<Button type="submit" disabled={data.permissions.archived}>Save changes</Button>
					</div>
				</form>
			</Card>
		</section>

		<section id="members" class="scroll-mt-6">
			<Card class="p-5 sm:p-6">
				<h2 class="text-base font-semibold">Members</h2>
				<p class="mb-5 text-sm text-muted-foreground">
					Owners manage the project. Moderators triage tickets and moderate discussions. Members
					submit, comment and vote.
				</p>
				<form
					method="POST"
					action="?/addMember"
					class="flex flex-col gap-2 sm:flex-row"
					use:enhance={quickSubmit({ success: 'Member added', reset: true })}
				>
					<Input
						name="identifier"
						placeholder="Username or email of an existing user"
						aria-label="Username or email"
						required
						class="flex-1"
					/>
					<NativeSelect name="role" value="member" aria-label="Role" class="sm:w-36">
						{#each PROJECT_ROLES as r (r)}<option value={r}>{PROJECT_ROLE_META[r].label}</option
							>{/each}
					</NativeSelect>
					<Button type="submit" variant="secondary"><UserPlus /> Add</Button>
				</form>
				{#if errors.member}<p class="mt-2 text-xs text-destructive" role="alert">
						{errors.member}
					</p>{/if}

				<ul class="mt-4 divide-y divide-border rounded-lg border border-border">
					{#each data.members as m (m.userId)}
						<li class="flex flex-wrap items-center gap-3 px-3 py-2.5">
							<UserAvatar user={m} size="md" />
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">
									{m.displayName}
									{#if m.status === 'disabled'}<Badge variant="muted">Disabled</Badge>{/if}
								</p>
								<p class="truncate text-xs text-muted-foreground">@{m.username}</p>
							</div>
							<form
								method="POST"
								action="?/changeRole"
								use:enhance={quickSubmit({ success: 'Role updated' })}
							>
								<input type="hidden" name="userId" value={m.userId} />
								<NativeSelect
									name="role"
									value={m.role}
									aria-label="Role of {m.displayName}"
									class="w-36"
									onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}
								>
									{#each PROJECT_ROLES as r (r)}<option value={r}
											>{PROJECT_ROLE_META[r].label}</option
										>{/each}
								</NativeSelect>
								<noscript><Button type="submit" size="xs" variant="outline">Save</Button></noscript>
							</form>
							<Button
								variant="subtle"
								size="icon-sm"
								aria-label="Remove {m.displayName}"
								onclick={() => {
									removeTarget = m;
									removeOpen = true;
								}}><Trash2 /></Button
							>
						</li>
					{/each}
				</ul>

				<div class="mt-6 border-t border-border pt-5">
					<h3 class="text-sm font-semibold">Invite by link</h3>
					<p class="mb-3 text-xs text-muted-foreground">
						Creates a single-use link valid for {data.invitationLifetimeDays} days. New users create an
						account; existing users join the project.
					</p>
					<form
						method="POST"
						action="?/invite"
						class="flex flex-col gap-2 sm:flex-row"
						use:enhance={quickSubmit({ success: 'Invitation created' })}
					>
						<Input
							name="email"
							type="email"
							placeholder="Email (optional – restricts who can use it)"
							aria-label="Email"
							class="flex-1"
						/>
						<NativeSelect name="role" value="member" aria-label="Role" class="sm:w-36">
							{#each PROJECT_ROLES as r (r)}<option value={r}>{PROJECT_ROLE_META[r].label}</option
								>{/each}
						</NativeSelect>
						<Button type="submit" variant="secondary"><Link /> Create link</Button>
					</form>
					{#if errors.inviteEmail}<p class="mt-2 text-xs text-destructive" role="alert">
							{errors.inviteEmail}
						</p>{/if}
					{#if form && 'inviteLink' in form && form.inviteLink}
						<div
							class="mt-3 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary-soft p-2"
						>
							<Input
								readonly
								value={form.inviteLink}
								aria-label="Invitation link"
								class="h-8 flex-1 font-mono text-xs"
								onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
							/>
							<Button size="sm" onclick={() => copy(String(form.inviteLink))}><Copy /> Copy</Button>
						</div>
						<p class="mt-1 text-xs text-muted-foreground">
							Copy it now – for security the link is not shown again.
						</p>
					{/if}
					{#if data.invitations.length}
						<ul class="mt-4 divide-y divide-border rounded-lg border border-border text-sm">
							{#each data.invitations as inv (inv.id)}
								<li class="flex items-center gap-3 px-3 py-2">
									<span class="min-w-0 flex-1 truncate">{inv.email ?? 'Anyone with the link'}</span>
									<Badge>{PROJECT_ROLE_META[inv.projectRole ?? 'member'].label}</Badge>
									<span class="hidden text-xs text-muted-foreground sm:inline"
										>expires {formatDate(inv.expiresAt)}</span
									>
									<form
										method="POST"
										action="?/revokeInvite"
										use:enhance={quickSubmit({ success: 'Invitation revoked' })}
									>
										<input type="hidden" name="invitationId" value={inv.id} />
										<Button type="submit" size="xs" variant="ghost">Revoke</Button>
									</form>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</Card>
		</section>

		<section id="labels" class="scroll-mt-6">
			<Card class="p-5 sm:p-6">
				<h2 class="text-base font-semibold">Labels</h2>
				<p class="mb-5 text-sm text-muted-foreground">
					Staff can add labels to tickets to categorise them (for example “iOS”, “Sync”, “Design”).
				</p>
				<form
					method="POST"
					action="?/createLabel"
					class="flex flex-col gap-2 sm:flex-row"
					use:enhance={quickSubmit({ success: 'Label created', reset: true })}
				>
					<Input
						name="name"
						placeholder="New label name"
						aria-label="Label name"
						required
						maxlength={40}
						class="flex-1"
					/>
					<NativeSelect name="color" value="slate" aria-label="Colour" class="sm:w-32">
						{#each LABEL_COLORS as c (c)}<option value={c}>{c}</option>{/each}
					</NativeSelect>
					<Button type="submit" variant="secondary">Add label</Button>
				</form>
				{#if errors.name}<p class="mt-2 text-xs text-destructive" role="alert">
						{errors.name}
					</p>{/if}
				{#if data.labels.length}
					<ul class="mt-4 divide-y divide-border rounded-lg border border-border">
						{#each data.labels as label (label.id)}
							<li class="flex flex-wrap items-center gap-2 px-3 py-2">
								<form
									method="POST"
									action="?/updateLabel"
									class="flex flex-1 flex-wrap items-center gap-2"
									use:enhance={quickSubmit({ success: 'Label updated' })}
								>
									<input type="hidden" name="labelId" value={label.id} />
									<span class="swatch-{label.color} swatch-solid size-3 rounded-full"></span>
									<Input
										name="name"
										value={label.name}
										aria-label="Label name"
										class="h-8 min-w-32 flex-1"
										maxlength={40}
									/>
									<NativeSelect
										name="color"
										value={label.color}
										aria-label="Colour"
										class="w-28 [&_select]:h-8"
									>
										{#each LABEL_COLORS as c (c)}<option value={c}>{c}</option>{/each}
									</NativeSelect>
									<span class="text-xs text-muted-foreground">{label.usage} tickets</span>
									<Button type="submit" size="xs" variant="outline">Save</Button>
								</form>
								<form
									method="POST"
									action="?/deleteLabel"
									use:enhance={quickSubmit({ success: 'Label deleted' })}
								>
									<input type="hidden" name="labelId" value={label.id} />
									<Button
										type="submit"
										size="icon-xs"
										variant="subtle"
										aria-label="Delete label {label.name}"><Trash2 /></Button
									>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
			</Card>
		</section>

		<section id="danger-zone" class="scroll-mt-6">
			<Card class="border-destructive/30 p-5 sm:p-6">
				<h2 class="text-base font-semibold">Danger zone</h2>
				<div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p class="text-sm text-muted-foreground">
						{#if data.permissions.archived}This project is archived. Unarchive it to accept new
							tickets again.{:else}Archiving makes the project read-only. All tickets, comments and
							history are preserved.{/if}
					</p>
					{#if data.permissions.archived}
						<form
							method="POST"
							action="?/unarchive"
							use:enhance={quickSubmit({ success: 'Project unarchived' })}
						>
							<Button type="submit" variant="secondary">Unarchive project</Button>
						</form>
					{:else}
						<Button variant="destructive-outline" onclick={() => (archiveOpen = true)}
							><Archive /> Archive project</Button
						>
					{/if}
				</div>
			</Card>
		</section>
	</div>
</div>

{#if removeTarget}
	<ConfirmDialog
		bind:open={removeOpen}
		title="Remove {removeTarget.displayName}?"
		description="They lose access to this project if it is private. Their tickets and comments are kept."
		confirmLabel="Remove"
		destructive
		action="?/removeMember"
		fields={{ userId: removeTarget.userId }}
		successMessage="Member removed"
	/>
{/if}
<ConfirmDialog
	bind:open={archiveOpen}
	title="Archive {p.name}?"
	description="The project becomes read-only. You can unarchive it later."
	confirmLabel="Archive"
	destructive
	action="?/archive"
	successMessage="Project archived"
/>
