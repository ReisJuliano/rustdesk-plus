ALTER TABLE devices
  ADD COLUMN ip_address   TEXT,
  ADD COLUMN online_since TIMESTAMPTZ;
