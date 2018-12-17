const { Server, Client } = require("../");

start().catch(e => console.error(e));

async function start() {
    server = new Server({
        wss: {
            port: 0
        },
        open: false
    });

    await new Promise(resolve => server.open(resolve));
    const port = server.wss.address().port;
    const clients = new Set(); 

    await Promise.race([connect(port, clients), show(clients)]);
}


async function connect(port, clients) {
    while (true) {
        const client = new Client(`ws://localhost:${port}/`, { bufferSendingMessages: false, methodCallTimeout: 20 });
        clients.add(client);
        client.on("disconnect", () =>clients.delete(client));
        await new Promise(resolve => client.once("connected", resolve));
    }
}

async function show(clients) {
    while (true) {
        console.log(clients.size)
        await sleep(1000);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}