const userRepository = require('../repositories/userRepository');
const createAuthenticate = require('./createAuthenticate');

module.exports = createAuthenticate(userRepository);
