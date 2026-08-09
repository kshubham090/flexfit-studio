type DbClient = typeof import("@/db").db;

/**
 * Service functions accept either the plain db client or a transaction
 * handle (the `tx` passed into `db.transaction(async (tx) => ...)`) --
 * they're structurally compatible for querying but are distinct types, so
 * this covers both without service code needing to know which one it got.
 */
export type AnyDb =
  | DbClient
  | (Parameters<DbClient["transaction"]>[0] extends (
      tx: infer T,
      ...args: unknown[]
    ) => unknown
      ? T
      : never);
