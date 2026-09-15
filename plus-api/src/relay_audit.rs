use chrono::{DateTime, FixedOffset, Utc};
use regex::Regex;
use sqlx::PgPool;
use std::{collections::HashMap, io::SeekFrom, path::Path};
use tokio::{
    fs::File,
    io::{AsyncBufReadExt, AsyncSeekExt, BufReader},
    time::{sleep, Duration},
};

struct PendingRelay {
    first_ip: String,
}

pub async fn run(db: PgPool, log_path: String) {
    let new_request = Regex::new(
        r"\[(?P<ts>[^]]+)\].*New relay request (?P<id>[0-9a-f-]+) from \[::ffff:(?P<ip>[0-9.]+)\]:\d+",
    )
    .expect("valid relay new-request regex");
    let paired = Regex::new(
        r"\[(?P<ts>[^]]+)\].*Relayrequest (?P<id>[0-9a-f-]+) from \[::ffff:(?P<ip>[0-9.]+)\]:(?P<port>\d+) got paired",
    )
    .expect("valid relay paired regex");
    let closed = Regex::new(
        r"\[(?P<ts>[^]]+)\].*Relay of \[::ffff:(?P<ip>[0-9.]+)\]:(?P<port>\d+) closed",
    )
    .expect("valid relay close regex");
    let mut pending: HashMap<String, PendingRelay> = HashMap::new();

    let mut first_open = true;
    loop {
        if !Path::new(&log_path).exists() {
            sleep(Duration::from_secs(2)).await;
            continue;
        }

        let file = match File::open(&log_path).await {
            Ok(file) => file,
            Err(error) => {
                tracing::warn!(%error, %log_path, "unable to open relay audit log");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
        };
        let mut reader = BufReader::new(file);
        // On first boot, avoid replaying an unbounded historical log. After a
        // rotation/recreation, consume the replacement file from its start.
        let seek_from = if first_open { SeekFrom::End(0) } else { SeekFrom::Start(0) };
        if let Err(error) = reader.seek(seek_from).await {
            tracing::warn!(%error, %log_path, "unable to seek relay audit log");
            sleep(Duration::from_secs(2)).await;
            continue;
        }
        first_open = false;

        loop {
            let mut line = String::new();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    let position = reader.stream_position().await.unwrap_or(0);
                    let current_len = tokio::fs::metadata(&log_path)
                        .await
                        .map(|metadata| metadata.len())
                        .unwrap_or(0);
                    if current_len < position {
                        break;
                    }
                    sleep(Duration::from_secs(1)).await;
                    continue;
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(%error, %log_path, "unable to read relay audit log");
                    break;
                }
            }

            if let Some(captures) = new_request.captures(&line) {
                pending.insert(
                    captures["id"].to_string(),
                    PendingRelay {
                        first_ip: captures["ip"].to_string(),
                    },
                );
                continue;
            }

            if let Some(captures) = paired.captures(&line) {
                let Some(first) = pending.remove(&captures["id"]) else {
                    continue;
                };
                let Some(started_at) = parse_timestamp(&captures["ts"]) else {
                    continue;
                };
                if let Err(error) = register_pair(
                    &db,
                    &captures["id"],
                    &first.first_ip,
                    &captures["ip"],
                    captures["port"].parse::<i32>().unwrap_or_default(),
                    started_at,
                )
                .await
                {
                    tracing::warn!(%error, "unable to register relay audit start");
                }
                continue;
            }

            if let Some(captures) = closed.captures(&line) {
                let Some(ended_at) = parse_timestamp(&captures["ts"]) else {
                    continue;
                };
                if let Err(error) = register_close(
                    &db,
                    &captures["ip"],
                    captures["port"].parse::<i32>().unwrap_or_default(),
                    ended_at,
                )
                .await
                {
                    tracing::warn!(%error, "unable to register relay audit close");
                }
            }
        }
    }
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::<FixedOffset>::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f %:z")
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

async fn register_pair(
    db: &PgPool,
    relay_id: &str,
    first_ip: &str,
    second_ip: &str,
    source_port: i32,
    started_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"WITH candidate AS (
             SELECT a.id,
                    CASE WHEN td.ip_address = $1 THEN $2 ELSE $1 END AS source_ip
             FROM connection_audit a
             JOIN devices td ON td.id = a.device_id
             WHERE a.status = 'launched'
               AND a.launched_at > $3 - interval '5 minutes'
               AND a.launched_at <= $3 + interval '1 minute'
               AND td.ip_address IN ($1, $2)
             ORDER BY a.launched_at DESC LIMIT 1
           ), source_device AS (
             SELECT c.id AS audit_id, c.source_ip, d.rustdesk_id, d.hostname
             FROM candidate c
             LEFT JOIN devices d ON d.ip_address = c.source_ip AND d.deleted_at IS NULL
             ORDER BY d.last_seen_at DESC NULLS LAST LIMIT 1
           )
           UPDATE connection_audit a SET
             peer_rustdesk_id = s.rustdesk_id,
             peer_name = COALESCE(s.hostname, s.source_ip),
             source_ip = s.source_ip::inet,
             relay_id = $4::uuid, source_port = $5,
             status = 'active', started_at = $3, updated_at = now()
           FROM source_device s WHERE a.id = s.audit_id"#,
    )
    .bind(first_ip)
    .bind(second_ip)
    .bind(started_at)
    .bind(relay_id)
    .bind(source_port)
    .execute(db)
    .await?;
    Ok(())
}

async fn register_close(
    db: &PgPool,
    source_ip: &str,
    source_port: i32,
    ended_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE connection_audit SET status = 'closed', ended_at = $3, updated_at = now()
           WHERE id = (SELECT id FROM connection_audit
             WHERE status IN ('active','connecting') AND ended_at IS NULL
               AND host(source_ip) = $1 AND source_port = $2
             ORDER BY started_at DESC NULLS LAST LIMIT 1)"#,
    )
    .bind(source_ip)
    .bind(source_port)
    .bind(ended_at)
    .execute(db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_timestamp;

    #[test]
    fn parses_hbbr_timestamp() {
        let value = parse_timestamp("2026-08-12 14:56:09.910770 +00:00").unwrap();
        assert_eq!(value.timestamp(), 1_786_546_569);
    }
}
