import path from "node:path";
import * as vscode from "vscode";
import { blazorHostMissing, csharpHostMissing, csharpHostMissingFunctions } from "../common/messages";
import { CSharpRunner } from "../run/csharp-runner";
import { BlazorRunner } from "../run/blazor-runner";
import { createWebInlineAdapter } from "../web/inline-factory";

export class SmallBasicDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async createDebugAdapterDescriptor(session: vscode.DebugSession): Promise<vscode.DebugAdapterDescriptor | undefined> {
    // `mode: "web"` never falls back to a local process even when one is
    // available: it must share the browser-compatible inline adapters with
    // VS Code for the Web (see src/web/inline-factory.ts).
    if (session.configuration.mode === "web") {
      return createWebInlineAdapter(this.context, session);
    }

    const backend = session.configuration.backend === "csharp"
      ? "csharp"
      : session.configuration.backend === "blazor" ? "blazor" : "javascript";

    if (backend === "blazor") {
      const host = BlazorRunner.resolveHostCommand(this.context.extensionPath);
      if (!host) {
        void vscode.window.showErrorMessage(blazorHostMissing("调试"));
        return undefined;
      }

      return new vscode.DebugAdapterExecutable(host.executable, [...host.argumentsPrefix, "debug"], {
        cwd: host.cwd
      });
    }

    if (backend === "csharp") {
      const host = CSharpRunner.resolveHostCommand(this.context.extensionPath);
      if (!host) {
        void vscode.window.showErrorMessage(csharpHostMissing("调试"));
        return undefined;
      }

      if (!await CSharpRunner.supportsFunctions(host)) {
        void vscode.window.showErrorMessage(csharpHostMissingFunctions("调试"));
        return undefined;
      }

      // The RunHost speaks DAP natively on stdin/stdout in "debug" mode.
      return new vscode.DebugAdapterExecutable(host.executable, [...host.argumentsPrefix, "debug"], {
        cwd: host.cwd
      });
    }

    const adapterPath = path.join(this.context.extensionPath, "dist", "debug", "adapter.js");
    return new vscode.DebugAdapterExecutable(process.execPath, [adapterPath], {
      cwd: this.context.extensionPath,
      env: {
        ...process.env,
        SBPLUGIN_EXTENSION_ROOT: this.context.extensionPath
      }
    });
  }
}
