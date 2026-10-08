/**
 * Keeps the page where it is while a dropdown opens or closes.
 *
 * Opening a menu moves focus around (into the portalled list and back to the trigger). In some
 * browser/layout combinations that makes the page jump – typically to the top – even though the
 * person never scrolled. This remembers the scroll position and, for a short time, puts the page
 * back if it moved without any scroll input (wheel, touch, keys, scrollbar). As soon as the
 * person scrolls themselves, the guard steps aside.
 */
export function holdScroll(durationMs = 700): () => void {
	if (typeof window === 'undefined') return () => {};
	const x = window.scrollX;
	const y = window.scrollY;
	let done = false;
	let frame = 0;
	const started = performance.now();

	const stop = () => {
		if (done) return;
		done = true;
		cancelAnimationFrame(frame);
		for (const type of INPUTS) window.removeEventListener(type, onInput, true);
	};
	// Input after the opening gesture means the person is scrolling: never fight that.
	const onInput = (e: Event) => {
		if (performance.now() - started < 30 && (e.type === 'pointerdown' || e.type === 'click'))
			return;
		stop();
	};
	const INPUTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'];
	for (const type of INPUTS)
		window.addEventListener(type, onInput, { capture: true, passive: true });

	const tick = () => {
		if (done) return;
		if (window.scrollY !== y || window.scrollX !== x)
			window.scrollTo({ left: x, top: y, behavior: 'instant' });
		if (performance.now() - started > durationMs) stop();
		else frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	return stop;
}
