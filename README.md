# jsonrpc2-ws

Yet Another Server Library which Implementation of [JSON-RPC 2.0](https://www.jsonrpc.org/specification) over WebSocket for Node.js (w/ TypeScript)

[![npm][npm-img]][npm-url]
[![build][travis-img]][travis-url]

## Installation

```sh
npm install jsonrpc2-ws --save
# or
yarn add jsonrpc2-ws
```

## How to use

### Standalone

```ts
// TypeScript
import { Server as RPCServer } from "jsonrpc2-ws";

const rpc = new RPCServer({
    wss: {
        port: 3000
    }
});

rpc.on("connection", (socket, req) => {
    console.log(`${socket.id} connected!`);

    socket.on("close", () => {
        console.log(`${socket.id} disconnected!`);
    });

    rpc.broadcast("count", { count: rpc.sockets.size });

    // room
    socket.joinTo("general");
    rpc.notifyTo("general", "general.count", { count: rpc.in("general").size });
});

rpc.methods.set("nick", (socket, params) => {
    socket.data.set("nick", params.nick);
});

rpc.methods.set("join", (socket, params) => {
    if (socket.joinTo(params.ch) === true) {
        rpc.notifyTo(params.ch, `${params.ch}.count`, { count: rpc.in(params.ch).size });
        return;
    } else {
        throw new Error("Already joined");
    }
});

rpc.methods.set("chat", (socket, params) => {
    if (!params || !params.ch || !params.message) {
        throw new Error("Invalid request");
    }

    rpc.notifyTo(params.ch, "chat", {
        time: Date.now(),
        id: socket.id,
        nick: socket.data.get("nick") || "anonymous",
        ch: params.ch,
        message: params.message
    });
});
// note: rpc method supports async/await or Promise.
```

### w/ HTTP server

```ts
// TypeScript
import * as http from "http";
import { Server as RPCServer } from "jsonrpc2-ws";

const server = http.createServer();
const rpc = new RPCServer({ wss: { server } });
```

### w/ Express

```ts
// TypeScript
import express = require("express");
import * as http from "http";
import { Server as RPCServer } from "jsonrpc2-ws";

const app = express();
const server = http.createServer(app);
const rpc = new RPCServer({ wss: { server } });
```

## Compatibility

- [StreamJsonRpc](https://github.com/microsoft/vs-streamjsonrpc) (.NET)

## :heart:

BTC: `1CsARqdT2PDLdWng8r2h5pzmyC6xkVnxKw`

![](https://chart.googleapis.com/chart?chs=150x150&cht=qr&chl=1CsARqdT2PDLdWng8r2h5pzmyC6xkVnxKw)

## License

[MIT](LICENSE)

[npm-img]: https://img.shields.io/npm/v/jsonrpc2-ws.svg
[npm-url]: https://www.npmjs.com/package/jsonrpc2-ws
[travis-img]: https://img.shields.io/travis/kanreisa/jsonrpc2-ws.svg
[travis-url]: https://travis-ci.org/kanreisa/jsonrpc2-ws
