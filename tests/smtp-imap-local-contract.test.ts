import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, type Server, type TLSSocket } from "node:tls";
import test from "node:test";

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

import { smtpTransportOptions } from "../convex/lib/outreachSmtp.ts";

function localCertificate(): { key: Buffer; cert: Buffer; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "pentra-mail-contract-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-subj", "/CN=localhost", "-keyout", keyPath, "-out", certPath,
    "-days", "1",
  ], { stdio: "ignore" });
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function smtpConnection(socket: TLSSocket, deliveries: string[]) {
  socket.setEncoding("utf8");
  socket.write("220 localhost ESMTP Pentra contract\r\n");
  let buffer = "";
  let data = false;
  let message = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\r\n")) {
      const index = buffer.indexOf("\r\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (data) {
        if (line === ".") {
          deliveries.push(message);
          message = "";
          data = false;
          socket.write("250 2.0.0 queued\r\n");
        } else {
          message += `${line}\n`;
        }
        continue;
      }
      const command = line.split(/\s+/, 1)[0]?.toUpperCase();
      if (command === "EHLO" || command === "HELO") {
        socket.write("250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 1048576\r\n");
      } else if (command === "AUTH") {
        socket.write("235 2.7.0 authenticated\r\n");
      } else if (command === "MAIL" || command === "RCPT") {
        socket.write("250 2.1.0 accepted\r\n");
      } else if (command === "DATA") {
        data = true;
        socket.write("354 end with <CRLF>.<CRLF>\r\n");
      } else if (command === "RSET" || command === "NOOP") {
        socket.write("250 2.0.0 ok\r\n");
      } else if (command === "QUIT") {
        socket.end("221 2.0.0 bye\r\n");
      } else {
        socket.write("500 5.5.1 unsupported\r\n");
      }
    }
  });
}

function imapConnection(socket: TLSSocket) {
  socket.setEncoding("utf8");
  socket.write("* OK Pentra local IMAP ready\r\n");
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\r\n")) {
      const index = buffer.indexOf("\r\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const match = line.match(/^(\S+)\s+(\S+)/);
      if (!match) continue;
      const [, tag, rawCommand] = match;
      const command = rawCommand.toUpperCase();
      if (command === "CAPABILITY") {
        socket.write(
          `* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR ID NAMESPACE\r\n${tag} OK CAPABILITY completed\r\n`,
        );
      } else if (command === "ID") {
        socket.write(`* ID NIL\r\n${tag} OK ID completed\r\n`);
      } else if (command === "AUTHENTICATE" || command === "LOGIN") {
        socket.write(`${tag} OK authenticated\r\n`);
      } else if (command === "NAMESPACE") {
        socket.write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK NAMESPACE completed\r\n`);
      } else if (command === "LIST") {
        socket.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK LIST completed\r\n`);
      } else if (command === "LOGOUT") {
        socket.end(`* BYE logging out\r\n${tag} OK LOGOUT completed\r\n`);
      } else {
        socket.write(`${tag} OK ${command} completed\r\n`);
      }
    }
  });
}

test("customer-managed SMTP and IMAP clients complete real local TLS contracts", async () => {
  const certificate = localCertificate();
  const deliveries: string[] = [];
  const smtp = createServer(
    { key: certificate.key, cert: certificate.cert },
    (socket) => smtpConnection(socket, deliveries),
  );
  const imap = createServer(
    { key: certificate.key, cert: certificate.cert },
    imapConnection,
  );
  const [smtpPort, imapPort] = await Promise.all([listen(smtp), listen(imap)]);
  try {
    const transport = nodemailer.createTransport({
      ...smtpTransportOptions({
        host: "smtp.local.test",
        port: 465,
        username: "sender@example.com",
        password: "test-app-password",
        fromEmail: "sender@example.com",
      }),
      // The production contract contributes TLS/auth/port semantics. Only the
      // hostname is redirected to this process-local harness.
      host: "127.0.0.1",
      port: smtpPort,
      tls: { rejectUnauthorized: false, servername: "localhost" },
    });
    assert.equal(await transport.verify(), true);
    const sent = await transport.sendMail({
      from: "sender@example.com",
      to: "controlled@example.com",
      subject: "Pentra controlled contract",
      text: "Controlled message body.",
      messageId: "<controlled-random-id@example.com>",
    });
    transport.close();
    assert.deepEqual(sent.accepted, ["controlled@example.com"]);
    assert.equal(deliveries.length, 1);
    assert.match(deliveries[0], /Message-ID: <controlled-random-id@example\.com>/i);

    const client = new ImapFlow({
      host: "localhost",
      port: imapPort,
      secure: true,
      auth: { user: "sender@example.com", pass: "test-app-password" },
      tls: { rejectUnauthorized: false },
      logger: false,
    });
    await client.connect();
    assert.equal(client.usable, true);
    await client.logout();
  } finally {
    await Promise.all([close(smtp), close(imap)]);
    certificate.cleanup();
  }
});
