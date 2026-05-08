/**
 * SidecarBorder - A lightweight green border overlay indicating
 * that the sidecar context observer is active.
 *
 * Non-blocking (pointer-events: none), pure CSS, no animation overhead.
 */
const BORDER_ID = 'page-agent-border'

export function showSidecarBorder() {
	if (document.getElementById(BORDER_ID)) return

	const div = document.createElement('div')
	div.id = BORDER_ID
	div.setAttribute('data-page-agent-ignore', 'true')
	div.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
		z-index: 2147483646;
		border: 3px solid #22c55e;
		border-radius: 0;
		box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.15), 0 0 20px rgba(34, 197, 94, 0.1);
		transition: opacity 0.3s ease;
		opacity: 1;
	`

	// Label badge
	const badge = document.createElement('div')
	badge.id = BORDER_ID + '-badge'
	badge.textContent = 'AI Context On'
	badge.style.cssText = `
		position: fixed;
		bottom: 8px;
		right: 8px;
		background: #22c55e;
		color: white;
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.05em;
		padding: 3px 8px;
		border-radius: 4px;
		pointer-events: none;
		z-index: 2147483647;
		box-shadow: 0 1px 3px rgba(0,0,0,0.2);
	`

	document.body.appendChild(div)
	document.body.appendChild(badge)
}

export function hideSidecarBorder() {
	const border = document.getElementById(BORDER_ID)
	const badge = document.getElementById(BORDER_ID + '-badge')
	if (border) border.remove()
	if (badge) badge.remove()
}

export function isSidecarBorderVisible(): boolean {
	return !!document.getElementById(BORDER_ID)
}
