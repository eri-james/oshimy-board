// ==========================================
// CONFIG.JS - Setup & State
// ==========================================

// 1. FIREBASE CONFIG
const prodConfig = {
    apiKey: "AIzaSyB-34VVrHjdEnDPDc6rDsBKUA8wLImF2bw",
    authDomain: "myvt-board.firebaseapp.com",
    databaseURL: "https://myvt-board-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "myvt-board",
    storageBucket: "myvt-board.firebasestorage.app",
    messagingSenderId: "609061476847",
    appId: "1:609061476847:web:85841c6f06a7ff6d8e7e1a",
    measurementId: "G-7TF8SF89DE"
};

const devConfig = {
    apiKey: "AIzaSyBWM3qQIlXHfsmxHItxV2TD4gsoxtlHtIw",
    authDomain: "myvt-dev.firebaseapp.com",
    databaseURL: "https://myvt-dev-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "myvt-dev",
    storageBucket: "myvt-dev.firebasestorage.app",
    messagingSenderId: "538812482957",
    appId: "1:538812482957:web:2d5a38f15a60909a0ce9c4"
};

const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const firebaseConfig = isLocal ? devConfig : prodConfig;

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

if (isLocal) console.log("%c 🛠️ DEV MODE: Using Test Database ", "background: #222; color: #ffcc00;");

// 2. BOARD DEFINITIONS
// 2. BOARD DEFINITIONS
const BOARDS = {
    // === SFW (Surface) ===
    'myvt':  { title: '/myvt/ - MY VTuber',                  type: 'sfw' },
    'vt':    { title: '/vt/ - SEA & Global VTuber',          type: 'sfw' },
    'vg':    { title: '/vg/ - Video Games',                  type: 'sfw' },
    'amg':   { title: '/amg/ - Anime & Manga',               type: 'sfw' },
    'ca':    { title: '/ca/ - Cosplay & Art',                type: 'sfw' },
    'tech':  { title: '/tech/ - Tech Stuff',                 type: 'sfw' },
    'mamak': { title: '/mamak/ - MY Stuff & Off-topic',      type: 'sfw' },
    'rqr':   { title: '/rqr/ - Board Request & Report',      type: 'sfw' },

    // === NSFW (Hidden / Black Boards) ===
    'myvth': { title: '/myvth/ - MY VTuber Ecchi & H',       type: 'nsfw' },
    'vth':   { title: '/vth/ - Vtuber Ecchi & H',            type: 'nsfw' },
    'hm':    { title: '/hm/ - H Media',                      type: 'nsfw' },
    'hg':    { title: '/hg/ - H Games',                      type: 'nsfw' }
};

// 3. GLOBAL STATE
const urlParams = new URLSearchParams(window.location.search);
let currentBoard = urlParams.get('b'); 
let currentThreadId = null;
let isModMode = false; // Defined here so all files can see it

// Helper: Get Database Reference
function getBoardRef() {
    return database.ref('boards/' + currentBoard + '/threads');
}

// Add this at the bottom of config.js
const ARCHIVE_TIME_MS = 3 * 24 * 60 * 60 * 1000; // 3 Days