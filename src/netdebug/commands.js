// "You know the drill" (design §5): the CLI twin of each local check, so
// the report doubles as a runbook. Inputs are validated targets; every
// value is shell-quoted anyway.
const q = (value) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(String(value)) ? String(value) : `'${String(value).replace(/'/g, "'\\''")}'`);

export function drillCommands(target) {
  const url = `${target.scheme}://${[80, 443].includes(target.port) ? target.host : `${target.host}:${target.port}`}${target.path}`;
  const hostPort = `${target.host}:${target.port}`;
  return {
    "L-DNS-01": `dig +short ${q(target.host)}`,
    "L-DNS-02": `curl -sS -H 'accept: application/dns-json' ${q(`https://cloudflare-dns.com/dns-query?name=${target.host}&type=A`)}`,
    "L-DNS-03": `dig +trace ${q(target.host)}`,
    "L-DNS-04": `dig +trace ${q(target.host)}`,
    "L-TCP-01": `nc -vz -w 5 ${q(target.host)} ${target.port}`,
    "L-TLS-01": `openssl s_client -connect ${q(hostPort)} -servername ${q(target.host)} -alpn h2,http/1.1 </dev/null`,
    "L-TLS-02": `openssl s_client -connect ${q(hostPort)} -servername ${q(target.host)} -showcerts </dev/null`,
    "L-TLS-03": `openssl s_client -connect ${q(hostPort)} -servername ${q(target.host)} </dev/null 2>/dev/null | openssl x509 -noout -enddate`,
    "L-HTTP-01": `curl -sS -o /dev/null -w '%{http_code} dns %{time_namelookup} connect %{time_connect} tls %{time_appconnect} ttfb %{time_starttransfer} total %{time_total}\\n' ${q(url)}`,
    "L-HTTP-02": `curl -sSIL --max-redirs 10 ${q(url)}`,
    "L-HTTP-03": `curl -sS -o /dev/null -D - ${q(url)}`,
    "L-NET-01": `traceroute -n -q 3 -m 20 ${q(target.host)}`,
    "L-NET-02": `tracepath -n ${q(target.host)}`,
    "L-NET-03": `ping -c 4 ${q(target.host)}`,
    "L-NET-04": `ip route get $(dig +short ${q(target.host)} | tail -1)`,
  };
}

export { q as shellQuote };
