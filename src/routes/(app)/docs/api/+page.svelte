<script lang="ts">
	import FileBraces from '@lucide/svelte/icons/file-braces';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { cn } from '$lib/utils';

	let { data } = $props();
	const methodClass: Record<string, string> = {
		GET: 'tone tone-completed',
		POST: 'tone tone-progress',
		PATCH: 'tone tone-planned'
	};
	const anchor = (e: { method: string; path: string }) =>
		`${e.method}-${e.path}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
</script>

<div class="mx-auto grid max-w-5xl gap-6">
	<PageHeader title="API documentation" />

	<Card class="grid gap-3 p-5 text-sm sm:p-6">
		<p>
			Tikket has a REST API for scripts, CI pipelines and bots. Requests and responses are JSON.
		</p>
		<ul class="grid gap-1.5 text-muted-foreground">
			<li>
				<strong class="text-foreground">Base URL</strong>
				<code class="font-mono text-xs [overflow-wrap:anywhere]">{data.baseUrl}/api/v1</code>
			</li>
			<li>
				<strong class="text-foreground">Authentication</strong> – a personal access token (Account
				settings → Developer) or a project API token (Project settings → Developer):
				<code class="font-mono text-xs">Authorization: Bearer &lt;token&gt;</code>. The API never
				uses cookies.
			</li>
			<li>
				<strong class="text-foreground">Responses</strong> –
				<code class="font-mono text-xs">{'{ "data": …, "meta": { … } }'}</code>; errors are
				<code class="font-mono text-xs">{'{ "error": { "code": "…", "message": "…" } }'}</code>.
			</li>
			<li>
				<strong class="text-foreground">Pagination</strong> – lists return
				<code class="font-mono text-xs">meta.next_cursor</code>; pass it back as
				<code class="font-mono text-xs">?cursor=</code> until it is null.
			</li>
			<li>
				<strong class="text-foreground">Rate limits</strong> – {data.limits.read} requests and {data
					.limits.write} writes per minute per token. Every response carries
				<code class="font-mono text-xs">X-RateLimit-Limit</code>,
				<code class="font-mono text-xs">-Remaining</code> and
				<code class="font-mono text-xs">-Reset</code>; a 429 adds
				<code class="font-mono text-xs">Retry-After</code>.
			</li>
			<li>
				<strong class="text-foreground">Versioning</strong> – /api/v1 only changes additively (new endpoints,
				optional fields, enum values). Breaking changes would ship as /api/v2, with v1 kept for at least
				one more minor release.
			</li>
		</ul>
		<a
			href="/api/openapi.json"
			class="inline-flex items-center gap-1.5 justify-self-start text-link hover:underline"
			><FileBraces class="size-4" /> OpenAPI 3.1 document</a
		>
	</Card>

	<Card class="grid gap-4 p-5 sm:p-6">
		<h2 class="text-base font-semibold">Scopes</h2>
		<div class="grid gap-6 md:grid-cols-2">
			{#each [{ title: 'Personal access tokens', items: data.personalScopes, note: 'Act as you – never with more rights than your account.' }, { title: 'Project API tokens', items: data.projectScopes, note: 'Bound to one project; act with the rights of the owner who created them.' }] as group (group.title)}
				<div class="grid content-start gap-2">
					<h3 class="text-sm font-medium">{group.title}</h3>
					<p class="text-xs text-muted-foreground">{group.note}</p>
					<dl class="grid gap-1.5 text-xs">
						{#each group.items as s (s.scope)}
							<div class="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2">
								<dt class="font-mono">{s.scope}</dt>
								<dd class="text-muted-foreground">{s.description}</dd>
							</div>
						{/each}
					</dl>
				</div>
			{/each}
		</div>
	</Card>

	<nav aria-label="Endpoints" class="grid gap-1 text-sm">
		{#each data.endpoints as e (anchor(e))}
			<a href="#{anchor(e)}" class="flex min-w-0 items-center gap-2 hover:underline">
				<span
					class={cn(
						'w-14 shrink-0 rounded px-1.5 text-center font-mono text-[0.6875rem]',
						methodClass[e.method]
					)}>{e.method}</span
				>
				<code class="min-w-0 truncate font-mono text-xs">{e.path}</code>
			</a>
		{/each}
	</nav>

	{#each data.endpoints as e (anchor(e))}
		<Card class="grid scroll-mt-20 gap-3 p-5 sm:p-6" id={anchor(e)}>
			<h2 class="flex min-w-0 flex-wrap items-center gap-2">
				<span class={cn('rounded px-1.5 font-mono text-xs', methodClass[e.method])}>{e.method}</span
				>
				<code class="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">{e.path}</code>
			</h2>
			<p class="text-sm font-medium">{e.summary}</p>
			{#if e.description}<p class="text-sm text-muted-foreground">{e.description}</p>{/if}
			<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
				<div>
					<dt class="text-muted-foreground">Personal token</dt>
					<dd class="font-mono">{e.scopes.personal ?? 'not available'}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Project token</dt>
					<dd class="font-mono">{e.scopes.project ?? 'not available'}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Returns</dt>
					<dd class="font-mono">{e.response}</dd>
				</div>
				{#if e.body}
					<div>
						<dt class="text-muted-foreground">Body</dt>
						<dd class="font-mono">{e.body}</dd>
					</div>
				{/if}
			</dl>
			{#if e.query}
				<div class="overflow-x-auto rounded-lg border border-border">
					<table class="w-full text-left text-xs">
						<thead class="bg-surface-2 text-muted-foreground">
							<tr
								><th class="px-3 py-2 font-medium">Query</th><th class="px-3 py-2 font-medium"
									>Meaning</th
								></tr
							>
						</thead>
						<tbody>
							{#each e.query as q (q.name)}
								<tr class="border-t border-border align-top">
									<td class="px-3 py-1.5 font-mono">{q.name}</td>
									<td class="px-3 py-1.5 [overflow-wrap:anywhere]">{q.description}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if e.example}
				<pre
					class="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs">{e.example}</pre>
			{/if}
		</Card>
	{/each}
</div>
