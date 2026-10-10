/**
 * A chainable stand-in for the Drizzle client: every builder method returns the chain, awaiting it yields
 * `rows`. Calls are recorded as [root, ...method names] so tests can assert which writes happened.
 */
export type FakeDb = {
  rows: unknown[];
  calls: { op: string; chain: string[]; args: unknown[][] }[];
  reset: () => void;
  db: Record<string, unknown>;
};

export function createFakeDb(): FakeDb {
  const state: FakeDb = {
    rows: [],
    calls: [],
    reset: () => {
      state.rows = [];
      state.calls = [];
    },
    db: {},
  };
  const chain = (rec: FakeDb["calls"][number]): unknown =>
    new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(rec.op === "select" ? state.rows : []);
        }
        return (...args: unknown[]) => {
          rec.chain.push(String(prop));
          rec.args.push(args);
          return chain(rec);
        };
      },
    });
  for (const op of ["select", "insert", "update", "delete"]) {
    state.db[op] = (...args: unknown[]) => {
      const rec = { op, chain: [] as string[], args: [args] };
      state.calls.push(rec);
      return chain(rec);
    };
  }
  return state;
}
