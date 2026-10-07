<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import { projectPath } from '$lib/shared/format';

	let { project, title }: { project: string; title: string } = $props();
</script>

<nav
	aria-label="Breadcrumb"
	class="-mt-2 mb-4 flex items-center gap-1 text-sm text-muted-foreground"
>
	<a
		href={projectPath(project, 'settings/integrations')}
		class="inline-flex items-center gap-1 hover:text-foreground"
		><ChevronLeft class="size-4" />Integrations</a
	>
	<span aria-hidden="true">/</span>
	<span class="font-medium text-foreground" aria-current="page">{title}</span>
</nav>
