# External signal

- OpenChamber's Task summary deliberately projects child **tool** parts only; it excludes assistant text and shows the Task output separately: https://github.com/openchamber/openchamber/blob/main/packages/ui/src/components/chat/message/parts/taskToolModel.ts
- OpenChamber's collapsed Task activity shows the last six entries and a `+N more` count, while Output has its own disclosure: https://github.com/openchamber/openchamber/blob/main/packages/ui/src/components/chat/message/parts/ToolPart.tsx
- VesnALIA SDK defines native delegation nesting: `childRef` identifies the child and child deltas link with `parentRef`; terminal `summary` rides `item.close`: `node_modules/@vesnalia/plugin-sdk/bundled-types/alia-plugin-sdk-provider-bridge.d.ts:3053-3062`.
- What changes: copy OpenChamber's information architecture, not its React implementation. Feed VesnALIA only operational child events and let VesnALIA own limits, disclosure, styling, accessibility, and output rendering.
