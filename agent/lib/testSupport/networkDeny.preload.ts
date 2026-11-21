/**
 * Node --import entry for offline tests.
 *
 * Evaluated before every test-file module graph, so provider modules cannot
 * capture pre-guard aliases of http/https/net/tls/fetch.
 *
 * Clears key/proxy env, then installs the network-deny harness.
 */
import { clearProviderAndProxyEnv, installNetworkDenyHarness } from "./networkDeny.harness.ts";

clearProviderAndProxyEnv();
installNetworkDenyHarness();
