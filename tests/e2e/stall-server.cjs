/**
 * A server that accepts requests and never answers them.
 *
 * Prints `PORT=<port>` on stdout once listening, and rewrites the file given
 * as argv[2] with the number of requests received so far. Runs in its own
 * process because the test driver blocks its own event loop on execSync and
 * would otherwise never accept the connection.
 *
 * Usage: node tests/e2e/stall-server.cjs /path/to/count-file
 */

const http = require('http');
const fs = require('fs');

const countFile = process.argv[2];
let requests = 0;

function record() {
  requests++;
  if (countFile) {
    fs.writeFileSync(countFile, String(requests));
  }
}

const server = http.createServer(() => {
  record();
  // Never respond: the client must abort on its own timeout.
});

// Ignore mid-flight socket errors from clients that abort.
server.on('clientError', () => {});

server.listen(0, '127.0.0.1', () => {
  if (countFile) {
    fs.writeFileSync(countFile, '0');
  }
  process.stdout.write(`PORT=${server.address().port}\n`);
});
