// Global variables
let socket = null;
let currentRoom = 'general';
let typingTimeout = null;
let authToken = localStorage.getItem('chatToken');

// DOM Elements
const messages = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const typingIndicator = document.getElementById('typingIndicator');
const currentRoomElement = document.getElementById('currentRoom');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginTabBtn = document.getElementById('loginTabBtn');
const registerTabBtn = document.getElementById('registerTabBtn');
const authSection = document.getElementById('authSection');
const chatSection = document.getElementById('chatSection');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('filePreview');

// Add event listeners for forms
loginForm.addEventListener('submit', handleLogin);
registerForm.addEventListener('submit', handleRegister);

// Add event listeners for tab switching
loginTabBtn.addEventListener('click', () => {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginTabBtn.classList.add('text-blue-500', 'border-b-2', 'border-blue-500');
    registerTabBtn.classList.remove('text-blue-500', 'border-b-2', 'border-blue-500');
    loginTabBtn.classList.remove('text-gray-500');
    registerTabBtn.classList.add('text-gray-500');
});

registerTabBtn.addEventListener('click', () => {
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    registerTabBtn.classList.add('text-blue-500', 'border-b-2', 'border-blue-500');
    loginTabBtn.classList.remove('text-blue-500', 'border-b-2', 'border-blue-500');
    registerTabBtn.classList.remove('text-gray-500');
    loginTabBtn.classList.add('text-gray-500');
});

// Initialize socket with auth token
function initializeSocket() {
    if (socket) {
        socket.disconnect();
    }

    socket = io('/', {
        auth: {
            token: authToken
        }
    });

    setupSocketListeners();
    joinRoom('general');
}

// Switch between login and register forms
loginTabBtn.addEventListener('click', () => {
    loginTabBtn.classList.add('text-blue-500', 'border-blue-500');
    loginTabBtn.classList.remove('text-gray-500');
    registerTabBtn.classList.remove('text-blue-500', 'border-blue-500');
    registerTabBtn.classList.add('text-gray-500');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
});

registerTabBtn.addEventListener('click', () => {
    registerTabBtn.classList.add('text-blue-500', 'border-blue-500');
    registerTabBtn.classList.remove('text-gray-500');
    loginTabBtn.classList.remove('text-blue-500', 'border-blue-500');
    loginTabBtn.classList.add('text-gray-500');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
});

// Authentication Functions
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError') || createErrorDiv('loginForm');

    try {
        if (!email || !password) {
            errorDiv.textContent = 'All fields are required';
            return;
        }

        errorDiv.textContent = '';
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        if (response.ok) {
            authToken = data.token;
            localStorage.setItem('chatToken', authToken);
            initializeSocket();
            authSection.classList.add('hidden');
            chatSection.classList.remove('hidden');
            document.title = `Chat - ${data.user.username}`;
            // Clear form
            e.target.reset();
        } else {
            errorDiv.textContent = data.message;
        }
    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = 'Error connecting to server';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const errorDiv = document.getElementById('registerError') || createErrorDiv('registerForm');

    try {
        // Validate input
        if (!username || !email || !password) {
            errorDiv.textContent = 'All fields are required';
            return;
        }

        if (username.length < 3) {
            errorDiv.textContent = 'Username must be at least 3 characters long';
            return;
        }

        if (password.length < 6) {
            errorDiv.textContent = 'Password must be at least 6 characters long';
            return;
        }

        if (!isValidEmail(email)) {
            errorDiv.textContent = 'Please enter a valid email address';
            return;
        }

        errorDiv.textContent = '';
        const response = await fetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        if (response.ok) {
            authToken = data.token;
            localStorage.setItem('chatToken', authToken);
            initializeSocket();
            authSection.classList.add('hidden');
            chatSection.classList.remove('hidden');
            document.title = `Chat - ${data.user.username}`;
            // Clear form
            e.target.reset();
        } else {
            errorDiv.textContent = data.message;
        }
    } catch (error) {
        console.error('Registration error:', error);
        errorDiv.textContent = 'Error connecting to server';
    }
}

// Helper functions
function createErrorDiv(formId) {
    const errorDiv = document.createElement('div');
    errorDiv.id = formId === 'loginForm' ? 'loginError' : 'registerError';
    errorDiv.className = 'text-red-500 text-sm mt-2';
    document.getElementById(formId).appendChild(errorDiv);
    return errorDiv;
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function logout() {
    localStorage.removeItem('chatToken');
    authToken = null;
    if (socket) {
        socket.disconnect();
    }
    chatSection.classList.add('hidden');
    authSection.classList.remove('hidden');
    messages.innerHTML = '';
    document.title = 'Real-Time Chat App';
}

// Message and Room Functions
function joinRoom(room) {
    currentRoom = room;
    currentRoomElement.textContent = room.charAt(0).toUpperCase() + room.slice(1);
    socket.emit('joinRoom', room);
    
    // Clear messages
    messages.innerHTML = '';
    
    // Update room indicator
    document.querySelectorAll('#roomList li').forEach(li => {
        li.classList.remove('bg-blue-100');
        if (li.textContent.trim().toLowerCase().includes(room.toLowerCase())) {
            li.classList.add('bg-blue-100');
        }
    });
}

async function handleFileUpload(event, isPrivate = false, recipient = null) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        showError('File size must be less than 5MB');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });

        const data = await response.json();
        if (response.ok) {
            filePreview.textContent = file.name;
            const messageData = {
                message: file.name,
                type: 'file',
                fileUrl: data.fileUrl
            };

            if (isPrivate && recipient) {
                socket.emit('privateMessage', { ...messageData, to: recipient });
            } else {
                socket.emit('sendMessage', messageData);
            }
        } else {
            showError(data.message || 'Error uploading file');
        }
    } catch (error) {
        console.error('File upload error:', error);
        showError('Error uploading file');
    }

    // Clear file input
    event.target.value = '';
}

function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        const recipient = messageInput.dataset.recipient;
        if (recipient) {
            // Private message
            socket.emit('privateMessage', {
                message,
                type: 'text',
                to: recipient
            });
        } else {
            // Public message
            socket.emit('sendMessage', {
                message,
                type: 'text'
            });
        }
        messageInput.value = '';
        socket.emit('typing', false);
    }
}

function handleTyping() {
    socket.emit('typing', true);
    
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }
    
    typingTimeout = setTimeout(() => {
        socket.emit('typing', false);
    }, 1000);
}

// Event Listeners
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    } else {
        handleTyping();
    }
});

loginForm.addEventListener('submit', handleLogin);
registerForm.addEventListener('submit', handleRegister);

// Socket Event Listeners
function setupSocketListeners() {
    socket.on('connect_error', (error) => {
        if (error.message === 'Authentication error') {
            logout();
        }
    });

    socket.on('chatHistory', (messages) => {
        const messagesDiv = document.getElementById('messages');
        messagesDiv.innerHTML = '';
        messages.forEach(renderMessage);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });

    socket.on('message', renderMessage);

    socket.on('updateUsers', (users) => {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    users.forEach(user => {
        if (user.username === socket.username) return; // Skip current user

        const li = document.createElement('li');
        li.classList.add('flex', 'items-center', 'justify-between', 'p-2', 'hover:bg-gray-100', 'rounded');
        li.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="w-2 h-2 ${user.status === 'online' ? 'bg-green-500' : 'bg-gray-400'} rounded-full"></span>
                <span>${user.username}</span>
            </div>
            <button onclick="startPrivateChat('${user.username}')" class="text-blue-500 hover:text-blue-700">
                <i class="fas fa-comment"></i>
            </button>
        `;
        userList.appendChild(li);
    });
    });

    socket.on('userTyping', (data) => {
        if (data.isTyping) {
            typingIndicator.textContent = `${data.username} is typing...`;
        } else {
            typingIndicator.textContent = '';
        }
    });
}

function renderMessage(data, isPrivate = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('mb-4');
    
    if (data.system) {
        messageElement.classList.add('text-center');
        messageElement.innerHTML = `
            <div class="text-gray-500 text-sm">
                ${data.message}
                <span class="text-xs">${new Date(data.timestamp).toLocaleTimeString()}</span>
            </div>
        `;
    } else {
        const isCurrentUser = data.sender && data.sender.username === socket.username;
        messageElement.classList.add(isCurrentUser ? 'text-right' : 'text-left');
        
        let content = data.content;
        if (data.type === 'file') {
            content = `<a href="${data.fileUrl}" target="_blank" class="text-blue-500 hover:underline">
                <i class="fas fa-file mr-2"></i>${data.content}</a>`;
        }

        const messageContent = `
            <div class="${isCurrentUser ? 'bg-blue-500 text-white' : 'bg-gray-200'} inline-block px-4 py-2 rounded-lg max-w-[80%]">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-bold ${isCurrentUser ? 'text-white' : 'text-gray-800'}">${data.sender.username}</span>
                    ${isPrivate ? '<span class="text-xs italic">Private</span>' : ''}
                </div>
                <div class="break-words">${content}</div>
                <div class="text-xs ${isCurrentUser ? 'text-blue-100' : 'text-gray-500'} mt-1">${new Date(data.timestamp).toLocaleTimeString()}</div>
            </div>
        `;
        
        messageElement.innerHTML = messageContent;
    }
    
    messages.appendChild(messageElement);
    messages.scrollTop = messages.scrollHeight;
}

// Helper functions
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 3000);
}

function startPrivateChat(username) {
    const currentRecipient = document.getElementById('currentRecipient');
    currentRecipient.textContent = username;
    currentRecipient.classList.remove('hidden');
    messageInput.placeholder = `Message ${username} (private)`;
    messageInput.dataset.recipient = username;
}

function exitPrivateChat() {
    const currentRecipient = document.getElementById('currentRecipient');
    currentRecipient.textContent = '';
    currentRecipient.classList.add('hidden');
    messageInput.placeholder = 'Type your message...';
    delete messageInput.dataset.recipient;
}

// Socket error handler
socket.on('error', (error) => {
    showError(error.message);
});

// Helper functions for private chat
function startPrivateChat(username) {
    const currentRecipient = document.getElementById('currentRecipient');
    currentRecipient.querySelector('.recipient-name').textContent = username;
    currentRecipient.classList.remove('hidden');
    messageInput.placeholder = `Message ${username} (private)`;
    messageInput.dataset.recipient = username;
}

function exitPrivateChat() {
    const currentRecipient = document.getElementById('currentRecipient');
    currentRecipient.classList.add('hidden');
    messageInput.placeholder = 'Type your message...';
    delete messageInput.dataset.recipient;
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg z-50';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 3000);
}

// Initialize if token exists
if (authToken) {
    initializeSocket();
    authSection.classList.add('hidden');
    chatSection.classList.remove('hidden');
}
