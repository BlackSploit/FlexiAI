/**
 * Defers building a client until it is first used, while keeping a plain
 * `export const x = ...` at the call site. `next build` imports route modules
 * without runtime env, so clients built from env at module load would throw.
 */
export function lazy<T extends object>(make: () => T): T {
  let real: T | undefined;
  return new Proxy({} as T, {
    get(_target, prop) {
      real ??= make();
      const value = Reflect.get(real, prop, real);
      return typeof value === "function" ? value.bind(real) : value;
    },
    has(_target, prop) {
      real ??= make();
      return Reflect.has(real, prop);
    },
  });
}
