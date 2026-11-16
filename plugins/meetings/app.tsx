// alia-plugin-meetings — frontend entry: the "Встречи" page.
//
// Compiled by `alia plugin build` into dist/app.js + dist/app.css. React and
// @vesnalia/plugin-sdk/app are provided by the VesnALIA app at load time. The page
// lives in src/app/ (DESIGN §8.5); it imports only types from
// src/shared/rpc-contract.ts so zod stays out of the bundle.
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { PANEL_PATH } from "./src/app/constants";
import { MeetingsPage } from "./src/app/meetings-page";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "meetings",
    title: "Встречи",
    icon: "Mic",
    // Routed at /plugins/meetings/meetings; deep links use subPath:
    // "<meetingId>", "<meetingId>/t/<segmentId>", "zoom-login".
    path: PANEL_PATH,
    component: MeetingsPage,
  });
});
