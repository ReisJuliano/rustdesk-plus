use crate::config::ServerConfig;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use uuid::Uuid;

fn run(command: &mut Command, description: &str) -> anyhow::Result<()> {
    let output = command.output()?;
    if output.status.success() {
        return Ok(());
    }
    anyhow::bail!(
        "{description} falhou: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )
}

fn copy_file(source: impl AsRef<Path>, target: impl AsRef<Path>) -> anyhow::Result<()> {
    fs::copy(source, target)?;
    Ok(())
}

pub fn build(config: &ServerConfig) -> anyhow::Result<PathBuf> {
    if config.server_ip.trim().is_empty()
        || config.server_key.trim().is_empty()
        || config.api_url.trim().is_empty()
    {
        anyhow::bail!("configure o servidor antes de baixar o instalador");
    }

    let output_path = PathBuf::from(
        std::env::var("INSTALLER_PATH")
            .unwrap_or_else(|_| "/app/generated/rustdesk-installer.exe".to_string()),
    );
    let metadata_path = output_path
        .parent()
        .unwrap_or_else(|| Path::new("/app/generated"))
        .join("installer-config.json");
    let expected_metadata = serde_json::to_vec(config)?;

    if output_path.exists()
        && fs::read(&metadata_path)
            .map(|value| value == expected_metadata)
            .unwrap_or(false)
    {
        return Ok(output_path);
    }

    let source_root = PathBuf::from(
        std::env::var("INSTALLER_SOURCE_DIR")
            .unwrap_or_else(|_| "/app/build-src".to_string()),
    );
    let work_root = std::env::temp_dir().join(format!("rustdesk-plus-{}", Uuid::new_v4()));
    let agent_dir = work_root.join("agent");
    let installer_dir = work_root.join("installer");
    fs::create_dir_all(&agent_dir)?;
    fs::create_dir_all(&installer_dir)?;

    for file in ["go.mod", "main.go"] {
        copy_file(source_root.join("agent").join(file), agent_dir.join(file))?;
        copy_file(
            source_root.join("installer").join(file),
            installer_dir.join(file),
        )?;
    }

    run(
        Command::new("go")
            .current_dir(&agent_dir)
            .args(["mod", "tidy"]),
        "preparação das dependências do agente",
    )?;

    let agent_exe = installer_dir.join("rustdesk-agent.exe");
    let agent_ldflags = format!("-s -w -H=windowsgui -X main.apiURL={}", config.api_url);
    run(
        Command::new("go")
            .current_dir(&agent_dir)
            .env("CGO_ENABLED", "0")
            .env("GOOS", "windows")
            .env("GOARCH", "amd64")
            .args(["build", "-trimpath", "-ldflags", &agent_ldflags, "-o"])
            .arg(&agent_exe)
            .arg("."),
        "build do agente",
    )?;

    run(
        Command::new("go")
            .current_dir(&installer_dir)
            .args(["mod", "tidy"]),
        "preparação das dependências do instalador",
    )?;

    let installer_ldflags = format!(
        "-s -w -H=windowsgui -X main.serverIP={} -X main.serverKey={} -X main.apiURL={}",
        config.server_ip, config.server_key, config.api_url
    );
    let temporary_output = work_root.join("rustdesk-installer.exe");
    run(
        Command::new("go")
            .current_dir(&installer_dir)
            .env("CGO_ENABLED", "0")
            .env("GOOS", "windows")
            .env("GOARCH", "amd64")
            .args(["build", "-trimpath", "-ldflags", &installer_ldflags, "-o"])
            .arg(&temporary_output)
            .arg("."),
        "build do instalador",
    )?;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&temporary_output, &output_path)
        .or_else(|_| fs::copy(&temporary_output, &output_path).map(|_| ()))?;
    fs::write(metadata_path, expected_metadata)?;
    let _ = fs::remove_dir_all(work_root);
    Ok(output_path)
}
