const { Server, Client } = require("../");

process.title = "notification client";
const port = parseInt(process.argv[1], 10) || 8080;
start(port).catch(e => console.error(e));

async function start(port) {
    const clients = new Set(); 
    const stat = {
        try: 0,
        connected: 0,
        error: 0,
        disconnect: 0
    }

    show(stat).catch((e) => console.log(e));
    await connect(port, clients, stat);
}


async function connect(port, clients, stat) {
    while (true) {
        stat.try++;
        const client = new Client(`ws://localhost:${port}/`, { bufferSendingMessages: false, methodCallTimeout: 20, autoConnect: false, reconnection: false });
        clients.add(client);
        client.on("error", (e) => {
            stat.error++;
        });
        client.methods.set("some-event", () => {});

        try {
            await client.connect();
        } catch (e) {
            continue;
        }
        stat.connect++;
        client.on("disconnect", () => {
            stat.connected--;
            clients.delete(client);
        });

        client.call("subscribe").catch(() => void 0);
        setTimeout(async () => {
            stat.disconnect++;
            await client.disconnect();
        }, Math.random() * 300000);
        stat.connected++;
        while (stat.connected >= 1000) {
            await sleep(1);
        }
    }
}

async function show(stat) {
    while (true) {
        process.stdout.write('\033[2K');
        process.stdout.write(`Try: ${stat.try}, Connected: ${stat.connected}, Disconnect: ${stat.disconnect}, Error: ${stat.error}\n`);
        process.stdout.write('\033[1F');
        await sleep(1000);
    }
}


async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}