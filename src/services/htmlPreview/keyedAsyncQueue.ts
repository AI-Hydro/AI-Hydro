/** Serialize asynchronous operations that mutate the same logical key. */
export class KeyedAsyncQueue {
	private readonly tails = new Map<string, Promise<void>>()

	async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve()
		const current = previous.then(operation)
		const tail = current.then(
			() => undefined,
			() => undefined,
		)
		this.tails.set(key, tail)
		try {
			return await current
		} finally {
			if (this.tails.get(key) === tail) {
				this.tails.delete(key)
			}
		}
	}
}
