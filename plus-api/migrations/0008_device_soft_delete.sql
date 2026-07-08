-- Soft delete de dispositivos.
-- Apagar não remove a linha, apenas marca deleted_at. Assim o heartbeat/sysinfo
-- do cliente RustDesk não recria o dispositivo (os UPSERTs passam a ter
-- WHERE devices.deleted_at IS NULL no DO UPDATE) e é possível restaurar depois.
ALTER TABLE devices ADD COLUMN deleted_at TIMESTAMPTZ;

-- Índice parcial: acelera a listagem da lixeira sem custo nas linhas ativas.
CREATE INDEX idx_devices_deleted ON devices (tenant_id) WHERE deleted_at IS NOT NULL;
