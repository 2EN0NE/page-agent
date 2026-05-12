/**
 * Vitest setup — polyfill IndexedDB for Node test environment so that
 * background-script DB operations can be exercised in integration tests.
 */
import 'fake-indexeddb/auto'

// Polyfill crypto.randomUUID for Node < 20 (vitest runs in Node)
if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis, 'crypto', {
		value: {
			// eslint-disable-next-line @typescript-eslint/no-misused-spread
			...globalThis.crypto,
			randomUUID: () =>
				`10000000-1000-4000-8000-100000000000`.replace(/[018]/g, (c: string) => {
					const n = +c
					return (n ^ ((Math.random() * 16) >> (n / 4))).toString(16)
				}),
		},
		writable: true,
		configurable: true,
	})
}
