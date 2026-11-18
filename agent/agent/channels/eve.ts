// Self-hosted auth for the Hamster worker/chat agent.
// The agent is not exposed to browsers directly; the control plane is the only
// caller and authenticates with HTTP Basic over a private Compose network.
// localDev() is not usable here: it only admits local-dev servers, which this
// production self-hosted process is not.

import { eveChannel } from "eve/channels/eve";
import { httpBasic } from "eve/channels/auth";

const username = process.env.HAMSTER_AGENT_USERNAME ?? "hamster";
const password = process.env.HAMSTER_AGENT_PASSWORD ?? "dev-agent-password";

export default eveChannel({
  auth: [httpBasic({ username, password })],
});
