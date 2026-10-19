require('dotenv').config();
const { migrate, databasePath } = require('./connection');

migrate();
console.log(`Taskora database ready at ${databasePath}`);
