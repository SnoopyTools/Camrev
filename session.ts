import { createSocket, RemoteInfo } from "node:dgram";
import { create_LanSearch, create_P2pAlive } from "./impl.js";
import { Commands, CommandsByValue } from "./datatypes.js";
import { handle_P2PAlive, handle_PunchPkt, handle_P2PRdy, handle_Drw, notImpl, noop } from "./handlers.js";
import { hexdump } from "./hexdump.js";
import EventEmitter from "node:events";
import { SendVideoResolution, SendStartVideo, SendWifiDetails } from "./impl.js";

export type Session = {
  send: (msg: DataView) => void;
  broadcast: (msg: DataView) => void;
  outgoingCommandId: number;
  ticket: number[];
  eventEmitter: EventEmitter;
  dst_ip: string;
  lastReceivedPacket: number;
  connected: boolean;
  devName: string;
  timers: ReturnType<typeof setInterval>[];
};

export type PacketHandler = (session: Session, dv: DataView, rinfo: RemoteInfo) => void;

type opt = {
  debug: boolean;
  ansi: boolean;
};

type msgCb = (
  session: Session,
  handlers: Record<keyof typeof Commands, PacketHandler>,
  msg: Buffer,
  rinfo: RemoteInfo,
  options: opt,
) => void;

const handleIncoming: msgCb = (session, handlers, msg, rinfo, options) => {
  const ab = new Uint8Array(msg).buffer;
  const dv = new DataView(ab);
  const cmd = CommandsByValue[dv.readU16()];
  if (options.debug) {
    console.log(`<< ${cmd}`);
    console.log(hexdump(msg.buffer, { ansi: options.ansi, ansiColor: 1 }));
  }
  handlers[cmd](session, dv, rinfo);
  session.lastReceivedPacket = Date.now();
};

export const makeSession = (handlers: Record<keyof typeof Commands, PacketHandler>, options: opt): Session => {
  const sock = createSocket("udp4");

  sock.on("error", (err) => {
    console.error(`sock error:\n${err.stack}`);
    sock.close();
  });

  sock.on("message", (msg, rinfo) => handleIncoming(session, handlers, msg, rinfo, options));

  sock.on("listening", () => {
    const address = sock.address();
    console.log(`sock listening ${address.address}:${address.port}`);
    sock.setBroadcast(true);

    // ther should be a better way of executing periodic status update
    // requests per device
    let buf = create_LanSearch();
    const int = setInterval(() => {
      session.broadcast(buf);
    }, 2000);
    session.timers.push(int);
    session.broadcast(buf);
  });

  const RECV_PORT = 49512; // important?
  //const BCAST_IP = "192.168.1.255";
  const BCAST_IP = "192.168.40.101";
  const SEND_PORT = 32108;
  sock.bind(RECV_PORT);

  const session: Session = {
    outgoingCommandId: 0,
    ticket: [0, 0, 0, 0],
    lastReceivedPacket: 0,
    eventEmitter: new EventEmitter(),
    connected: false,
    timers: [],
    devName: "",
    send: (msg: DataView) => {
      const raw = msg.readU16();
      const cmd = CommandsByValue[raw];
      if (options.debug) {
        console.log(`>> ${cmd}`);
        if (raw != Commands.P2PAlive) {
          console.log(hexdump(msg.buffer, { ansi: options.ansi, ansiColor: 0 }));
        }
      }
      sock.send(new Uint8Array(msg.buffer), SEND_PORT, session.dst_ip);
    },
    broadcast: (msg: DataView) => {
      sock.send(new Uint8Array(msg.buffer), SEND_PORT, BCAST_IP);
    },
    dst_ip: BCAST_IP,
  };

  session.eventEmitter.on("disconnect", (name: string, rinfo: RemoteInfo) => {
    console.log(`Disconnected from ${name} - ${rinfo.address}`);
    session.dst_ip = "0.0.0.0";
    session.connected = false;
    session.timers.forEach((x) => clearInterval(x));
    session.timers = [];
  });

  session.eventEmitter.on("connect", (name: string, rinfo: RemoteInfo) => {
    console.log(`Connected to ${name} - ${rinfo.address}`);
    session.outgoingCommandId = 0;
    session.dst_ip = rinfo.address;
    session.connected = true;
    session.devName = name;

    const int = setInterval(() => {
      const delta = Date.now() - session.lastReceivedPacket;
      if (delta > 600) {
        let buf = create_P2pAlive();
        session.send(buf);
      }
      if (delta > 8000) {
        session.eventEmitter.emit("disconnect", name, rinfo);
      }
    }, 400);
    session.timers.push(int);
  });

  session.eventEmitter.on("login", () => {
    console.log(`Logged in - ${session.devName}`);
    startVideoStream(session);
  });
  return session;
};

const startVideoStream = (s: Session) => {
  [
    ...SendVideoResolution(s, 2), // 640x480
    SendStartVideo(s),
  ].forEach(s.send);
};

export const Handlers: Record<keyof typeof Commands, PacketHandler> = {
  PunchPkt: handle_PunchPkt,
  P2PAlive: handle_P2PAlive,
  P2pRdy: handle_P2PRdy,
  DrwAck: noop,
  Drw: handle_Drw,

  Close: notImpl,
  LanSearchExt: notImpl,
  LanSearch: notImpl,
  P2PAliveAck: notImpl,
  Hello: notImpl,
  P2pReq: notImpl,
  LstReq: notImpl,
  PunchTo: notImpl,
  HelloAck: notImpl,
  RlyTo: notImpl,
  DevLgnAck: notImpl,
  P2PReqAck: notImpl,
  ListenReqAck: notImpl,
  RlyHelloAck: notImpl, // always
  RlyHelloAck2: notImpl, // if len >1??
};
