document.addEventListener('DOMContentLoaded', () => {
    const thoughtsContainer = document.getElementById('thoughts-content-wrapper');

    if (!thoughtsContainer) {
        console.error('Thoughts display container (thoughts-content-wrapper) not found.');
        return;
    }

    function displayThoughts() {
        try {
            const thoughtsText = localStorage.getItem('thoughts');
            if (thoughtsText && thoughtsText.trim() !== '') {
                thoughtsContainer.textContent = thoughtsText; // Safely sets text content
            } else {
                thoughtsContainer.textContent = 'There were no thoughts.';
            }
        } catch (e) {
            console.error('Error reading or displaying thoughts from localStorage:', e);
            thoughtsContainer.textContent = 'Error loading thoughts.';
        }
    }

    // 1. Initial display when the page loads
    displayThoughts();

    // 2. Listen for storage changes from other tabs/windows
    // This is the standard event for cross-tab localStorage communication
    window.addEventListener('storage', (event) => {
        if (event.key === 'thoughts') {
            console.log('Thoughts page: "thoughts" key changed in localStorage by another tab.');
            displayThoughts();
        }
    });

    // 3. Update when tab becomes visible
    // This ensures content is up-to-date if changes occurred while the tab was hidden,
    // or if the 'storage' event was missed.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('Thoughts page: Tab became visible, refreshing thoughts display.');
            displayThoughts();
        }
    });
});
