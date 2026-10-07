import * as vscode from "vscode";
import { Compilation, ExecutionEngine, ExecutionMode, ExecutionState } from "smallbasic-lang-core";
import { ansiColorize } from "../common/ansi";
import { BufferedTextWindowPlugin } from "../common/text-window";

export class SmallBasicTerminalSession extends BufferedTextWindowPlugin implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number>();
  private readonly lineBuffer: string[] = [];

  private engine: ExecutionEngine | undefined;
  private scheduled = false;
  private disposed = false;
  private waitingForExitConfirmation = false;
  private exitCode = 0;

  public readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  public readonly onDidClose?: vscode.Event<number> = this.closeEmitter.event;

  public run(compilation: Compilation): void {
    this.engine = new ExecutionEngine(compilation);
    this.engine.libraries.TextWindow.plugin = this;
    this.schedule(0);
  }

  public open(): void {
    this.writeEmitter.fire("\u001b[2J\u001b[3J\u001b[;H");
  }

  public close(): void {
    this.disposed = true;
    if (this.engine && this.engine.state !== ExecutionState.Terminated) {
      this.engine.terminate();
    }
  }

  public handleInput(data: string): void {
    if (this.disposed) {
      return;
    }

    if (this.waitingForExitConfirmation) {
      if (data === "\r") {
        this.closeEmitter.fire(this.exitCode);
      }
      return;
    }

    switch (data) {
      case "\r": {
        const line = this.lineBuffer.join("");
        this.lineBuffer.length = 0;
        this.writeEmitter.fire("\r\n");

        this.pushInput(line);
        this.schedule(0);
        return;
      }
      case "\u007f": {
        if (this.lineBuffer.length > 0) {
          this.lineBuffer.pop();
          this.writeEmitter.fire("\b \b");
        }
        return;
      }
      default:
        this.lineBuffer.push(data);
        this.writeEmitter.fire(data);
    }
  }

  public writeText(value: string, appendNewLine: boolean): void {
    this.writeEmitter.fire(this.colorize(value + (appendNewLine ? "\r\n" : "")));
  }

  private schedule(delayMs: number): void {
    if (this.scheduled || this.disposed) {
      return;
    }

    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      this.tick();
    }, delayMs);
  }

  private tick(): void {
    if (this.disposed || !this.engine) {
      return;
    }

    this.engine.execute(ExecutionMode.RunToEnd);

    switch (this.engine.state) {
      case ExecutionState.Running:
        this.schedule(0);
        break;
      case ExecutionState.BlockedOnInput:
        this.schedule(this.pendingInputKind === undefined ? 10 : 50);
        break;
      case ExecutionState.Terminated:
        if (this.engine.lastRuntimeError) {
          this.writeEmitter.fire(this.colorize(`\r\n[Runtime Error] ${this.engine.lastRuntimeError.code}: ${this.engine.lastRuntimeError.message}\r\n`));
        } else if (this.engine.exception) {
          this.writeEmitter.fire(this.colorize(`\r\n[Runtime Error] ${this.engine.exception.toString()}\r\n`));
        }
        this.pauseBeforeClose(0);
        break;
      case ExecutionState.Paused:
        this.schedule(10);
        break;
      default:
        this.pauseBeforeClose(1);
        break;
    }
  }

  private colorize(text: string): string {
    return ansiColorize(text, this.getForegroundColor(), this.getBackgroundColor());
  }

  private pauseBeforeClose(exitCode: number): void {
    this.waitingForExitConfirmation = true;
    this.exitCode = exitCode;
    this.writeEmitter.fire(this.colorize("\r\n[Program finished] 按 Enter 关闭终端...\r\n"));
  }
}

