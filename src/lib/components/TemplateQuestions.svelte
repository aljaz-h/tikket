<script lang="ts">
	import Field from './ui/field.svelte';
	import Input from './ui/input.svelte';
	import Textarea from './ui/textarea.svelte';
	import Select from './ui/select.svelte';
	import { templateFieldName, type TemplateFieldDef } from '$lib/shared/templates';

	/** Renders a ticket template's questions as ordinary form fields (`tpl_<key>`). */
	interface Props {
		fields: TemplateFieldDef[];
		values?: Record<string, string | boolean>;
		errors?: Record<string, string>;
		idPrefix?: string;
		onchange?: () => void;
	}
	let { fields, values = $bindable({}), errors = {}, idPrefix = 'tpl', onchange }: Props = $props();
</script>

{#each fields as field (field.key)}
	{@const name = templateFieldName(field.key)}
	{@const id = `${idPrefix}-${field.key}`}
	{#if field.kind === 'checkbox'}
		<div class="grid gap-1">
			<label class="flex items-start gap-2.5 text-sm">
				<input
					type="checkbox"
					{id}
					{name}
					checked={values[name] === true}
					onchange={(e) => {
						values[name] = (e.currentTarget as HTMLInputElement).checked;
						onchange?.();
					}}
					class="mt-0.5 size-4 shrink-0"
					aria-invalid={!!errors[name]}
					aria-describedby={field.help ? `${id}-hint` : undefined}
				/>
				<span>
					<span class="font-medium">{field.label}</span>
					{#if field.required}<span class="text-destructive" aria-hidden="true"> *</span>{/if}
					{#if field.help}<span id="{id}-hint" class="block text-xs text-muted-foreground"
							>{field.help}</span
						>{/if}
				</span>
			</label>
			{#if errors[name]}<p class="text-xs text-destructive" role="alert">{errors[name]}</p>{/if}
		</div>
	{:else}
		<Field
			label={field.label}
			for={id}
			required={field.required}
			optional={!field.required}
			hint={field.help ?? undefined}
			error={errors[name]}
		>
			{#if field.kind === 'long_text'}
				<Textarea
					{id}
					{name}
					rows={3}
					maxlength={5000}
					placeholder={field.placeholder ?? ''}
					required={field.required}
					value={String(values[name] ?? '')}
					oninput={(e) => {
						values[name] = (e.currentTarget as HTMLTextAreaElement).value;
						onchange?.();
					}}
					aria-invalid={!!errors[name]}
				/>
			{:else if field.kind === 'select'}
				<Select
					{id}
					{name}
					required={field.required}
					placeholder="Choose…"
					value={String(values[name] ?? '')}
					items={field.options.map((o) => ({ value: o, label: o }))}
					searchable={field.options.length > 10}
					onchange={(v) => {
						values[name] = v;
						onchange?.();
					}}
					aria-invalid={!!errors[name]}
				/>
			{:else}
				<Input
					{id}
					{name}
					type={field.kind === 'url' ? 'url' : 'text'}
					inputmode={field.kind === 'url' ? 'url' : undefined}
					maxlength={field.kind === 'url' ? 2048 : 300}
					placeholder={field.placeholder ?? (field.kind === 'url' ? 'https://' : '')}
					required={field.required}
					value={String(values[name] ?? '')}
					oninput={(e) => {
						values[name] = (e.currentTarget as HTMLInputElement).value;
						onchange?.();
					}}
					aria-invalid={!!errors[name]}
				/>
			{/if}
		</Field>
	{/if}
{/each}
