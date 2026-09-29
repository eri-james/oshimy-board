// ==========================================
// ADMIN.JS - Authentication & Shortcuts
// ==========================================

// Add a second parameter: isAuto
function loadAdminScript(password, isAuto = false) { 
    const script = document.createElement('script');
    script.src = password + ".js";
    
    script.onload = () => {
        isModMode = true;
        localStorage.setItem('adminKey', password);
        document.body.classList.add('mod-mode-active');
        
        // Only alert if the user manually typed the password
        if (!isAuto) {
            alert("Mod Mode Active!");
        }
        
        if (typeof router === 'function') router(); 
    };
    // ... error handling ...
    document.head.appendChild(script);
}

function tryLogin() {
    const pass = prompt("Enter Admin Password:");
    if (pass) loadAdminScript(pass, false); // Manual = false
}

const savedKey = localStorage.getItem('adminKey');
if (savedKey) loadAdminScript(savedKey, true); // Auto = true

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
    // Ctrl + Shift + L (Login)
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        tryLogin();
    }
    // Ctrl + Shift + O (Logout)
    if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        e.preventDefault();
        localStorage.removeItem('adminKey');
        location.reload();
    }
});

// Mobile Access
if (urlParams.has('mod')) tryLogin();
if (urlParams.has('logout')) {
    localStorage.removeItem('adminKey');
    location.reload();
}