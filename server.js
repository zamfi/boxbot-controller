const fs = require('fs');
const mime = require('mime');
const url = require('url');
const util = require('util');
const SerialPort = require("serialport");
const WebSocketServer = require('websocket').server;


/******************
 *                *
 * The Web Server *
 *                *
 ******************/

// what web port to listen to? Common values for development systems
// are 8000, 8080, 5000, 3000, etc. Round numbers greater than 1024.
const PORT = 8000;

// create the server module
let server = require('http').createServer(async (req, res) => {
  console.log("Got request!", req.method, req.url);
  
  // get the file path out of the URL, stripping any "query string"
  let path = url.parse(req.url, true).pathname
  
  // then, based on the file path:
  switch (path) {
  case '/': 
  case '/sketch.js':
  case '/style.css':
  case '/index.html':
    // if it's one of these known files above, then...
    
    // remove any path elements that go "up" in the file hierarchy
    let safePath = path.split('/').filter(e => ! e.startsWith('.')).join('/');
    
    // also. requests without a file path should be served the index.html file.
    if (safePath === '/') {
      safePath = '/index.html';
    }
    
    // try to get the requested file.
    try {
      let fullPath = '.' + safePath;
      if ((await util.promisify(fs.stat)(fullPath)).isFile()) {
        // if it's a valid file, then serve it! The mime library uses the
        // file extension to figure out the "mimetype" of the file.
        res.writeHead(200, {'Content-Type': mime.getType(safePath)});
        
        // create a "read stream" and "pipe" (connect) it to the response.
        // this sends all the data from the file to the client.
        fs.createReadStream(fullPath).pipe(res);
      } else {
        // if it's not a valid file, return a "404 not found" error.
        console.log("unknown request", path);
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end("Couldn't find your URL...");
      }
    } catch (err) {
      // if there's an error reading the file, return a 
      // "500 internal server error" error
      console.log("Error reading static file?", err);
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.end("Failed to load something...try again later?");
    }
    break;
  default:
    // if it's not one of the known files above, then return a
    // "404 not found" error.
    console.log("unknown request", path);
    res.writeHead(404, {'Content-Type': 'text/html'});
    res.end("Couldn't find your URL...");
    break;
  }
});
// tell the module to listen on the port we chose.
server.listen(PORT);

/*************************
 *                       *
 * The Serial Connection *
 *                       *
 *************************/

// track all the current websocket connections in a set.
let allConnections = new Set();

// connect to the Arduino using a "serial port"
// TODO(you): update this to match your Arduino's serial port!
let serial = new SerialPort('/dev/ttyACM0', {baudRate: 115200});

// if there's an error, quit the server.
serial.on('error', () => {
  console.error("Failed to connect to Arduino...check port name & try again?");
  process.exit();
});

// "parse" the data from the serial port using a "readline" parser
// that separate each message by line.
let parser = new SerialPort.parsers.Readline();

// send all data from the serial port into the parser.
serial.pipe(parser);

// when there's data from the parser, print it and send it to
// all connected browsers
parser.on('data', data => {
  console.log("->", data);
  for (let connection of allConnections) {
    connection.send(data);
  }
});

/************************
 *                      *
 * The Websocket Server *
 *                      *
 ************************/

// run the websocket server off the main web server
let wsServer = new WebSocketServer({
  httpServer: server
});

// when there's a new websocket coming in...
wsServer.on('request', request => {
  // accept the connection
  let connection = request.accept(null, request.origin);
  
  // add it to the set of all connections
  allConnections.add(connection);
    
  // when a message comes in on that connection
  connection.on('message', message => {
    // ignore it if it's not text
    if (message.type !== 'utf8') {
      return;
    }
    
    // get the text out if it is text.
    let messageString = message.utf8Data;
    
    // if we're connected to the serial port, send the message to the Arduino!
    if (serial) {
      console.log("<-", messageString);
      serial.write(messageString+'\n');
    }
  });
  
  // when this connection closes, remove it from the set of all connections.
  connection.on('close', connection => {
    allConnections.delete(connection);
  });
});

// all ready! print the port we're listening on to make connecting easier.
console.log("Listening on port", PORT);
