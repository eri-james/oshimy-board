/* 
   ADMIN MODULE
   This file only loads if the user guesses the filename correctly.
*/

console.log("Admin Access Granted.");

// 1. Activate Visual Mod Mode
isModMode = true;
document.body.classList.add('mod-mode-active');

// 2. Refresh the current view to reveal [Delete] buttons immediately
if (typeof currentThreadId !== 'undefined' && currentThreadId) {
    // If inside a thread, reload the thread view
    loadThreadView(currentThreadId);
} else {
    // If on the board index, reload the board
    loadBoardView();
}

// 3. Define the Delete Functions (Global Scope)

// Delete an Entire Thread
window.deleteThread = function(threadId) {
    if (!confirm("⚠️ WARNING: Delete this ENTIRE thread?\nThis action cannot be undone.")) return;

    // Use the global 'database' and 'currentBoard' variables from script.js
    firebase.database().ref('boards/' + currentBoard + '/threads/' + threadId).remove()
        .then(() => {
            alert("Thread deleted successfully.");
            // If we are inside the thread we just deleted, go back to board
            if (currentThreadId === threadId) {
                window.location.hash = "";
            }
        })
        .catch((error) => {
            alert("Delete Failed: " + error.message);
        });
};

// Delete a Single Reply
window.deleteReply = function(threadId, replyId) {
    if (!confirm("⚠️ Delete this reply?")) return;

    firebase.database().ref('boards/' + currentBoard + '/threads/' + threadId + '/replies/' + replyId).remove()
        .then(() => {
            alert("Post deleted.");
            // No need to reload, Firebase listener will auto-remove it from screen
        })
        .catch((error) => {
            alert("Delete Failed: " + error.message);
        });
};