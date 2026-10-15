// Minimal stand-ins so server modules can be imported outside a Next.js request.
export async function headers() {
  return new Headers();
}
export async function cookies() {
  const m = new Map<string, string>();
  return {
    get: (k: string) => (m.has(k) ? { name: k, value: m.get(k)! } : undefined),
    set: (k: string, v: string) => void m.set(k, v),
    delete: (k: string) => void m.delete(k),
  };
}
