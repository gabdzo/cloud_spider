# Faults

Certificates are generated under `.state/lab12/` when setup runs.

## edge

The route certificate is signed for `edge-lab12.<apps-domain>`. The private key on the route belongs to a different certificate. The pair does not match, so the router cannot complete the handshake. The backend is plain HTTP on Service `edge` port 8080, which is what edge termination expects.

Replace both `tls.certificate` and `tls.key` with a matching pair whose SAN is the route host.

## passthrough

The route termination is already passthrough, so the router does not present its own certificate. The pod certificate is for `wrong.example.com`. Clients that check the name fail, and `openssl s_client` shows the wrong DNS name.

Put a certificate and key for `passthrough-lab12.<apps-domain>` in Secret `passthrough-tls` and restart the pod. The process reads `/tls/tls.crt` and `/tls/tls.key`.

## reencrypt

The backend certificate is signed by a lab backend CA and the process is serving TLS. The route's `destinationCACertificate` is a different CA, so the router does not trust the backend and the client receives a failure instead of `REENCRYPT-OK`.

Set `destinationCACertificate` to the CA that signed the backend certificate. The certificate the client sees is the route certificate, not the backend certificate. Both must be valid for their side of the connection. The backend certificate should include the route hostname.
