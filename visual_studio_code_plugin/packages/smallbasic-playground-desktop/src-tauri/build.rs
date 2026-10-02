fn main() {
    // Tauri's externalBin naming needs the exact target triple at runtime;
    // cargo provides it to build scripts via TARGET.
    println!(
        "cargo:rustc-env=SB_TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap_or_default()
    );
    tauri_build::build();
}
