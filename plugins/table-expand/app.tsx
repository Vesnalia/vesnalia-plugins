import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { startTableExpand } from "./expand";
import "./app.css";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "table-expand",
    mount({ signal }) {
      return startTableExpand(signal);
    },
  });
});
