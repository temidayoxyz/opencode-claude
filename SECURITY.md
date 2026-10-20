# Security

This experimental local gateway accepts authenticated loopback requests and attaches to the user's OpenCode service. OpenCode executes tools with its own configuration and permissions. Review those settings before launching in a project.

## Reporting

Use this repository's private vulnerability reporting under the Security tab. Please include the affected version and a minimal reproduction with fixture data. Never submit provider keys, local gateway tokens, exported Desktop profiles, private journals or real conversations in a public issue.

## Local state

Credentials and session journals belong outside the checkout. POSIX state files use restrictive modes; Windows uses inherited user ACLs. State is not encrypted with DPAPI. Other processes running as the same OS user remain inside the trust boundary.

Request hashes and durable reservations prevent automatic replay of uncertain tool actions. Corrupt journals fail closed. Inspect interrupted tasks in OpenCode before starting a new conversation. A replay cache is not a transaction or rollback mechanism for external effects.

Provider eligibility, pricing and quotas still apply. The project does not export provider credentials, spoof access eligibility or choose paid fallbacks.
