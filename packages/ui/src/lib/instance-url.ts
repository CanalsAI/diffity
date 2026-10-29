// A diffity instance started for a PR listens on its own port. Behind the devspaces
// proxy the port is the first label of the host (`<port>--<workspace>.<domain>`),
// so reach it by swapping that label; locally it is plain localhost:<port>.
export function instanceOrigin(port: number): string {
  const { protocol, hostname } = window.location;
  const proxied = hostname.match(/^[\w-]+?--(.+)$/);
  return proxied ? `${protocol}//${port}--${proxied[1]}` : `${protocol}//${hostname}:${port}`;
}
