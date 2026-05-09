/**
 * SandboxJSAlgorithm - Sandboxed JavaScript execution for custom algorithms.
 *
 * User-provided JS runs inside an iframe with sandbox="allow-scripts".
 * Communication is via postMessage with a 5-second timeout.
 */
import type { InputValueRecord } from '@/lib/db'

import type { FormField } from './FormDetector'
import type { SuggestionAlgorithm, SuggestionContext, SuggestionItem } from './SuggestionEngine'

export interface SandboxJSConfig {
	/** Human-readable description */
	description?: string
	/** User-provided JS code (the algorithm body) */
	code: string
}

const SANDBOX_TIMEOUT_MS = 5000

const SANDBOX_HTML = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script>
(function() {
  'use strict';

  function validateItems(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(function(item) {
      return item && typeof item.value === 'string' &&
typeof item.confidence === 'number' &&
        typeof item.algorithm === 'string' &&
        typeof item.explanation === 'string' &&
        typeof item.fieldKey === 'string';
    });
  }

  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || data.type !== 'run') return;

    var field = data.field;
    var prefix = data.prefix;
    var history = data.history;
    var maxResults = data.maxResults;
    var context = data.context;
    var code = data.code;

    try {
      // eslint-disable-next-line no-new-func
      var fn = new Function('field', 'prefix', 'history', 'maxResults', 'context', code);
      var raw = fn(field, prefix, history, maxResults, context);
      var items = validateItems(raw).slice(0, maxResults);
      event.source.postMessage({ type: 'result', items: items }, '*');
    } catch (err) {
      event.source.postMessage({ type: 'error', message: String(err && err.message) }, '*');
    }
  });
})();
</script>
</head>
<body></body>
</html>
`

function createSandboxIframe(): HTMLIFrameElement {
	const iframe = document.createElement('iframe')
	iframe.setAttribute('sandbox', 'allow-scripts')
	iframe.style.position = 'fixed'
	iframe.style.width = '1px'
	iframe.style.height = '1px'
	iframe.style.opacity = '0'
	iframe.style.pointerEvents = 'none'
	iframe.style.left = '-9999px'
	const blob = new Blob([SANDBOX_HTML], { type: 'text/html' })
	iframe.src = URL.createObjectURL(blob)
	document.body.appendChild(iframe)
	return iframe
}

function removeSandboxIframe(iframe: HTMLIFrameElement) {
	try {
		if (iframe.src) {
			URL.revokeObjectURL(iframe.src)
		}
	} catch {
		// ignore
	}
	iframe.remove()
}

interface SandboxResult {
	items: SuggestionItem[]
	error?: string
}

function runInSandbox(
	code: string,
	field: FormField,
	prefix: string,
	history: InputValueRecord[],
	maxResults: number,
	context: SuggestionContext
): Promise<SandboxResult> {
	return new Promise((resolve) => {
		const iframe = createSandboxIframe()
		let resolved = false

		const timer = setTimeout(() => {
			if (resolved) return
			resolved = true
			removeSandboxIframe(iframe)
			resolve({
				items: [],
				error: 'Sandbox execution timed out after ' + SANDBOX_TIMEOUT_MS + 'ms',
			})
		}, SANDBOX_TIMEOUT_MS)

		const onMessage = (event: MessageEvent) => {
			if (event.source !== iframe.contentWindow) return
			const data = event.data as { type?: string; items?: SuggestionItem[]; message?: string }
			if (data.type !== 'result' && data.type !== 'error') return

			if (resolved) return
			resolved = true
			clearTimeout(timer)
			window.removeEventListener('message', onMessage)
			removeSandboxIframe(iframe)

			if (data.type === 'error') {
				resolve({ items: [], error: data.message || 'Unknown sandbox error' })
			} else {
				resolve({ items: data.items || [] })
			}
		}

		window.addEventListener('message', onMessage)

		// Wait for iframe to load before posting message
		iframe.onload = () => {
			iframe.contentWindow?.postMessage(
				{
					type: 'run',
					code,
					field,
					prefix,
					history,
					maxResults,
					context,
				},
				'*'
			)
		}
	})
}

export class SandboxJSAlgorithm implements SuggestionAlgorithm {
	readonly name: string
	readonly description?: string
	readonly version = '1.0'
	#code: string

	constructor(name: string, config: SandboxJSConfig) {
		this.name = name
		this.description = config.description
		this.#code = config.code
	}

	async compute(
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		context: SuggestionContext
	): Promise<SuggestionItem[]> {
		const result = await runInSandbox(this.#code, field, prefix, history, maxResults, context)
		if (result.error) {
			console.warn(`[SandboxJSAlgorithm] "${this.name}" error:`, result.error)
			return []
		}
		return result.items.map((item) => ({
			...item,
			algorithm: this.name,
		}))
	}
}

export function parseSandboxJSConfig(raw: Record<string, unknown>): SandboxJSConfig | null {
	if (typeof raw.code !== 'string' || !raw.code.trim()) {
		console.warn('[SandboxJSAlgorithm] Config missing "code" string')
		return null
	}
	return {
		description: typeof raw.description === 'string' ? raw.description : undefined,
		code: raw.code,
	}
}
