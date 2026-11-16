// PagesRequest.reader on VesnALIA: the one owner (DESIGN §C.2, D-alia-3). VesnALIA authenticates before any plugin handler
// runs (`auth: "local"` on loopback, the Connect login wall remotely), so a request that reaches a handler is
// the owner's and `reader` is never null here. Nothing of the request is read to decide it.
import type { Reader } from "../../core/src/host/index.ts";

export const OWNER: Reader = { id: "owner" };

export function readerOf(): Reader {
  return OWNER;
}
