const server = require('./server');
const PORT = process.env.PORT || 5555;
server.run({
  PORT
});
