import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { filesRpcContract } from "./src/contracts";
import { createFileService } from "./src/file-service";
import { createUploadHandler } from "./src/upload";

export { filesRpcContract } from "./src/contracts";

export default function plugin(alia: AliaPluginApi) {
  alia.rpc.register(filesRpcContract, createFileService(alia));
  alia.http.route("POST", "/upload", createUploadHandler(alia), { auth: "token" });
  alia.log.info("Files plugin loaded");
}
