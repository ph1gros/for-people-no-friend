export async function* iterateSseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const extractEvents = function* (): Generator<string> {
    let separatorIndex = buffer.search(/\r?\n\r?\n/);
    while (separatorIndex >= 0) {
      const separator = buffer.slice(separatorIndex).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + separator.length);
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        yield data;
      }
      separatorIndex = buffer.search(/\r?\n\r?\n/);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      yield* extractEvents();
      if (done) {
        break;
      }
    }
    if (buffer.trim()) {
      buffer += '\n\n';
      yield* extractEvents();
    }
  } finally {
    reader.releaseLock();
  }
}
