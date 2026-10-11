Test-only TLS material for test/netdebug-*.test.js: a throwaway CA and a
leaf for shop.test / www.shop.test (valid until 2045). Loopback servers in
the tests use them; nothing else trusts this CA. Not a secret.
