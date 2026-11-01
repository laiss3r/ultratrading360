/** Browser-local identity revision + serialized cookie mutations. Reads never write cookies. */
let revision = 0;
let writes: Promise<unknown> = Promise.resolve();
export const identityRevision = () => revision;
export const changeIdentity = () => ++revision;
export function sessionWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.then(operation, operation);
  writes = next.then(() => undefined, () => undefined);
  return next;
}
