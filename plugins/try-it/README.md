# Try It

Hands a running build to a person for testing. The agent calls `try_it`, and the composer shows a link, a QR code, what changed, and a checklist. Their verdict goes back to the agent.

Localhost and private addresses are refused, because they do not open on a phone. The composer is replaced while a request is pending; **Later** dismisses it.
