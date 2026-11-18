const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const directory = process.argv[2] || "/certs";

if (fs.readdirSync(directory).length !== 0) {
  console.error("Certificate directory is not empty; refusing to overwrite.");
  process.exit(1);
}

process.umask(0o077);

function openssl(args) {
  const result = spawnSync("openssl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error || result.status !== 0) {
    console.error("OpenSSL command failed. Certificate generation stopped.");
    process.exit(1);
  }
}

openssl([
  "req", "-x509",
  "-newkey", "rsa:3072",
  "-sha256", "-nodes",
  "-days", "30",
  "-subj", "/CN=GigZLK Local Development CA",
  "-addext", "basicConstraints=critical,CA:TRUE",
  "-addext", "keyUsage=critical,keyCertSign,cRLSign",
  "-keyout", `${directory}/ca.key`,
  "-out", `${directory}/ca.crt`,
]);

openssl([
  "req", "-new",
  "-newkey", "rsa:2048",
  "-sha256", "-nodes",
  "-subj", "/CN=gateway",
  "-keyout", `${directory}/gateway.key`,
  "-out", `${directory}/gateway.csr`,
]);

const extensions = `${directory}/gateway.ext`;

fs.writeFileSync(
  extensions,
  [
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    "subjectAltName=DNS:gateway,DNS:localhost,IP:127.0.0.1",
    "",
  ].join("\n"),
);

openssl([
  "x509", "-req",
  "-in", `${directory}/gateway.csr`,
  "-CA", `${directory}/ca.crt`,
  "-CAkey", `${directory}/ca.key`,
  "-CAcreateserial",
  "-days", "30",
  "-sha256",
  "-extfile", extensions,
  "-out", `${directory}/gateway.crt`,
]);

openssl([
  "verify",
  "-CAfile", `${directory}/ca.crt`,
  "-verify_hostname", "gateway",
  `${directory}/gateway.crt`,
]);

openssl([
  "verify",
  "-CAfile", `${directory}/ca.crt`,
  "-verify_hostname", "localhost",
  `${directory}/gateway.crt`,
]);

fs.unlinkSync(`${directory}/gateway.csr`);
fs.unlinkSync(extensions);

console.log("Development certificates generated.");
console.log("Certificate chain and gateway/localhost names verified.");
console.log("Certificates expire after 30 days. Development use only.");