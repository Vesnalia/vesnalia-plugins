export default function (pi) {
  pi.registerCommand("alia-probe", {
    description: "Regression probe: a command that does not start an agent run",
    handler: async () => pi.sendMessage({customType: "alia-probe", content: "Command executed", display: true}),
  });
  // Prevent any model request while proving whether slash input was dispatched.
  pi.on("input", (event) => {
    pi.sendMessage({customType: "alia-probe-fallback", content: `FELL THROUGH: ${event.text}`, display: true});
    return {action: "handled"};
  });
}
