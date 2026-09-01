import { ConnectorFailure, policyFailure } from './errors.mjs';

function parseIpv4(address) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return null;
  const octets = address.split('.').map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets;
}

function ipv4Number(octets) {
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function inIpv4Cidr(value, base, bits) {
  if (bits === 0) return true;
  const divisor = 2 ** (32 - bits);
  return Math.floor(value / divisor) === Math.floor(base / divisor);
}

const BLOCKED_IPV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4Number(parseIpv4(base)), bits]);

function expandIpv6(address) {
  let input = address.toLowerCase().split('%')[0];
  if (!input.includes(':')) return null;
  const ipv4Tail = input.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (ipv4Tail) {
    const octets = parseIpv4(ipv4Tail);
    if (!octets) return null;
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    input = `${input.slice(0, input.length - ipv4Tail.length)}${replacement}`;
  }
  if ((input.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = input.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  if (![...left, ...right].every((part) => /^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!input.includes('::') && missing !== 0)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right].map((part) => Number.parseInt(part, 16));
  return parts.length === 8 ? parts : null;
}

export function classifyIpAddress(address) {
  const input = typeof address === 'string' && address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const ipv4 = parseIpv4(input);
  if (ipv4) {
    const value = ipv4Number(ipv4);
    const blocked = BLOCKED_IPV4.some(([base, bits]) => inIpv4Cidr(value, base, bits));
    return { family: 4, allowed: !blocked, normalized: ipv4.join('.') };
  }
  const ipv6 = expandIpv6(input);
  if (!ipv6) return { family: null, allowed: false, normalized: input };
  const globallyRoutable = (ipv6[0] & 0xe000) === 0x2000;
  const documentation = ipv6[0] === 0x2001 && ipv6[1] === 0x0db8;
  const protocolAssignments = ipv6[0] === 0x2001 && ipv6[1] <= 0x01ff;
  const sixToFour = ipv6[0] === 0x2002;
  const documentationV6 = ipv6[0] === 0x3fff && (ipv6[1] & 0xfff0) === 0;
  return {
    family: 6,
    allowed: globallyRoutable && !documentation && !protocolAssignments && !sixToFour && !documentationV6,
    normalized: ipv6.map((part) => part.toString(16).padStart(4, '0')).join(':'),
  };
}

export function assertPublicAddressSet(addresses, targetClass) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new ConnectorFailure('DNS resolution produced no addresses.', {
      failureType: 'dns_failure', safeDetailCode: 'DNS_EMPTY_ANSWER', targetClass,
      retryClass: 'transient', beforeEgress: true,
    });
  }
  const normalized = [];
  for (const address of addresses) {
    const result = classifyIpAddress(address);
    if (!result.allowed) throw policyFailure('DESTINATION_ADDRESS_BLOCKED', targetClass);
    normalized.push(result.normalized);
  }
  return [...new Set(normalized)].sort();
}

export function assertConnectedAddress(connectedAddress, approvedAddresses, targetClass) {
  const connected = classifyIpAddress(connectedAddress);
  if (!connected.allowed || !approvedAddresses.includes(connected.normalized)) {
    throw policyFailure('CONNECTED_ADDRESS_NOT_DNS_PINNED', targetClass);
  }
}

export function assertNoDnsRebinding(before, after, targetClass) {
  if (before.length !== after.length || before.some((address, index) => address !== after[index])) {
    throw policyFailure('DNS_REBINDING_DETECTED', targetClass);
  }
}
