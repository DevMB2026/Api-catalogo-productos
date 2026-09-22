const dns = require('dns').promises;
const net = require('net');

// Protección anti-SSRF para las URLs que registran terceros (webhooks de
// distribuidores): el servidor solo debe llamar a direcciones PÚBLICAS por
// https — nunca a localhost, a la red interna del hosting ni a endpoints de
// metadatos de la nube (169.254.169.254).
const bloqueadas = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([ip, bits]) => bloqueadas.addSubnet(ip, bits, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['64:ff9b::', 96]
].forEach(([ip, bits]) => bloqueadas.addSubnet(ip, bits, 'ipv6'));

function ipPrivada(ip) {
  // IPv4 mapeada en IPv6 (::ffff:10.0.0.1) se revisa como IPv4.
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return bloqueadas.check(m[1], 'ipv4');
  return bloqueadas.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

// Devuelve null si la URL es aceptable, o el motivo del rechazo (texto).
// Resuelve el DNS en el momento: se llama al registrar Y antes de cada envío,
// porque un dominio puede cambiar a una IP interna después de registrarse.
async function motivoUrlNoPermitida(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return 'La URL no es válida'; }
  if (url.protocol !== 'https:') return 'La URL debe usar https';
  if (url.username || url.password) return 'La URL no debe incluir usuario ni contraseña';

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let ips;
  if (net.isIP(host)) ips = [host];
  else {
    try {
      ips = (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      return 'No se pudo resolver el dominio de la URL';
    }
  }
  if (ips.length === 0 || ips.some(ipPrivada)) return 'La URL debe apuntar a una dirección pública';
  return null;
}

module.exports = { motivoUrlNoPermitida, ipPrivada };
