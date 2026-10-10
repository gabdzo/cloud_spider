# TLS routes

Edge, passthrough, and reencrypt fail in different places. `curl -kv` and `openssl s_client -connect host:443 -servername host` show which certificate you actually got and whether the handshake finished.

Edge terminates at the router. The pod speaks HTTP. The route carries `tls.certificate` and `tls.key`, or a TLS secret the router is configured to use. The certificate and key must be a pair, and the name on the certificate must be the route host. A wildcard for the apps domain also matches. The backend Service port is the HTTP port.

Passthrough does not decrypt. The route has no certificate. Whatever the pod presents is what the client sees. A wrong SAN is visible in `s_client` even when the TCP connection works. Fix the pod secret, not the route certificate fields. Those fields are ignored for passthrough.

Reencrypt decrypts at the router and encrypts a new connection to the pod. The client sees the route certificate. The router validates the backend certificate with `destinationCACertificate`. A wrong CA produces a backend TLS error and the application body never arrives. The backend certificate has to chain to that CA. Include the hostname the router uses. On this lab the backend certificate uses the route hostname.

`insecureEdgeTerminationPolicy: None` means HTTP on port 80 is not offered. Test with `https://`.

CRC resolves `*.apps-crc.testing` locally. You do not need a public zone. If `curl` cannot resolve the name, check the host against `oc get route` and the cluster apps domain before you change certificates.
