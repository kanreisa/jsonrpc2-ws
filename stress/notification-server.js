const { Server, Client } = require("../");

const port = parseInt(process.argv[1], 10) || 8080;
start(port).catch(e => console.error(e));

async function start(port) {
    server = new Server({
        wss: {
            port
        },
        open: false
    });

    const stat = {
        connected: 0,
        error: 0,
        subscribe: 0
    }
    server.on("connection", socket => {
        stat.connected++;
        socket.on("close", () => stat.connected--);
    });
    server.on("error", () => stat.error++);
    server.methods.set("subscribe", (socket) => {
        stat.subscribe++;
        socket.joinTo("some-room");
    });

    await new Promise(resolve => server.open(resolve));
    const listenPort = server.wss.address().port;
    console.log("port", listenPort);

    process.on("SIGTERM", () => {
        server.close().then(() => process.exit()).catch(e => console.log(e));
    });
    process.on("SIGINT", () => {
        server.close().then(() => process.exit()).catch(e => console.log(e));
    });

    notify(server).catch((e) => console.log(e));
    show(stat).catch((e) => console.log(e));
}


async function show(stat) {
    while (true) {
        process.stdout.write('\033[2K');
        process.stdout.write(`Connected: ${stat.connected}, Subscribe: ${stat.subscribe}, Error: ${stat.error}\n`);
        process.stdout.write('\033[1F');
        await sleep(1000);
    }
}

async function notify(server) {
    while (true) {
        server.notifyTo("some-room", "some-event", {foo: "alksjfalkjfe;lakjfe;lkajelkajel;kfaue;flkaje;lkauef;lakjea;lekja"});
        await sleep(1);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}