/**
 * Maps inputs in stable order while keeping remote requests inside a small
 * concurrency window. This avoids turning a larger editorial reserve into an
 * API burst that is more likely to be throttled.
 */
export async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  mapper: (input: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("Concurrency must be a positive safe integer.");
  }
  if (inputs.length === 0) return [];

  const outputs = new Array<TOutput>(inputs.length);
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextIndex < inputs.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      outputs[currentIndex] = await mapper(inputs[currentIndex]!, currentIndex);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, inputs.length) },
      () => runWorker(),
    ),
  );
  return outputs;
}

/**
 * Maps every input inside the same bounded concurrency window, but records an
 * individual rejection instead of letting it stop the remaining inputs.
 *
 * The returned settled results preserve input order, not completion order.
 * Callers remain responsible for deciding whether a rejection is a recoverable
 * per-item gap or a fatal run-level error.
 */
export async function mapSettledWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  mapper: (input: TInput, index: number) => Promise<TOutput>,
): Promise<PromiseSettledResult<TOutput>[]> {
  return mapWithConcurrency(inputs, concurrency, async (input, index) => {
    try {
      return {
        status: "fulfilled",
        value: await mapper(input, index),
      } satisfies PromiseFulfilledResult<TOutput>;
    } catch (reason) {
      return {
        status: "rejected",
        reason,
      } satisfies PromiseRejectedResult;
    }
  });
}
