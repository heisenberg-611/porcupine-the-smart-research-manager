/**
 * The shape of a Drive entry, in one place.
 *
 * It was declared twice: this interface, hand-written in `file-list.tsx`, and
 * `any[]` in the server action that feeds it — under an
 * `eslint-disable-next-line` that was on the wrong line and therefore
 * suppressed nothing. Two declarations of the same thing, one of them not a
 * declaration at all.
 *
 * Typing the action from `listFolderFiles` instead exposed why the `any` was
 * there: Google's `Schema$File` marks every field OPTIONAL, and this project
 * compiles with `exactOptionalPropertyTypes`, so `id?: string | null` is not
 * assignable to `id: string | null | undefined`. That is a real difference —
 * a missing key and a key holding undefined are distinguishable — and the way
 * through it is one type both sides agree on, not a cast at the boundary.
 *
 * Deliberately NOT exported from `actions.ts`. That file is `"use server"`,
 * where every export is expected to be an async function; a type export there
 * is erased before it reaches the runtime but is exactly the kind of thing a
 * future compiler check would object to.
 */
export interface DriveFile {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  webViewLink?: string | null;
  iconLink?: string | null;
  modifiedTime?: string | null;
  createdTime?: string | null;
  owners?: Array<{ displayName?: string | null; photoLink?: string | null }> | null;
}
