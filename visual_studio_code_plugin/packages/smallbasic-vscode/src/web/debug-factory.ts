import * as vscode from "vscode";
import { createWebInlineAdapter } from "./inline-factory";

/**
 * Registers the inline DAP adapters of web mode. All selection logic lives in
 * `./inline-factory.ts` so the desktop host (`src/debug/factory.ts`) and the Web
 * host share exactly one implementation.
 */
export class SmallBasicWebDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public createDebugAdapterDescriptor(
    session: vscode.DebugSession
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return createWebInlineAdapter(this.context, session);
  }
}
