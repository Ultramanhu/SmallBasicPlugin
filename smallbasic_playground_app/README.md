# smallbasic_playground_app

Tauri v2 desktop shell for the Small Basic Monaco playground - the local
application variant described in [docs/design/10](../docs/design/10-Playground与Tauri本地应用.md)
(§17-19). The browser static site (`runhost/web`) stays unchanged; this
package adds the desktop window, three C# CLI backends (.NET 8, .NET
Framework 4.8 and the Windows-only **Compiler** target that builds a net48 EXE
and then runs or debugs it) and the DAP debug bridge on top of the same page.

The package lives at the repository root and is a **standalone npm project**:
it is not a member of the `visual_studio_code_plugin` workspace (it never needs
the extension's dependencies), it keeps its own `node_modules` and lockfile, and
its TS bridge imports the shared page sources from
`visual_studio_code_plugin/packages/smallbasic-vscode/src/` relatively.

## Layout

```
scripts/
  build-desktop.mjs       # bundles src/desktop-entry.ts -> dist/desktop.js
  stage-playground.mjs    # assembles runhost/playground/ (app/ + bin/ + resources/ + manifest)
src/
  desktop-bridge.ts       # typed invoke/Channel surface of the Rust shell
  backend-capabilities.ts # CLI backend availability & graphics matrix
  local-cli-debug-transport.ts  # web debug protocol <-> stdio DAP bridge
  desktop-entry.ts        # activates the CLI backends inside the shared page
src-tauri/                # Rust shell: session manager, DAP framing, commands
```

The page itself is built once by the existing `build:playground` script of
`smallbasic-vscode`. This package never forks the HTML, the language worker
or the debug panel; it only stages them (`app/`), adds the desktop bridge
(`desktop.js` + one script tag) and the per-target sidecars/payloads.

## Build & run

Prerequisites: Node.js >= 20, .NET SDK 8+, Rust (stable) with the MSVC
toolchain on Windows.

```powershell
# from the repository root
cd smallbasic_playground_app
npm install        # standalone project: @tauri-apps/cli, esbuild, typescript, vitest

npm run stage      # assemble runhost/playground/ (builds page + hosts)
npm run dev        # tauri dev against the staged app
npm run build:app  # tauri build (installers under src-tauri/target/release/bundle)
npm test           # bridge / transport / staging-boundary specs
```

`stage-playground.mjs` flags: `--skip-build` (reuse existing bundles),
`--skip-sidecars`, `--target <triple>`, `--configuration Debug`.

### Intermediates and disk usage

Nothing below is tracked (see `.gitignore`), but together they are the largest
thing in the working tree - 10 GB and more after a few cross-target builds:

| Path | What it is | Size driver |
|---|---|---|
| `src-tauri/target/` | Rust artifacts of every profile **and every cross target** (`target/<triple>/...` for arm64, Android, ...) | several GB per target |
| `src-tauri/gen/` | Tauri's generated Android/iOS projects (`tauri android init` / `tauri ios init`) | ~250 MB, Android/Gradle build output included |
| `obj/` | Sidecar/staging scratch of `stage-playground.mjs` (publish dirs, AppImage cache) | ~0.7 GB |

Rust's own `cargo clean` only knows the first one, so the repository entry point
has a switch for all three:

```powershell
.\runhost\Build-PlaygroundApp.ps1 -Clean          # delete target/, gen/ and obj/, then build
.\runhost\Build-PlaygroundApp.ps1 -Clean -StageOnly
```

`-Clean` deletes the directories directly (no recycle bin) and then runs the
normal pipeline, so the next build is a from-scratch Rust compile. For a wipe
without rebuilding, delete the three directories above by hand. The WSL build
cache (`~/tauri-target` inside the distro, used for Linux targets on Windows) is
deliberately left alone - remove it with `rm -rf ~/tauri-target` in the distro.

Because the two hosts publish differently, they are staged differently:

| Host | Publish | Staged as | Shipped through |
|---|---|---|---|
| .NET 8 (`net8.0-windows` on Windows, portable `net8.0` elsewhere) | self-contained single file, `-r <rid> -p:SmallBasicStageSidecar=true` | `bin/smallbasic-csharp-net8-<triple>[.exe]` | `bundle.externalBin` |
| .NET Framework 4.8 (Windows only) | `-f net48` with no RID and no single-file switch | `resources/dotnet/csharp-net48/**` (folder) | `bundle.resources`, declared only by `tauri.windows.conf.json` |
| net48 compiler payload (Windows only) | `-f net48` for both `SmallBasic.Compiler.Tool` and `SmallBasic.CompiledDebugAdapter`, plus the RunHost template copied under `template/net48` | `resources/dotnet/compiler-net48/**` (folder) | `bundle.resources`, used by the Playground compiler backend |

Both net48 projects publish into the same payload directory, exactly like
`runhost/compiler` does: the compiled DAP adapter needs the compiler assemblies
and the entry point resolves its siblings relative to its own folder, which is
the working directory the Rust shell launches it with.

The .NET Framework host is a folder deployment: the framework resolves the
sibling assemblies relative to the executable, so the Rust shell launches it
with that folder as its working directory. A `bundle.resources` glob that
matches nothing fails the Tauri build (`tauri-utils resources.rs` ->
`GlobPathNotFound`), which is why the resources entry lives in the
platform-specific config instead of the base one.

Tauri strips the triple suffix from `externalBin` names when bundling, so the
installed app carries `smallbasic-csharp-net8.exe` next to the main executable
(the Rust resolver probes both names). Staging also prunes `bin/` down to the
current target's sidecar and removes the payload trees of the backends removed
on 2026-10-03, so nothing stale can leak into a later package.

`runhost/playground/` is regenerated by `runhost/Build-PlaygroundApp.ps1` and is
**tracked in full**, so a fresh clone runs without rebuilding: the portable
executable, the .NET 8 sidecar (`bin/`), the .NET Framework 4.8 host and the
net48 compiler payload (`resources/`), the staged page (`app/`) and the
installers (`bundles/`).

Large binaries travel through the repository's Git LFS setup
(`.gitattributes` routes `*.exe`, `*.dll`, `*.msi`, `*.wasm`, `*.br`, `*.dat`,
...). Most of `app/` is byte-identical to the already tracked `runhost/web` and
`runhost/blazor/wwwroot` files, so those stay ordinary content-deduplicated
blobs; the new LFS payload is essentially the sidecar, the installers and the
portable executable. Every build intermediate (`src-tauri/target/`,
`src-tauri/gen/`, `obj/`, `dist/`) stays ignored - see
[Intermediates and disk usage](#intermediates-and-disk-usage).

Two `.gitignore` negations are required because broader rules would otherwise
drop shipped files: `!runhost/playground/bin/` (the generic `bin` output rule)
and `!runhost/playground/bundles/*.msi` (the global `core.excludesFile` ignores
`*.msi`).

The repository-level entry point is `runhost/Build-PlaygroundApp.ps1`, which
runs the four steps above and also archives the installers (`-SkipSidecars`
reuses already staged payloads). `Build-All.ps1` calls it as its step 4
(`-SkipPlayground` opts out).

Package shapes and target selection:

```text
.\runhost\Build-PlaygroundApp.ps1                                  # host target, installers + bundles\
.\runhost\Build-PlaygroundApp.ps1 -StageOnly                       # run package only: stage + portable exe, no bundling
.\runhost\Build-PlaygroundApp.ps1 -Target aarch64-pc-windows-msvc  # one explicit target
.\runhost\Build-PlaygroundApp.ps1 -BundleTargets win-x64,win-arm64,linux-x64,android-arm64
```

`-BundleTargets` builds and archives several platforms in one invocation; it
accepts aliases (`win-x64`, `win-arm64`, `linux-x64`, `linux-arm64`,
`android-arm64`, `macos-*`) or full Rust triples. Windows targets run
`tauri build` natively (cross builds need the matching `rustup target`),
Linux targets build inside the WSL distro named by `-WslDistro` (webkit2gtk
deps + rustup + cargo-tauri required; the sidecar is still cross-published on
the Windows side), and Android targets run `tauri android build` with the
SDK/NDK/JDK 17+ resolved by `-AndroidSdkHome` / `-JavaHome` (a stale system
`JAVA_HOME` pointing at JDK 11 is skipped automatically). Because the staging
root holds one target's payloads at a time, the LAST target of the list also
determines what `runhost/playground/` (portable exe, `bin/`, `resources/`,
`manifest.json`) is left holding; `bundles/` accumulates every target.

Its outputs, all under `runhost/playground/`:

| Path | What it is |
|---|---|
| `SmallBasic.Playground.exe` | Portable executable, runnable in place. On Windows the Tauri resource directory is the executable's own directory (`tauri-utils platform.rs`), and `resolve_sidecar` probes `<resource_dir>\bin` while `resolve_staged_resource` probes `<resource_dir>\<relative>`, so all three backends next to it are found without an installer or any environment variable. |
| `app/` | Staged page (also embedded into the release executable). |
| `bin/` | The target's .NET 8 sidecar. |
| `resources/` | Windows only: the .NET Framework 4.8 folder host and the net48 compiler payload. |
| `bundles/` | Installers, doc 10 §18.5 naming: `SmallBasic.Playground-<version>-<triple>.msi` / `-setup.exe`. |

The version comes from the repository `version.json` (the same one the Visual
Studio and VS Code extensions use); `tools/sync-version.mjs` writes it into
`package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and
`Build-PlaygroundApp.ps1` refuses to package when `tauri.conf.json` disagrees.

## Backend offering

| Backend | Where it runs | Graphics |
|---|---|---|
| JavaScript (TextWindow) | in the page | no |
| Blazor WASM (GraphicsWindow) | in the page (WebAssembly) | yes |
| C# (.net Framework 4.8) | CLI host, Windows only | yes (native `GraphicsWindow`) |
| C# (.net 8.0) | CLI host | Windows native; text-only elsewhere |
| Compiler (.net Framework 4.8) | compiles to a net48 EXE in the directory the user picks, then runs or debugs that artifact (Windows only) | yes (the net48 template host) |

Each CLI entry is registered only when the capability query finds its staged
payload, so a browser build of the same page keeps the two Web backends.
Graphics programs pick the .NET 8 host when it can draw (no OS runtime
prerequisite), then the .NET Framework 4.8 host; otherwise the page keeps its
default Web Blazor backend. The compiler backend is never auto-selected:
compiling on every graphics run would be a surprise.

### The compiler backend (replaces the old Compile button)

Run and Debug on this backend need an artifact directory, so selecting it
reveals a **compile directory** field next to the backend selector:

- the field starts empty and only the user fills it, through the **更改**
  button (a native folder picker);
- pressing Run or Debug with an empty field opens the same picker and then
  continues - a dismissed picker aborts the action and the next attempt asks
  again;
- the program is compiled into that directory as `<program>.exe` next to its
  `.smallbasic.json` manifest, `.smallbasic.source` payload and `lib\` support
  folder, mirroring `SmallBasic.Compiler.Tool compile --file <program.sb>
  --outputDir <directory>`;
- recompiling into a directory that already holds an artifact overwrites it in
  place, so running twice never accumulates stale files;
- Run launches the produced EXE (`run`), Debug starts
  `SmallBasic.CompiledDebugAdapter.exe` and hands it the artifact directory as
  `launch.outputDirectory`, because the session program itself lives in the app
  cache rather than next to the EXE.

## Security model (doc 10, §19.2)

- The main window capability only grants `core:default`; the app's own
  commands are the narrow surface (`run_program`, `start_debug`, `send_input`,
  `debug_request`, `terminate_session`, file dialogs, capability query).
- The page can never name an executable, argument list, environment or working
  directory - those derive from the backend enum in Rust. The compiler backend
  is the one path that accepts a directory from the user, and it only ever
  reaches the bundled compiler tool: the artifact directory is passed to
  `compile --outputDir`, never executed from.
- Scratch programs live in `sessions/<id>/<program>.sb` under the app cache and
  are removed when the process exits. The RunHost flavours keep the historical
  fixed `program.sb`; the compiler backend names the file after the program,
  because the artifact name is derived from it.
- App exit, window close and session stop all funnel through the same child
  tree teardown (`taskkill /T` / process-group kill after a disconnect grace).

## Status (2026-10-03)

Implemented locally: desktop shell + capability query (phase 1), CLI run for
all three .NET backends with stdout/stderr/stdin and tree teardown (phase 2) and
the generic DAP bridge for breakpoints/steps/stack/variables (phase 3).
Cross-platform CI, signing and notarization (phase 5) are not set up yet;
Windows x64 is the verified host.

The Node and Blazor CLI backends were removed on 2026-10-03 (doc 10 §17.2):
CLI Blazor did not launch reliably in the packaged app, and the pair also cost
about 147 MB of sidecar payload per installer. The single C# entry was then
split into the two .NET flavours described above, which also restored the
`resources/` payload tree. The compiler backend replaced the Windows-only
**Compile** button afterwards: compiling is now a backend choice, and the
button, its `registerCompileHandler` extension point and the `compile_program`
command are gone.

### Cross-platform bundles (2026-10-03, built on this Windows host)

| Target | Bundles | How |
|---|---|---|
| `x86_64-pc-windows-msvc` | `.msi` + `-setup.exe` | `Build-PlaygroundApp.ps1` / `tauri build` |
| `aarch64-pc-windows-msvc` | `.msi` + `-setup.exe` | `tauri build --target aarch64-pc-windows-msvc` (cross publish `win-arm64` sidecar) |
| `x86_64-unknown-linux-gnu` | `.deb` + `.rpm` + `.AppImage` | WSL Ubuntu: apt webkit2gtk deps, `cargo tauri build` (sidecar cross-published from Windows) |
| `aarch64-linux-android` | `.apk` + `.aab` (dev-signed) | Android SDK/NDK via sdkmanager, `tauri android init` + `tauri android build --target aarch64` |

Platform notes:

- Mobile has no sidecar (`tauri.android.conf.json` empties `bundle.externalBin`);
  the shell compiles with the two Web backends only. `rfd` is dependency-gated
  to desktop triples and the dialog commands return an error stub under
  `#[cfg(mobile)]`; `lib.rs::run` carries `#[cfg_attr(mobile,
  tauri::mobile_entry_point)]`, without which the `.so` fails the bundler's
  runtime-symbol validation.
- The Android dev keystore (`src-tauri/keystore/`, gitignored) signs APK/AAB
  through a `signingConfigs` block in `gen/android/app/build.gradle.kts`;
  production signing belongs to release CI. Gradle daemons cache the
  environment - after changing `PATH`, run `gradlew --stop` or the `BuildTask`
  fails to start `npm.cmd` and the error surfaces masked as its `npm.bat`
  fallback.
- macOS/iOS cannot be bundled from Windows (Xcode-only); the staging script
  already accepts the apple triples for CI runners.

## Tests

`tests/` covers the bridge without a Tauri window, so it runs under this
package's own Vitest suite (`npm test` here - `Build-Plugin.ps1` runs it next to
the VS Code workspace suite):

- `backend-capabilities.spec.ts`, `desktop-bridge.spec.ts` - availability
  matrix (all three .NET backends, the artifact-directory flag) and runtime
  detection;
- `local-cli-debug-transport.spec.ts` - web debug protocol <-> DAP mapping
  (line bases, breakpoint validation, input/stop classification, stack and
  variables, early-response correlation, the compiler backend's artifact
  directory on both `start_debug` and DAP `launch`);
- `staging-boundary.spec.ts` - the browser build carries no Tauri bridge, the
  staged tree keeps one platform-independent `app/`, `bin/` holds exactly the
  .NET 8 sidecar and `resources/` only the two Windows-only payload trees;
- `cli-debug-contract.spec.ts` - spawns both staged RunHost flavours with the
  exact argv the Rust shell uses and asserts a breakpoint sent before `launch`
  verifies and stops (skipped until `npm run stage` produced them);
- `compiled-backend-contract.spec.ts` - drives the compiler backend end to end
  against the staged payload: compile into the chosen directory, overwrite an
  existing artifact, run it with the shell's `run` argument and debug it through
  the adapter's `launch.outputDirectory` (same skip rule).

The staged page is also exercised by
`visual_studio_code_plugin/tests/webview/playground-desktop.spec.ts`, which
serves `runhost/playground/app` in a browser: the bridge must stay inert there
(no CLI backend, the compile-directory field stays hidden, no console errors)
while the Web JavaScript backend still runs, and injecting a Tauri IPC stand-in
must add exactly three CLI options and reveal the compile-directory field for
the compiler backend only.
