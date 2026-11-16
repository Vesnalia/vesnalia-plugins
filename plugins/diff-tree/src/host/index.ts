import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "../shared/contracts";
import { history, committedChanges, committedPatch, committedContents } from "./git-history";

import { imageDiff, worktreeImage } from "./images";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    imageDiff: ({ workspace, ...input }, context) => imageDiff(workspace, input, context.signal),
    imageFile: ({ workspace, path }, context) => worktreeImage(workspace, path, context.signal),
    history: ({ workspace }, context) => history(workspace, context.signal),
    changes: ({ workspace, selection }, context) => committedChanges(workspace, selection, context.signal),
    patch: ({ workspace, ...input }, context) => committedPatch(workspace, input, context.signal),
    contents: ({ workspace, ...input }, context) => committedContents(workspace, input, context.signal),
  },
});
