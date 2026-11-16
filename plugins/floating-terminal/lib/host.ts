// The clipboard writer, through VesnALIA.
import { experimental_copyToClipboard } from "@vesnalia/plugin-sdk/app";
import { toast } from "sonner";

/**
 * Write the clipboard through VesnALIA's own writer: VesnALIA Desktop copies through the
 * native clipboard, which works without window focus or a secure origin, both
 * of which `navigator.clipboard` needs.
 */
export function copyText(text: string): void {
  if (text === "") return;
  void experimental_copyToClipboard({ text }).then((ok) => {
    if (!ok) toast.error("Could not copy to the clipboard.");
  });
}
