// userModel.js

const fs = require('fs');
const path = require('path');
// REMOVE: const { v4: uuidv4 } = require('uuid');

const USERS_FILE = path.join(__dirname, 'users.json');
// ... loadUsers and saveUsers functions ...

// Change function to async to use dynamic import
async function registerUser({ address, session, token, ip, user_agent }) {
    // Dynamically import uuid inside the function
    const { v4: uuidv4 } = await import('uuid'); 

    const users = loadUsers();
    const id = uuidv4();
    const timestamp = Date.now();
    const user = { id, address, session, token, ip, user_agent, timestamp };
    users.push(user);
    saveUsers(users);
    return user;
}

// You may also need to update server.js to use async/await if it calls this function
module.exports = { registerUser };
