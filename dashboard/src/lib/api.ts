const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  created_at: string;
};

export type Branch = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
};

export type Device = {
  id: string;
  rustdesk_id: string;
  uuid: string;
  hostname: string | null;
  os: string | null;
  alias: string | null;
  description: string | null;
  favorite: boolean;
  ip_address: string | null;
  online_since: string | null;
  branch_id: string | null;
  owner_user_id: string | null;
  last_seen_at: string | null;
  online: boolean;
  created_at: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
  created_at: string;
};

export type DeviceTagRow = {
  device_id: string;
  tag_id: string;
  name: string;
  color: string;
};

export type ExecJobResult = {
  job_id: string;
  cmd: string;
  powershell: boolean;
  results: Array<{
    device_id: string;
    hostname: string | null;
    alias: string | null;
    rustdesk_id: string;
    ip_address: string | null;
    output: string;
    exit_code: number | null;
    done: boolean;
    started_at: string;
    finished_at: string | null;
  }>;
};

export type Stats = {
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  total_branches: number;
  total_users: number;
};

export type ServerConfig = {
  server_ip: string;
  server_key: string;
  api_url: string;
  rustdesk_password: string;
};

export type SetupStatus = ServerConfig & {
  configured: boolean;
};

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      setToken(null);
      window.location.href = "/login";
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `request failed: ${res.status}`);
  }
  return res.json();
}

export async function login(email: string, password: string) {
  return request<{ token: string; user: User }>("/admin/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getSetupStatus() {
  return request<SetupStatus>("/setup/status");
}

export async function completeSetup(data: {
  email: string;
  password: string;
  name: string;
  server_ip: string;
  api_url: string;
}) {
  return request<{ token: string; user: User }>("/setup", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listBranches() {
  return request<Branch[]>("/admin/branches");
}

export async function createBranch(name: string, parent_id?: string) {
  return request<Branch>("/admin/branches", {
    method: "POST",
    body: JSON.stringify({ name, parent_id: parent_id || null }),
  });
}

export async function deleteBranch(id: string) {
  return request<{ ok: boolean }>(`/admin/branches/${id}`, { method: "DELETE" });
}

export async function listUsers() {
  return request<User[]>("/admin/users");
}

export async function createUser(email: string, password: string, name: string, role: string) {
  return request<User>("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, name, role }),
  });
}

export async function deleteUser(id: string) {
  return request<{ ok: boolean }>(`/admin/users/${id}`, { method: "DELETE" });
}

export async function listDevices(filter: {
  branch_id?: string;
  search?: string;
  online?: boolean;
  favorite?: boolean;
} = {}) {
  const params = new URLSearchParams();
  if (filter.branch_id) params.set("branch_id", filter.branch_id);
  if (filter.search) params.set("search", filter.search);
  if (filter.online !== undefined) params.set("online", String(filter.online));
  if (filter.favorite !== undefined) params.set("favorite", String(filter.favorite));
  const qs = params.toString();
  return request<Device[]>(`/admin/devices${qs ? `?${qs}` : ""}`);
}

export async function getDevice(id: string) {
  return request<Device>(`/admin/devices/${id}`);
}

export async function deleteDevice(id: string) {
  return request<{ ok: boolean }>(`/admin/devices/${id}`, { method: "DELETE" });
}

export async function patchDevice(id: string, data: { alias?: string; description?: string }) {
  return request<Device>(`/admin/devices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function setDeviceBranch(deviceId: string, branchId: string | null) {
  return request<Device>(`/admin/devices/${deviceId}/branch`, {
    method: "POST",
    body: JSON.stringify({ branch_id: branchId }),
  });
}

export async function toggleFavorite(id: string) {
  return request<Device>(`/admin/devices/${id}/favorite`, { method: "POST" });
}

export async function getStats() {
  return request<Stats>("/admin/stats");
}

export async function listTags() {
  return request<Tag[]>("/admin/tags");
}

export async function createTag(name: string, color: string) {
  return request<Tag>("/admin/tags", { method: "POST", body: JSON.stringify({ name, color }) });
}

export async function deleteTag(id: string) {
  return request<{ ok: boolean }>(`/admin/tags/${id}`, { method: "DELETE" });
}

export async function listDeviceTags(deviceId: string) {
  return request<Tag[]>(`/admin/devices/${deviceId}/tags`);
}

export async function addDeviceTag(deviceId: string, tagId: string) {
  return request<{ ok: boolean }>(`/admin/devices/${deviceId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tag_id: tagId }),
  });
}

export async function removeDeviceTag(deviceId: string, tagId: string) {
  return request<{ ok: boolean }>(`/admin/devices/${deviceId}/tags/${tagId}`, { method: "DELETE" });
}

export async function getAllDeviceTags() {
  return request<DeviceTagRow[]>("/admin/device-tags");
}

export async function execCommand(body: {
  cmd: string;
  powershell?: boolean;
  targets?: string[];
  tag_id?: string;
}) {
  return request<{ job_id: string; targets: number; sent: number }>("/admin/exec", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getExecResults(jobId: string) {
  return request<ExecJobResult>(`/admin/exec/${jobId}`);
}

export async function getServerConfig() {
  return request<ServerConfig>("/admin/server-config");
}

export async function saveServerConfig(data: ServerConfig) {
  return request<{ ok: boolean }>("/admin/server-config", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function downloadInstaller() {
  const token = getToken();
  const res = await fetch(`${API_URL}/admin/installer`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      setToken(null);
      window.location.href = "/login";
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `request failed: ${res.status}`);
  }
  return res.blob();
}
