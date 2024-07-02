const http = require("http");
const WebSocketServer = require("websocket").server;
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");

const server = http.createServer((req, res) => {
  if (req.url === "/users") {

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(users.map((user) => user.name)));
  } else if (req.url === "/dellog") {
    fs.unlink("server.log", (err) => {
      if (err) {
        console.error(`Error deleting the file: ${err}`);
        return;
      }
      console.log('File deleted successfully!');
      res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({message:"Deleted"}));
    });
    
  } else if (req.url === "/log") {
    fs.readFile(path.join(__dirname, "server.log"), "utf8", (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Error reading log file");
        return;
      }
      const logs = data
        .trim()
        .split("\n")
        .reverse()
        .map((log) => `<li>${log}</li>`)
        .join("");
      const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Server Logs</title>
                <style>
                    body { font-family: Arial, sans-serif; }
                    ul { list-style-type: none; padding: 0; }
                    li { margin-bottom: 5px; }
                </style>
            </head>
            <body>
                <h1>Server Logs</h1>
                <ul>${logs}</ul>
                <script>
                    // Reload logs every 5 seconds
                    setInterval(() => {
                        fetch('/log')
                            .then(response => response.text())
                            .then(data => {
                                document.querySelector('ul').innerHTML = data;
                            });
                    }, 60000);
                </script>
            </body>
            </html>
        `;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    });
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

const PORT = 3000;
const users = [];
const usersIncall = [];

server.listen(PORT, () => {
  console.log("Server Started...");
});

const websocket = new WebSocketServer({
  httpServer: server,
});

// Function to log messages to console and file with timestamp
const logToFile = (message) => {
  const istDateTime = DateTime.now()
    .setZone("Asia/Kolkata")
    .toLocaleString(DateTime.DATETIME_FULL);
  const log = `• ${istDateTime} - ${message}\n`;
  console.log(log); // Output to console
  fs.appendFile(path.join(__dirname, "server.log"), log, (err) => {
    if (err) console.error("Error writing to log file:", err);
  }); // Append to log file
};

websocket.on("request", (req) => {
  const connection = req.accept();

  connection.on("message", (message) => {
    try {
      const data = JSON.parse(message.utf8Data);
      const user = findUser(data.name);

      logToFile(`Received message: ${JSON.stringify(data)}`);
      logToFile(`Received Type: ${data.type}`);

      switch (data.type) {
        case "store_user":
          if (user != null) {
            connection.send(JSON.stringify({ type: "User Already Exists..." }));
            logToFile(`User ${data.name} already exists.`);
            return;
          }
          const newUser = {
            name: data.name,
            conn: connection,
          };
          users.push(newUser);
          sendOnlineUsers();
          logToFile(`User ${data.name} stored.`);
          logToFile(`Online Users ${users.map((user) => user.name)} .`);
          break;

        case "start_call":
          let userToCall = findUser(data.target);
          if (userToCall) {
            const responseMsg = "User is online and ready for call...";
            connection.send(
              JSON.stringify({ type: "call_response", data: responseMsg })
            );
            logToFile(responseMsg);
            if (!usersIncall.includes(data.name)) {
              usersIncall.push(data.name);
            }
            if (!usersIncall.includes(data.target)) {
              usersIncall.push(data.target);
            }
            sendOnlineUsers();
          } else {
            const responseMsg = "User is not online...";
            connection.send(
              JSON.stringify({ type: "call_response", data: responseMsg })
            );
            logToFile(responseMsg);
          }
          break;

        case "create_offer":
          let userToReceiveOffer = findUser(data.target);
          if (userToReceiveOffer) {
            userToReceiveOffer.conn.send(
              JSON.stringify({
                type: "offer_received",
                name: data.name,
                data: data.data.sdp,
              })
            );
            logToFile(`Offer sent to ${data.target} by ${data.name}.`);
            if (!usersIncall.includes(data.name)) {
              usersIncall.push(data.name);
            }
            if (!usersIncall.includes(data.target)) {
              usersIncall.push(data.target);
            }
            sendOnlineUsers();
          }
          break;

        case "create_answer":
          let userToReceiveAnswer = findUser(data.target);
          if (userToReceiveAnswer) {
            userToReceiveAnswer.conn.send(
              JSON.stringify({
                type: "answer_received",
                name: data.name,
                data: data.data.sdp,
              })
            );
            logToFile(`Answer sent to ${data.target} by ${data.name}.`);
            if (!usersIncall.includes(data.name)) {
              usersIncall.push(data.name);
            }
            if (!usersIncall.includes(data.target)) {
              usersIncall.push(data.target);
            }
            sendOnlineUsers();
          }
          break;

        case "ice_candidate":
          let userToReceiveIceCandidate = findUser(data.target);
          if (userToReceiveIceCandidate) {
            userToReceiveIceCandidate.conn.send(
              JSON.stringify({
                type: "ice_candidate",
                name: data.name,
                data: {
                  sdpMLineIndex: data.data.sdpMLineIndex,
                  sdpMid: data.data.sdpMid,
                  sdpCandidate: data.data.sdpCandidate,
                },
              })
            );
            logToFile(`ICE candidate sent to ${data.target} by ${data.name}.`);
          }
          break;

        case "end_call":
          let userToEndCall = findUser(data.target);
          if (userToEndCall) {
            userToEndCall.conn.send(
              JSON.stringify({
                type: "end_call",
                name: data.name,
                data: "",
              })
            );
            logToFile(`Call Ended by ${data.name} to ${data.target}.`);
            if (usersIncall.includes(data.name)) {
              const index = usersIncall.indexOf(data.name);
              usersIncall.splice(index, 1);
            }
            if (usersIncall.includes(data.target)) {
              const index = usersIncall.indexOf(data.target);
              usersIncall.splice(index, 1);
            }
            sendOnlineUsers();
          }
          break;
      }
    } catch (error) {
      logToFile(`Received message: ${message.utf8Data}`);
      logToFile(`Error : ${error}`);
      connection.send(
        JSON.stringify({ Error: "An Internal Error Occurred...." })
      );
    }
  });

  connection.on("close", () => {
    users.forEach((user) => {
      if (user.conn === connection) {
        logToFile(`Connection closed for ${user.name}.`);
        if (usersIncall.includes(user.name)) {
          const index = usersIncall.indexOf(user.name);
          usersIncall.splice(index, 1);
        }
        users.splice(users.indexOf(user), 1);
        logToFile(users);
      }
    });
    sendOnlineUsers();
  });
});

const findUser = (username) => {
  for (let i = 0; i < users.length; i++) {
    if (users[i].name == username) {
      return users[i];
    }
  }
};

const sendOnlineUsers = () => {
  for (let eachuser of users) {
    let onlineUsers = users
      .filter(
        (user) =>
          user.name !== eachuser.name && !usersIncall.includes(user.name)
      )
      .map((user) => user.name);

    if (eachuser.conn && typeof eachuser.conn.send === "function") {
      eachuser.conn.send(
        JSON.stringify({ type: "online_users", data: onlineUsers })
      );
    } else {
      console.error(`Connection for user ${eachuser.name} is not available.`);
    }
  }
  logToFile(`Online Users ${users.map((user) => user.name)} .`);
  logToFile(` Users in call${usersIncall} .`);
};
