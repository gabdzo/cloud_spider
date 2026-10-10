from __future__ import annotations

import ipaddress
import urllib.request

CHECKIP_URL = "https://checkip.amazonaws.com"


def operator_ip() -> str:
    with urllib.request.urlopen(CHECKIP_URL, timeout=5) as response:
        ip = response.read().decode().strip()
    return str(ipaddress.IPv4Address(ip))
