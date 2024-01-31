import { createWriteStream } from "node:fs";
import http from "node:http";
import { RemoteInfo } from "dgram";

import { Handlers, makeSession, Session, startVideoStream } from "./session.js";
import { discoverDevices } from "./discovery.js";
import { DevSerial } from "./impl.js";

const opts = {
  debug: false,
  ansi: false,
  discovery_ip: "192.168.40.101", //, "192.168.1.255";
};

let BOUNDARY = "a very good boundary line";
let responses = [];
let sessions: Record<string, Session> = {};

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/camera/")) {
    let devId = req.url.split("/")[2];
    console.log("requested for", devId);
    let s = sessions[devId];

    if (s === undefined) {
      res.writeHead(400);
      res.end("invalid ID");
      return;
    }
    if (!s.connected) {
      res.writeHead(400);
      res.end("Nothing online");
      return;
    }
    res.setHeader("Content-Type", `multipart/x-mixed-replace; boundary="${BOUNDARY}"`);
    responses.push(res);
  } else {
    res.write(`<html>`);
    Object.keys(sessions).forEach((id) => res.write(`<a href="/camera/${id}">${id}</a>`));
    res.write(`</html>`);
    res.end();
  }
});

let devEv = discoverDevices(opts);
devEv.on("discover", (rinfo: RemoteInfo, dev: DevSerial) => {
  if (dev.devId in sessions) {
    console.log(`ignoring ${dev.devId} - ${rinfo.address}`);
    return;
  }
  console.log(`discovered ${dev.devId} - ${rinfo.address}`);
  const s = makeSession(Handlers, dev, rinfo, startVideoStream, opts);
  const withAudio = false;
  s.eventEmitter.on("frame", (frame: Buffer) => {
    let s = `--${BOUNDARY}\r\n`;
    s += "Content-Type: image/jpeg\r\n\r\n";
    responses.forEach((res) => {
      res.write(Buffer.from(s));
      res.write(frame);
    });
  });

  s.eventEmitter.on("disconnect", () => {
    console.log("deleting from sessions");
    sessions[dev.devId] = undefined;
  });
  if (withAudio) {
    const audioFd = createWriteStream(`audio.pcm`);
    s.eventEmitter.on("audio", (frame: Buffer) => {
      audioFd.write(frame);
    });
  }
  sessions[dev.devId] = s;
});

server.listen(1234);
