// Shared helpers for authored tools: calls back into the Hamster control plane.
// The control plane is the policy enforcement point. Every controlled action is
// authorized there, not by prompts and not only by eve's approval config.

const API_URL = process.env.HAMSTER_API_URL ?? "http://localhost:8080";
const SECRET = process.env.HAMSTER_INTERNAL_SECRET ?? "dev-internal-secret";

export async function internalCall<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hamster-internal-secret": SECRET,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const message =
      (parsed as { error?: string } | null)?.error ?? `control plane returned HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

export async function policyCheck(
  taskId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<PolicyDecision> {
  return internalCall<PolicyDecision>("/internal/policy/check", { taskId, action, params });
}
