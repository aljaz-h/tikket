<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TemplateQuestions from '$lib/components/TemplateQuestions.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Textarea from '$lib/components/ui/textarea.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import {
		TEMPLATE_FIELD_KINDS,
		TEMPLATE_FIELD_META,
		TICKET_TYPES,
		TYPE_META,
		type TemplateFieldKind,
		type TicketType
	} from '$lib/shared/constants';
	import { TEMPLATE_LIMITS } from '$lib/shared/templates';
	import { projectPath } from '$lib/shared/format';

	let { data, form } = $props();

	interface Draft {
		uid: string;
		key: string;
		kind: TemplateFieldKind;
		label: string;
		help: string;
		placeholder: string;
		required: boolean;
		optionsText: string;
	}

	let name = $state('');
	let type = $state<TicketType>('bug');
	let description = $state('');
	let enabled = $state(true);
	let isDefault = $state(true);
	let fields = $state<Draft[]>([]);
	let pending = $state(false);
	let previewValues = $state<Record<string, string | boolean>>({});

	$effect.pre(() => {
		const t = data.template;
		name = t.name;
		type = t.type;
		description = t.description ?? '';
		enabled = t.enabled;
		isDefault = t.isDefault;
		fields = t.fields.map((f) => ({
			uid: crypto.randomUUID(),
			key: f.key,
			kind: f.kind,
			label: f.label,
			help: f.help ?? '',
			placeholder: f.placeholder ?? '',
			required: f.required,
			optionsText: f.options.join('\n')
		}));
	});

	const options = (f: Draft) =>
		f.optionsText
			.split('\n')
			.map((o) => o.trim())
			.filter(Boolean);
	const payload = $derived(
		JSON.stringify({
			type,
			name,
			description: description || null,
			enabled,
			isDefault,
			fields: fields.map((f) => ({
				key: f.key || undefined,
				kind: f.kind,
				label: f.label,
				help: f.help || null,
				placeholder: f.placeholder || null,
				required: f.required,
				options: f.kind === 'select' ? options(f) : []
			}))
		})
	);
	const preview = $derived(
		fields
			.filter((f) => f.label.trim())
			.map((f) => ({
				key: f.key || f.uid.slice(0, 8),
				kind: f.kind,
				label: f.label,
				help: f.help || null,
				placeholder: f.placeholder || null,
				required: f.required,
				options: options(f)
			}))
	);

	function add(kind: TemplateFieldKind = 'short_text') {
		if (fields.length >= TEMPLATE_LIMITS.fields) return;
		fields = [
			...fields,
			{
				uid: crypto.randomUUID(),
				key: '',
				kind,
				label: '',
				help: '',
				placeholder: '',
				required: false,
				optionsText: kind === 'select' ? 'Option 1\nOption 2' : ''
			}
		];
		queueMicrotask(() => document.getElementById(`label-${fields.at(-1)?.uid}`)?.focus());
	}
	function move(i: number, delta: number) {
		const j = i + delta;
		if (j < 0 || j >= fields.length) return;
		const next = [...fields];
		[next[i], next[j]] = [next[j], next[i]];
		fields = next;
	}
	const back = $derived(projectPath(data.project.key, 'settings/templates'));
</script>

<div class="grid gap-6">
	<a
		href={back}
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		><ArrowLeft class="size-4" /> All templates</a
	>

	<form
		method="POST"
		class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]"
		use:enhance={() => {
			pending = true;
			return async ({ result, update }) => {
				pending = false;
				if (result.type === 'redirect') toast.success('Template saved');
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="payload" value={payload} />
		<div class="grid content-start gap-6">
			<Card class="grid gap-4 p-5 sm:p-6">
				<h2 class="text-base font-semibold">
					{data.template.id ? 'Edit template' : 'New template'}
				</h2>
				<FormMessage message={(form?.errors as Record<string, string> | undefined)?.form} />
				<div class="grid gap-4 sm:grid-cols-2">
					<Field label="Name" for="tpl-name" required
						><Input
							id="tpl-name"
							bind:value={name}
							maxlength={80}
							placeholder="Bug report – mobile app"
							required
						/></Field
					>
					<Field label="Ticket type" for="tpl-type">
						<Select
							id="tpl-type"
							bind:value={type}
							items={TICKET_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }))}
						/>
					</Field>
				</div>
				<Field
					label="Internal description"
					for="tpl-desc"
					optional
					hint="Only shown to project owners."
					><Input id="tpl-desc" bind:value={description} maxlength={300} /></Field
				>
				<div class="flex flex-wrap gap-6">
					<label class="flex items-center gap-3 text-sm"
						><Switch bind:checked={enabled} /> Enabled</label
					>
					<label class="flex items-center gap-3 text-sm"
						><Switch bind:checked={isDefault} /> Default for {TYPE_META[
							type
						].label.toLowerCase()}s</label
					>
				</div>
				{#if data.template.id}
					<p class="text-xs text-muted-foreground">
						Saving creates version {data.template.version + 1}. Existing tickets keep the questions
						exactly as they were answered.
					</p>
				{/if}
			</Card>

			<section class="grid gap-3" aria-labelledby="questions-heading">
				<div class="flex items-center justify-between">
					<h2 id="questions-heading" class="text-sm font-semibold">
						Questions <span class="font-normal text-muted-foreground"
							>({fields.length}/{TEMPLATE_LIMITS.fields})</span
						>
					</h2>
				</div>
				{#each fields as field, i (field.uid)}
					<Card class="grid gap-3 p-4">
						<div class="flex items-center gap-2">
							<span class="text-xs font-medium text-muted-foreground">Question {i + 1}</span>
							<span class="flex-1"></span>
							<Button
								size="icon-xs"
								variant="subtle"
								onclick={() => move(i, -1)}
								disabled={i === 0}
								aria-label="Move question {i + 1} up"><ArrowUp /></Button
							>
							<Button
								size="icon-xs"
								variant="subtle"
								onclick={() => move(i, 1)}
								disabled={i === fields.length - 1}
								aria-label="Move question {i + 1} down"><ArrowDown /></Button
							>
							<Button
								size="icon-xs"
								variant="subtle"
								onclick={() => (fields = fields.filter((f) => f.uid !== field.uid))}
								aria-label="Remove question {i + 1}"><Trash2 /></Button
							>
						</div>
						<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
							<Field label="Question" for="label-{field.uid}" required
								><Input
									id="label-{field.uid}"
									bind:value={field.label}
									maxlength={120}
									placeholder="Which device were you using?"
								/></Field
							>
							<Field label="Answer type" for="kind-{field.uid}">
								<Select
									id="kind-{field.uid}"
									bind:value={field.kind}
									items={TEMPLATE_FIELD_KINDS.map((k) => ({
										value: k,
										label: TEMPLATE_FIELD_META[k].label
									}))}
								/>
							</Field>
						</div>
						<Field label="Help text" for="help-{field.uid}" optional
							><Input id="help-{field.uid}" bind:value={field.help} maxlength={300} /></Field
						>
						{#if field.kind === 'select'}
							<Field
								label="Options"
								for="opts-{field.uid}"
								hint="One option per line (2–{TEMPLATE_LIMITS.options})."
								><Textarea id="opts-{field.uid}" bind:value={field.optionsText} rows={3} /></Field
							>
						{:else if field.kind !== 'checkbox'}
							<Field label="Placeholder" for="ph-{field.uid}" optional
								><Input id="ph-{field.uid}" bind:value={field.placeholder} maxlength={120} /></Field
							>
						{/if}
						<label class="flex items-center gap-3 text-sm"
							><Switch bind:checked={field.required} />
							{field.kind === 'checkbox' ? 'Must be checked' : 'Required'}</label
						>
					</Card>
				{:else}
					<p
						class="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
					>
						No questions yet. Keep it short – every question makes reporting a little harder.
					</p>
				{/each}
				<div class="flex flex-wrap gap-2">
					{#each TEMPLATE_FIELD_KINDS as k (k)}
						<Button
							variant="outline"
							size="sm"
							onclick={() => add(k)}
							disabled={fields.length >= TEMPLATE_LIMITS.fields}
							><Plus /> {TEMPLATE_FIELD_META[k].label}</Button
						>
					{/each}
				</div>
			</section>
		</div>

		<aside class="grid content-start gap-4 xl:sticky xl:top-6 xl:self-start">
			<Card class="grid gap-4 p-5">
				<h2 class="text-sm font-semibold">Preview</h2>
				<p class="text-xs text-muted-foreground">
					Shown below the description when someone reports a {TYPE_META[type].label.toLowerCase()}.
				</p>
				<div class="grid gap-4 rounded-lg border border-dashed border-border p-4">
					<div class="grid gap-1.5">
						<span class="text-[0.8125rem] font-medium"
							>Title <span class="text-destructive">*</span></span
						>
						<div class="h-9 rounded-md border border-input bg-surface"></div>
					</div>
					<div class="grid gap-1.5">
						<span class="text-[0.8125rem] font-medium"
							>{TYPE_META[type].descriptionLabel} <span class="text-destructive">*</span></span
						>
						<div class="h-16 rounded-md border border-input bg-surface"></div>
					</div>
					<!-- Disabled so preview inputs are neither validated nor submitted with the template. -->
					<fieldset disabled class="grid gap-4">
						<TemplateQuestions fields={preview} bind:values={previewValues} idPrefix="preview" />
					</fieldset>
				</div>
			</Card>
			<div class="flex justify-end gap-2">
				<Button href={back} variant="ghost">Cancel</Button>
				<Button type="submit" loading={pending}>Save template</Button>
			</div>
		</aside>
	</form>
</div>
