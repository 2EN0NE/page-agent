/**
 * ReadingDetector - Detects when the user is actively reading an article.
 *
 * Scoring criteria (user confirmed):
 * - Content length (word count)
 * - Reading speed (scroll velocity moderation)
 * - Dwell time
 *
 * A high score indicates the user is engaged in "serious reading".
 */
import { ContextObserver } from './ContextObserver'

export interface ReadingScore {
	score: number // 0 - 100
	dwellTimeMs: number
	scrollDepth: number // 0 - 1
	wordCount: number
	avgScrollVelocity: number
	isReading: boolean
}

export class ReadingDetector {
	#observer: ContextObserver
	#startTime = Date.now()
	#lastScrollY = 0
	#lastScrollTime = Date.now()
	#scrollDeltas: number[] = []
	#scrollTimestamps: number[] = []
	#maxScrollY = 0
	#contentLength = -1
	#checkTimer: number | null = null
	#scrollListener: (() => void) | null = null
	#onReadingDetected?: (score: ReadingScore) => void

	// Thresholds (tunable)
	static MIN_DWELL_MS = 15_000 // at least 15s on page
	static MIN_WORD_COUNT = 300 // at least 300 words to be "an article"
	static MAX_VELOCITY = 5 // px/ms; faster = skimming
	static MIN_DEPTH = 0.3 // scrolled at least 30%
	static SCORE_THRESHOLD = 60 // above this = "isReading"

	constructor(observer: ContextObserver, onReadingDetected?: (score: ReadingScore) => void) {
		this.#observer = observer
		this.#onReadingDetected = onReadingDetected
		this.#startTime = Date.now()
		this.#lastScrollY = window.scrollY
		this.#lastScrollTime = Date.now()
		this.#setupScrollTracking()
		this.#checkTimer = window.setInterval(() => this.#check(), 10_000)
	}

	dispose() {
		if (this.#checkTimer) {
			window.clearInterval(this.#checkTimer)
			this.#checkTimer = null
		}
		if (this.#scrollListener) {
			window.removeEventListener('scroll', this.#scrollListener)
			this.#scrollListener = null
		}
	}

	/**
	 * Compute reading score immediately.
	 */
	getScore(): ReadingScore {
		const dwellTimeMs = Date.now() - this.#startTime
		const wordCount = this.#getWordCount()
		const scrollDepth = this.#getScrollDepth()
		const avgScrollVelocity = this.#getAvgScrollVelocity()

		// Normalize each factor to 0-100
		const dwellScore = Math.min((dwellTimeMs / 60_000) * 40, 40) // 1 min = 40 pts
		const contentScore = Math.min((wordCount / 1000) * 20, 20) // 1000 words = 20 pts
		const depthScore = scrollDepth * 20 // 100% depth = 20 pts
		const velocityScore =
			avgScrollVelocity <= ReadingDetector.MAX_VELOCITY
				? 20
				: Math.max(0, 20 - (avgScrollVelocity - ReadingDetector.MAX_VELOCITY) * 4)

		const score = Math.round(dwellScore + contentScore + depthScore + velocityScore)

		return {
			score,
			dwellTimeMs,
			scrollDepth,
			wordCount,
			avgScrollVelocity,
			isReading:
				score >= ReadingDetector.SCORE_THRESHOLD &&
				dwellTimeMs >= ReadingDetector.MIN_DWELL_MS &&
				wordCount >= ReadingDetector.MIN_WORD_COUNT &&
				scrollDepth >= ReadingDetector.MIN_DEPTH,
		}
	}

	// ========================================================================
	// Private
	// ========================================================================

	#setupScrollTracking() {
		const onScroll = () => {
			const now = Date.now()
			const y = window.scrollY
			const delta = y - this.#lastScrollY
			const dt = now - this.#lastScrollTime

			if (dt > 0) {
				this.#scrollDeltas.push(Math.abs(delta))
				this.#scrollTimestamps.push(dt)
				// keep last 50 scroll events
				if (this.#scrollDeltas.length > 50) {
					this.#scrollDeltas.shift()
					this.#scrollTimestamps.shift()
				}
			}

			this.#lastScrollY = y
			this.#lastScrollTime = now
			this.#maxScrollY = Math.max(this.#maxScrollY, y)
		}
		this.#scrollListener = onScroll
		window.addEventListener('scroll', onScroll, { passive: true })
	}

	#getScrollDepth(): number {
		const docHeight = document.documentElement.scrollHeight
		const viewport = window.innerHeight
		if (docHeight <= viewport) return 1
		return Math.min(this.#maxScrollY / (docHeight - viewport), 1)
	}

	#getWordCount(): number {
		if (this.#contentLength >= 0) return this.#contentLength
		// Simple heuristic: count words in <p>, <article>, <main> text
		const text =
			document.querySelector('article')?.textContent ??
			document.querySelector('main')?.textContent ??
			document.body.textContent ??
			''
		this.#contentLength = text
			.trim()
			.split(/\s+/)
			.filter((w) => w.length > 0).length
		return this.#contentLength
	}

	#getAvgScrollVelocity(): number {
		if (this.#scrollDeltas.length === 0) return 0
		const totalDelta = this.#scrollDeltas.reduce((a, b) => a + b, 0)
		const totalTime = this.#scrollTimestamps.reduce((a, b) => a + b, 0)
		return totalTime > 0 ? totalDelta / totalTime : 0
	}

	#check() {
		const score = this.getScore()
		if (score.isReading) {
			this.#observer.record('reading_detected', {
				score: score.score,
				dwellTimeMs: score.dwellTimeMs,
				scrollDepth: score.scrollDepth,
				wordCount: score.wordCount,
				avgScrollVelocity: score.avgScrollVelocity,
			})
			this.#onReadingDetected?.(score)
		}
	}
}
