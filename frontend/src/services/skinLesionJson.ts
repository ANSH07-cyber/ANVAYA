// JSON.parse discards earlier duplicate members. Inspect successful raw API JSON
// before handing its parsed value to a result consumer. Error responses stay
// available to Axios' status handling, including the 401 refresh interceptor.
export function parseSkinLesionResponse(raw: string, _headers?: unknown, status = 200) {
  if (status < 200 || status >= 300) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  const value: unknown = JSON.parse(raw);
  const objects: Set<string>[] = [];
  // JSON.parse has already checked the grammar. Consume whole strings so braces
  // and escaped quotes in free text can never be mistaken for object structure.
  for (const token of raw.matchAll(/"(?:\\.|[^"\\])*"\s*:?|[{}]/g)) {
    const text = token[0];
    if (text === '{') objects.push(new Set());
    else if (text === '}') objects.pop();
    else if (text.endsWith(':')) {
      const key: string = JSON.parse(text.slice(0, -1));
      const keys = objects[objects.length - 1];
      if (keys.has(key)) throw new Error('Screening result unavailable: duplicate response field.');
      keys.add(key);
    }
  }
  return value;
}

export const skinLesionResponse = { responseType: 'text' as const, transformResponse: [parseSkinLesionResponse] } ;
