const { Server, Client } = require("../");
const chai = require("chai");

describe("Server-Client", function () {
    let server;
    let serverSocket;
    let client;
    this.beforeAll(async function () {
        server = new Server({
            wss: {
                port: 0
            },
            open: false
        });

        await new Promise(resolve => server.open(resolve));
        server.once("connection", socket => serverSocket = socket);

        const port = server.wss.address().port;
        client = new Client(`ws://localhost:${port}/`);

        await new Promise(resolve => client.once("connected", resolve));
    });

    describe("server-side", () => {
        describe("procedure call", function () {
            it("can be called", async function () {
                let called = false;
                server.methods.set("myMethod", () => {
                    called = true;
                });

                await client.call("myMethod");
                chai.expect(called).is.true;
            });

            it("can called with params", async function () {
                let called = false;
                let recievedParam;
                const param = { a: [1] };
                server.methods.set("myMethod", (socket, param) => {
                    called = true;
                    recievedParam = param;
                });

                await client.call("myMethod", param);
                chai.expect(called).is.true;
                chai.expect(recievedParam).deep.eq(param);
            });

            it("can return value", async function () {
                const res = { a: ["the return value"] };
                server.methods.set("myMethod", () => {
                    return res;
                });

                const actual = await client.call("myMethod");
                chai.expect(actual).deep.eq(res);
            });

            it("should throw method not found error", async function () {
                try {
                    await client.call("myMethod");
                    chai.assert.fail;
                } catch (e) {
                    chai.expect(e).has.property("code", -32601);
                }
            });
        });

        describe("notification", () => {
            it("can be sent", function (done) {
                server.methods.set("myMethod", () => {
                    done();
                });
                client.notify("myMethod");
            });

            it("can be sent with params", async function () {
                const param = { a: [1] };
                server.methods.set("myMethod", (socket, recievedParam) => {
                    chai.expect(recievedParam).deep.eq(param);
                    done();
                });
                client.notify("myMethod", param);
            });

            describe("send with unkown method", () => {
                it("should emit `notification_error` event", (done) => {
                    client.once("notification_error", error => {
                        chai.expect(error).has.property("code", -32601);
                        done();
                    });
                    client.notify("myMethod");
                });
            });
        });

        describe("invalid request handling", function ()  {
            let messageListener;
            describe("none json message", () => {
                it("should sent error response", done => {
                    client._ws.on("message", messageListener = message => {
                        try {
                            const json = JSON.parse(message);
                            chai.expect(json).has.property("error");
                            chai.expect(json.error).has.property("code", -32700);
                            done();
                        } catch (e) {
                            chai.assert.fail();
                        }
                    });

                    client._ws.send("@@@@@");
                });
                describe("client", () => {
                    it("should emit `error_response` event", done => {
                        client.on("error_response", res => {
                            chai.expect(res.error).has.property("code", -32700);
                            done();
                        });
                        client._ws.send("@@@@@");
                    });
                });
            });

            describe("invalid request", () => {
                it("should sent error response", done => {
                    client._ws.on("message", messageListener = message => {
                        try {
                            const json = JSON.parse(message);
                            chai.expect(json).has.property("error");
                            chai.expect(json.error).has.property("code", -32600);
                            done();
                        } catch (e) {
                            chai.assert.fail();
                        }
                    });

                    client._ws.send("{}");
                });
                describe("client", () => {
                    it("should emit `error_response` event", done => {
                        client.on("error_response", res => {
                            chai.expect(res.error).has.property("code", -32600);
                            done();
                        });
                        client._ws.send("{}");
                    });
                });
            });
            this.afterEach(() => {
                client._ws.removeListener("message", messageListener);
            });
        });
    });

    describe("client-side", () => {
        describe("notification", function () {
            it("can be sent", function (done) {
                client.methods.set("myMethod", () => {
                    done();
                });
                serverSocket.notify("myMethod");
            });

            it("can be sent with params", async function () {
                const param = { a: [1] };
                client.methods.set("myMethod", (socket, recievedParam) => {
                    chai.expect(recievedParam).deep.eq(param);
                    done();
                });
                serverSocket.notify("myMethod", param);
            });

            describe("send with unkown method", () => {
                it("should emit notification error event on socket", (done) => {
                    serverSocket.once("notification_error", error => {
                        chai.expect(error).has.property("code", -32601);
                        done();
                    });
                    serverSocket.notify("myMethod");
                });
                it("should emit `notification_error` event on server", (done) => {
                    server.once("notification_error", (socket, error) => {
                        chai.expect(socket).equal(serverSocket);
                        chai.expect(error).has.property("code", -32601);
                        done();
                    });
                    serverSocket.notify("myMethod");
                });
            });
        });

    });

    this.afterEach(() => {
        server.methods.clear();
        server.removeAllListeners();
        client.methods.clear();
        client.removeAllListeners();
    });

    this.afterAll(function () {
        server.close();
        client.disconnect();
    });
});
