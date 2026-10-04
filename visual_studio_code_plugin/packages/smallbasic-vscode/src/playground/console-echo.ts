/**
 * Console mirroring shared by the playground page and the desktop shell; a
 * dep-free module so the desktop bridge bundle does not pull in the page.
 */

/** Anything with the panel console + devtools mirror pair of the shell controller. */
export interface ConsoleEchoTarget {
  appendConsole(text: string, foreground: number, background: number): void;
  mirrorToConsole(text: string): void;
}

/** Host output goes to the panel console and stays mirrored to the devtools console. */
export function echoToConsole(controller: ConsoleEchoTarget, text: string): void {
  controller.appendConsole(text, 15, 0);
  controller.mirrorToConsole(text);
}
