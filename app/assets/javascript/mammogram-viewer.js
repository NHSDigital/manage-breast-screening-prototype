// app/assets/javascript/mammogram-viewer.js

// Single global variable to store the window reference
let mammogramWindow = null;

// Track what was the last event ID that had a viewer open
let currentEventId = '';

// Global flag to indicate if we're in a reading context
window.inReadingContext = false;

// Storage key for viewer state
const VIEWER_STORAGE_KEY = 'mammogramViewerOpen';

// Flag to track if we're in the process of a page navigation/refresh
let isNavigating = false;

// Check for viewer flag on page load
document.addEventListener('DOMContentLoaded', function() {
  // Reset navigation flag
  isNavigating = false;

  // Check if this page should show the viewer
  const viewerMeta = document.querySelector('meta[name="mammogram-viewer"]');
  const shouldShowViewer = viewerMeta?.getAttribute('content') === 'show';
  const participantName = document.querySelector('meta[name="participant-name"]')?.getAttribute('content');
  const eventId = document.querySelector('meta[name="event-id"]')?.getAttribute('content');

  // console.log("Mammogram viewer check:", shouldShowViewer ? "SHOW" : "HIDE", "Event ID:", eventId);

  // Update our reading context flag
  window.inReadingContext = shouldShowViewer;

  // Check for stored state (helps with page refreshes)
  try {
    const storedViewerState = localStorage.getItem(VIEWER_STORAGE_KEY);
    if (storedViewerState && !mammogramWindow) {
      // We have stored state but no window - this is likely a page refresh
      console.log("Found stored viewer state during page load");
    }
  } catch (e) {
    console.error("Error checking stored viewer state:", e);
  }

  // If we're in a reading context with metadata present
  if (shouldShowViewer && participantName) {
    // Check if we need to update the viewer
    const isSameEvent = eventId && eventId === currentEventId;

    if (!isSameEvent || !MammogramViewer.isOpen()) {
      // Update tracking variables
      currentEventId = eventId || '';

      // Open or update viewer
      MammogramViewer.open(participantName);
    } else {
      console.log("Same event, not updating viewer");
    }
  } else if (!shouldShowViewer) {
    // We're on a page that should NOT show the viewer
    // console.log("Page lacks viewer meta tag or has it set to hide - closing viewer");
    MammogramViewer.close();
    currentEventId = '';
  }
});

// Message handler to track viewer status
window.addEventListener('message', function(event) {
  if (event.data === 'viewer-alive') {
    console.log("Received alive signal from mammogram viewer");
  }
});

// Simple viewer manager object
const MammogramViewer = {
  // Open or update the mammogram viewer window
  open: function(participantName) {
    // Check if we already have a window reference that's valid
    try {
      if (mammogramWindow && mammogramWindow.closed) {
        mammogramWindow = null;
        localStorage.removeItem(VIEWER_STORAGE_KEY);
      }
    } catch (e) {
      mammogramWindow = null;
      localStorage.removeItem(VIEWER_STORAGE_KEY);
    }

    // Create window if it doesn't exist
    if (!mammogramWindow) {
      this.openNew(participantName);
    } else {
      // Update existing window without reopening it
      this.updateExisting(participantName);
    }

    // Force focus back to parent window to prevent focus stealing
    setTimeout(function() {
      window.focus();
    }, 100);

    return mammogramWindow;
  },

  // Open a new viewer window
  openNew: function(participantName) {
    const url = `/reading/mammogram-viewer?name=${encodeURIComponent(participantName)}&ts=${Date.now()}`;
    console.log("Opening new mammogram viewer");

    // Force external window behavior with specific window features
    // Note: Using 'alwaysRaised=yes' and 'popup=yes' helps ensure it opens as a window
    mammogramWindow = window.open(
      url,
      'mammogramViewer',
      'width=700,height=900,resizable=yes,scrollbars=no,status=no,location=no,toolbar=no,menubar=no,alwaysRaised=yes,popup=yes'
    );

    // Store window information
    if (mammogramWindow) {
      try {
        localStorage.setItem(VIEWER_STORAGE_KEY, 'true');
        console.log("Mammogram viewer opened");

        // Ensure parent window keeps focus
        setTimeout(function() {
          window.focus();
        }, 50);
      } catch (e) {
        console.error('Error marking viewer as open:', e);
      }
    }
  },

  // Update existing window without reopening it
  updateExisting: function(participantName) {
    let updatedSuccessfully = false;

    try {
      // First try postMessage approach as it doesn't steal focus
      try {
        mammogramWindow.postMessage({
          type: 'update-participant',
          name: participantName
        }, '*');
        console.log("Sent postMessage update to viewer");
        updatedSuccessfully = true;
      } catch (postErr) {
        console.log("PostMessage update failed:", postErr);
      }

      // Fall back to direct DOM manipulation only if postMessage failed
      if (!updatedSuccessfully) {
        console.log("Falling back to DOM update");
        // Remember current focus state - document.activeElement
        const previousFocus = document.activeElement;

        const nameElement = mammogramWindow.document.getElementById('participant-name');
        if (nameElement) {
          nameElement.textContent = participantName;
          mammogramWindow.document.title = 'Mammogram: ' + participantName;
          console.log("Mammogram viewer updated for:", participantName);

          // Re-randomize the images when switching participants
          if (typeof mammogramWindow.randomizeAllImages === 'function') {
            // Set a new random seed based on participant name
            const nameSeed = participantName.split('').reduce((sum, char, i) => sum + char.charCodeAt(0) * (i + 1), 0);
            mammogramWindow.Math.random = mammogramWindow.Math.seedrandom(nameSeed);

            // Apply randomization
            mammogramWindow.randomizeAllImages();
          }

          // Restore focus to the previous element
          if (previousFocus) {
            previousFocus.focus();
          } else {
            window.focus();
          }

          updatedSuccessfully = true;
        }
      }
    } catch (e) {
      console.error('Could not update viewer window, opening new one', e);
      updatedSuccessfully = false;
    }

    // If we couldn't update, create a new window
    if (!updatedSuccessfully) {
      try {
        if (mammogramWindow) {
          mammogramWindow.close();
        }
      } catch (err) {}

      localStorage.removeItem(VIEWER_STORAGE_KEY);
      this.openNew(participantName);
    }

    // Ensure parent window keeps focus
    window.focus();

    return updatedSuccessfully;
  },

  // Close the viewer window - but only if it actually exists
  close: function() {
    // console.log("Attempting to close mammogram viewer");

    // Only close if we're not in the middle of navigation
    if (isNavigating) {
      console.log("Navigation in progress, not closing viewer");
      return;
    }

    // Only close from non-reading pages
    if (window.inReadingContext) {
      console.log("Still in reading context, not closing viewer");
      return;
    }

    // Only try to close if we have a valid reference - don't search for windows
    if (mammogramWindow && !mammogramWindow.closed) {
      console.log("Closing viewer window");

      // First try to signal a graceful close via message
      try {
        mammogramWindow.postMessage('please-close', '*');
      } catch (e) {
        console.error("Error sending close message:", e);
      }

      // As a fallback, force close after a short delay
      setTimeout(function() {
        try {
          if (mammogramWindow && !mammogramWindow.closed) {
            mammogramWindow.close();
          }
        } catch (e) {
          console.error("Error force closing viewer:", e);
        }
        mammogramWindow = null;
      }, 300);
    }

    // Clean up local storage
    try {
      localStorage.removeItem(VIEWER_STORAGE_KEY);
    } catch (e) {
      console.error("Error removing stored state:", e);
    }
  },

  // Check if viewer is open
  isOpen: function() {
    // Only check our direct reference, don't try to find windows
    try {
      return mammogramWindow && !mammogramWindow.closed;
    } catch (e) {
      // If there's an error accessing the window property, it's likely closed
      return false;
    }
  }
};

// Make it globally available
window.MammogramViewer = MammogramViewer;

// Set the navigating flag on popstate events
window.addEventListener('popstate', function() {
  isNavigating = true;
  // console.log("Navigation detected, setting isNavigating flag");

  // If we're leaving reading context, close the viewer
  if (window.inReadingContext && !window.location.pathname.includes('/reading/batch/')) {
    console.log("Navigation away from reading detected - flagging for closure");
    window.inReadingContext = false;
  }
});

// Before unload handler - set navigating flag
window.addEventListener('beforeunload', function() {
  isNavigating = true;
  console.log("Page unloading, setting isNavigating flag");

  // Store the current reading context state for potential page refresh
  if (window.inReadingContext && mammogramWindow && !mammogramWindow.closed) {
    try {
      localStorage.setItem('wasInReadingContext', 'true');
    } catch (e) {}
  }
});