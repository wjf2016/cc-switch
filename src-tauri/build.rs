fn main() {
    tauri_build::build();

    // Windows: Embed Common Controls v6 manifest for test binaries
    //
    // When running `cargo test`, the generated test executables don't include
    // the standard Tauri application manifest. Without Common Controls v6,
    // `tauri::test` calls fail with STATUS_ENTRYPOINT_NOT_FOUND.
    //
    // This workaround:
    // 1. Embeds the manifest into test binaries via /MANIFEST:EMBED
    // 2. Uses /MANIFEST:NO for the main binary to avoid duplicate resources
    //    (Tauri already handles manifest embedding for the app binary)
    #[cfg(target_os = "windows")]
    {
        // 动态寻找并复制 mt.exe 到 target 目录下，解决非 VS 命令行下 LNK1158 无法运行 mt.exe 的问题
        let sdk_bin_root = std::path::Path::new("C:\\Program Files (x86)\\Windows Kits\\10\\bin");
        let mut mt_path = None;
        if sdk_bin_root.exists() {
            if let Ok(entries) = std::fs::read_dir(sdk_bin_root) {
                for entry in entries.flatten() {
                    let path = entry.path().join("x64").join("mt.exe");
                    if path.exists() {
                        mt_path = Some(path);
                        break;
                    }
                }
            }
        }

        if let Some(mt_src) = mt_path {
            if let Ok(out_dir_val) = std::env::var("OUT_DIR") {
                let mut target_dir = std::path::PathBuf::from(out_dir_val);
                target_dir.pop(); // out
                target_dir.pop(); // build script name
                target_dir.pop(); // build

                let mt_dest = target_dir.join("mt.exe");
                if !mt_dest.exists() {
                    let _ = std::fs::copy(&mt_src, &mt_dest);
                }

                let mt_deps_dest = target_dir.join("deps").join("mt.exe");
                if !mt_deps_dest.exists() {
                    let _ = std::fs::create_dir_all(target_dir.join("deps"));
                    let _ = std::fs::copy(&mt_src, &mt_deps_dest);
                }
            }
        }

        let manifest_path = std::path::PathBuf::from(
            std::env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"),
        )
        .join("common-controls.manifest");
        let manifest_arg = format!("/MANIFESTINPUT:{}", manifest_path.display());

        // 重新注释以解决中文路径下 mt.exe 运行乱码并报错 LNK1327 的问题。主程序开发模式下无需此清单嵌入。
        // println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        // println!("cargo:rustc-link-arg={}", manifest_arg);
        // Avoid duplicate manifest resources in binary builds.
        println!("cargo:rustc-link-arg-bins=/MANIFEST:NO");
        println!("cargo:rerun-if-changed={}", manifest_path.display());
    }
}
