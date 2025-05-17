// Improved content.js with multi-message suggestion support

// Global variables
let suggestionPanel;
let lastProcessedMessageId = '';
let waitingForSuggestion = false;
let checkIntervalId = null;
let debugMode = true;
let progressInterval = null;
let currentProgress = 0;
let lastMessage = '';
let lastChatHistory = [];
let pendingFollowUps = null;
let followUpContainer = null;

function debug(message, obj = null) {
  if (!debugMode) return;
  
  if (obj) {
    console.log(`%c[FanFix Assistant] ${message}`, 'color: #4285f4', obj);
  } else {
    console.log(`%c[FanFix Assistant] ${message}`, 'color: #4285f4');
  }
}

// Initialization function
function initExtension() {
  debug('Initializing FanFix Chat Assistant');
  
  // Start a simple timer
  if (checkIntervalId) clearInterval(checkIntervalId);
  
  // Check for new messages every 2 seconds
  checkIntervalId = setInterval(() => {
    // Check if we're on a chat page
    const isChatPage = window.location.href.includes('fanfix.io') && 
                      (window.location.href.includes('/chat') || 
                       window.location.href.includes('/messages'));
    
    if (isChatPage) {
      // Try to find the latest message from the fan
      checkForNewMessages();
    } else {
      // If we're not on a chat page, hide the panel
      if (suggestionPanel) suggestionPanel.style.display = 'none';
    }
  }, 2000);
  
  // Create the panel once
  createSuggestionPanel();
}

// Extract the numeric ID from a message ID
function extractMessageId(message) {
  // The ID is in the format "message-1029552743"
  const idAttr = message.id || '';
  const matches = idAttr.match(/message-(\d+)/);
  
  if (matches && matches[1]) {
    return parseInt(matches[1], 10);
  }
  
  return 0; // Fallback if no ID is found
}

// Check for new messages, sorted by IDs
function checkForNewMessages() {
  // If we're already waiting for a response, don't check again
  if (waitingForSuggestion) return;
  
  // Find all "othermessage" elements (messages from fans)
  const fanMessages = document.querySelectorAll('.othermessage');
  
  if (fanMessages.length === 0) {
    debug('No fan messages found yet');
    updateSuggestionPanel('Waiting for fan messages...'); // This will trigger the waiting animation
    return;
  }
  
  // Convert NodeList to Array and sort by IDs
  const sortedFanMessages = Array.from(fanMessages)
    .filter(msg => msg.id) // Only messages with IDs
    .sort((a, b) => {
      const idA = extractMessageId(a);
      const idB = extractMessageId(b);
      return idB - idA; // Sort in descending order (highest first)
    });
  
  if (sortedFanMessages.length === 0) {
    debug('No fan messages with valid IDs found');
    return;
  }
  
  // Get the message with the highest ID (latest)
  const latestFanMessage = sortedFanMessages[0];
  const messageId = extractMessageId(latestFanMessage);
  
  debug('Latest fan message ID:', messageId);
  
  // Try to extract the text
  const textElement = latestFanMessage.querySelector('[data-testid="message-thread-content-ds"] .interRegular14 div');
  
  if (!textElement) {
    debug('Text element not found in the latest fan message');
    return;
  }
  
  const messageText = textElement.textContent.trim();
  
  // If it's a new message (based on ID), process it
  if (messageText && messageId.toString() !== lastProcessedMessageId) {
    debug('New fan message detected:', messageText);
    debug('Message ID:', messageId);
    lastProcessedMessageId = messageId.toString();
    processMessage(messageText, getRecentChatHistory());
  }
}

// Get the current chat history, sorted by IDs
function getRecentChatHistory() {
  const chatHistory = [];
  
  // Find all messages
  const allMessages = document.querySelectorAll('.mymessage, .othermessage');
  
  // Convert to Array and sort by IDs
  const sortedMessages = Array.from(allMessages)
    .filter(msg => msg.id) // Only messages with IDs
    .sort((a, b) => {
      const idA = extractMessageId(a);
      const idB = extractMessageId(b);
      return idA - idB; // Sort in ascending order for chronological order
    });
  
  // Only take the last 10 messages
  const recentMessages = sortedMessages.slice(-10);
  
  // Add them to the chat history
  for (const message of recentMessages) {
    const isCreator = message.classList.contains('mymessage');
    const textElement = message.querySelector('[data-testid="message-thread-content-ds"] .interRegular14 div');
    
    if (textElement) {
      chatHistory.push({
        role: isCreator ? 'assistant' : 'user',
        content: textElement.textContent.trim()
      });
    }
  }
  
  return chatHistory;
}

// Process a message and get suggestions
function processMessage(message, chatHistory) {
  debug('Processing message:', message);
  debug('Chat history:', chatHistory);
  
  // Store the message and chat history for potential regeneration
  lastMessage = message;
  lastChatHistory = [...chatHistory];
  
  stopWaitingAnimation();

  // Show that we're waiting for suggestions with progress bar
  waitingForSuggestion = true;
  updateSuggestionPanel('Generating suggestions...', true);

  const responseTimeout = setTimeout(() => {
    // Only execute if we're still waiting
    if (waitingForSuggestion) {
      debug('Response timeout reached after 15 seconds');
      updateSuggestionPanel('Request timed out. Please try again.');
      waitingForSuggestion = false;
      
      // Clean up
      stopProgressSimulation();
    }
  }, 15000);
  
  // Get suggestions from the background script
  chrome.runtime.sendMessage({
    action: 'getSuggestions',
    message: message,
    chatHistory: chatHistory,
    regenerate: false
  }, (response) => {
    debug('Received response from background script:', response);
    clearTimeout(responseTimeout);
    
    try {
      // Complete the progress bar to 100%
      const progressBar = document.getElementById('suggestionProgressBar');
      if (progressBar) {
        progressBar.style.width = '100%';
      }
      
      const statusElement = document.getElementById('generationStatus');
      if (statusElement) {
        statusElement.textContent = "Complete!";
      }
      
      // Stop the progress simulation
      stopProgressSimulation();
      
      // Short delay before showing results
      setTimeout(() => {
        if (chrome.runtime.lastError) {
          debug('Error from background script:', chrome.runtime.lastError);
          updateSuggestionPanel('Error: ' + chrome.runtime.lastError.message);
          waitingForSuggestion = false;
          return;
        }
        
        if (response && response.suggestions) {
          displaySuggestions(response.suggestions);
        } else if (response && response.error) {
          updateSuggestionPanel('Error: ' + response.error);
        } else {
          updateSuggestionPanel('Error getting suggestions');
        }
        
        waitingForSuggestion = false;
      }, 500);
    } catch (err) {
      debug('Error handling response:', err);
      updateSuggestionPanel('Error processing response');
      waitingForSuggestion = false;
    }
  });
}

function regenerateSuggestions() {
  if (!lastMessage) {
    debug('No message to regenerate suggestions for');
    updateSuggestionPanel('No previous message found. Wait for a new fan message.');
    return;
  }
  
  if (waitingForSuggestion) {
    debug('Already waiting for suggestions');
    return;
  }
  
  debug('Regenerating suggestions for message:', lastMessage);
  
  // Show regenerating state with progress bar
  stopWaitingAnimation();
  waitingForSuggestion = true;
  updateSuggestionPanel('Regenerating suggestions...', true);

  const responseTimeout = setTimeout(() => {
    // Only execute if we're still waiting
    if (waitingForSuggestion) {
      debug('Response timeout reached after 15 seconds');
      updateSuggestionPanel('Request timed out. Please try again.');
      waitingForSuggestion = false;
      
      // Clean up
      stopProgressSimulation();
    }
  }, 15000);
  
  // Request new suggestions
  chrome.runtime.sendMessage({
    action: 'getSuggestions',
    message: lastMessage,
    chatHistory: lastChatHistory,
    regenerate: true
  }, (response) => {
    try {
      // Complete the progress bar to 100%
      clearTimeout(responseTimeout);
      const progressBar = document.getElementById('suggestionProgressBar');
      if (progressBar) {
        progressBar.style.width = '100%';
      }
      
      const statusElement = document.getElementById('generationStatus');
      if (statusElement) {
        statusElement.textContent = "Complete!";
      }
      
      // Stop the progress simulation
      stopProgressSimulation();
      
      // Short delay before showing results
      setTimeout(() => {
        if (chrome.runtime.lastError) {
          debug('Error from background script:', chrome.runtime.lastError);
          updateSuggestionPanel('Error: ' + chrome.runtime.lastError.message);
          waitingForSuggestion = false;
          return;
        }
        
        if (response && response.suggestions) {
          displaySuggestions(response.suggestions);
        } else if (response && response.error) {
          updateSuggestionPanel('Error: ' + response.error);
        } else {
          updateSuggestionPanel('Error regenerating suggestions');
        }
        
        waitingForSuggestion = false;
      }, 500);
    } catch (err) {
      debug('Error handling regenerate response:', err);
      updateSuggestionPanel('Error processing response');
      waitingForSuggestion = false;
    }
  });
}

// Create the suggestion panel
function createSuggestionPanel() {
  // If the panel already exists, nothing to do
  if (suggestionPanel) return;
  
  // Create the panel
  suggestionPanel = document.createElement('div');
  suggestionPanel.className = 'fanfix-suggestion-panel';
  suggestionPanel.innerHTML = `
    <div class="suggestion-header">
      <span>Response Suggestions</span>
      <div class="header-buttons">
        <button class="regenerate-btn" title="Get new suggestions">
          <img src="${chrome.runtime.getURL('icons/sync.svg')}" alt="Regenerate" class="icon icon-sm icon-sync">
        </button>
        <button class="close-btn">
        <img src="${chrome.runtime.getURL('icons/xmark-solid.svg')}" alt="Close" class="icon icon-sm">
        </button>
      </div>
    </div>
    <div class="suggestion-content">
      <p class="waiting-message">Waiting for fan messages...</p>
      <div class="progress-container">
        <div class="progress-bar" id="suggestionProgressBar"></div>
      </div>
      <p class="generation-status" id="generationStatus">Waiting for new messages</p>
    </div>
  `;
  
  // Add to document
  document.body.appendChild(suggestionPanel);
  
  // Add event listeners
  suggestionPanel.querySelector('.close-btn').addEventListener('click', () => {
    suggestionPanel.classList.toggle('minimized');
  });
  
  // Add event listener for regenerate button
  suggestionPanel.querySelector('.regenerate-btn').addEventListener('click', () => {
    regenerateSuggestions();
  });
  
  debug('Suggestion panel created');
  
  // Start waiting animation - but do it after a small delay to ensure DOM is ready
  setTimeout(() => {
    startWaitingAnimation();
    debug('Initial waiting animation triggered');
  }, 100);
}

// Update the suggestion panel
function updateSuggestionPanel(message, showProgress = false) {
  if (!suggestionPanel) createSuggestionPanel();
  
  // Make sure the panel is visible
  suggestionPanel.style.display = 'block';
  
  const content = suggestionPanel.querySelector('.suggestion-content');
  const progressBar = document.getElementById('suggestionProgressBar');
  const statusElement = document.getElementById('generationStatus');
  
  // Update the message text
  const waitingMessageElement = content.querySelector('.waiting-message');
  if (waitingMessageElement) {
    waitingMessageElement.textContent = message;
  } else {
    // If element doesn't exist, update the content
    content.innerHTML = `
      <p class="waiting-message">${message}</p>
      <div class="progress-container">
        <div class="progress-bar" id="suggestionProgressBar"></div>
      </div>
      <p class="generation-status" id="generationStatus"></p>
    `;
  }
  
  // Stop any existing progress animation
  stopProgressSimulation();
  
  if (showProgress) {
    // Active progress mode - stop waiting animation and start actual progress
    if (progressBar) {
      stopWaitingAnimation();
    }
    
    // Add loading animation if not present
    if (!content.querySelector('.loading-animation')) {
      const loadingElement = document.createElement('div');
      loadingElement.className = 'loading-animation';
      loadingElement.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
      
      // Insert after waiting message
      const waitingMsg = content.querySelector('.waiting-message');
      if (waitingMsg && waitingMsg.nextSibling) {
        content.insertBefore(loadingElement, waitingMsg.nextSibling);
      } else {
        content.appendChild(loadingElement);
      }
    }
    
    // Reset progress
    currentProgress = 0;
    
    // Use setTimeout to ensure DOM is updated before starting animation
    setTimeout(() => {
      startProgressSimulation();
    }, 100);
  } else if (message === 'Waiting for fan messages...') {
    // Waiting state - show pulsing animation
    startWaitingAnimation();
    
    // Remove loading animation if present
    const loadingAnimation = content.querySelector('.loading-animation');
    if (loadingAnimation) {
      loadingAnimation.remove();
    }
  } else {
    // Other states (error, etc.) - stop all animations
    stopWaitingAnimation();
    
    // Remove loading animation if present
    const loadingAnimation = content.querySelector('.loading-animation');
    if (loadingAnimation) {
      loadingAnimation.remove();
    }
    
    // Reset progress bar
    if (progressBar) {
      progressBar.style.width = '0%';
    }
    
    if (statusElement) {
      statusElement.textContent = '';
    }
  }
}

function updateProgressBar(percent, statusText) {
  const progressBar = document.getElementById('suggestionProgressBar');
  const statusElement = document.getElementById('generationStatus');
  
  if (progressBar && statusElement) {
    debug(`Updating progress: ${percent}%, status: ${statusText}`);
    progressBar.style.width = `${percent}%`;
    statusElement.textContent = statusText;
  } else {
    debug('Progress elements not found in DOM');
  }
}

function startWaitingAnimation() {
  debug('Starting waiting animation');
  
  const progressBar = document.getElementById('suggestionProgressBar');
  const statusElement = document.getElementById('generationStatus');
  
  if (progressBar && statusElement) {
    // Make sure any inline style is removed
    progressBar.style = "";
    // Add the waiting class to trigger the animation
    progressBar.className = 'progress-bar waiting';
    statusElement.textContent = 'Waiting for new messages';
    statusElement.className = 'generation-status waiting-status';
    
    debug('Waiting animation started');
  } else {
    debug('Could not find progress elements for waiting animation');
  }
}

function stopWaitingAnimation() {
  debug('Stopping waiting animation');
  
  const progressBar = document.getElementById('suggestionProgressBar');
  const statusElement = document.getElementById('generationStatus');
  
  if (progressBar) {
    // Remove the waiting class
    progressBar.classList.remove('waiting');
    // Set width to 0 explicitly
    progressBar.style.width = '0%';
  }
  
  if (statusElement) {
    statusElement.classList.remove('waiting-status');
  }
  
  debug('Waiting animation stopped');
}

// Add a function to simulate progress
function startProgressSimulation() {
  debug('Starting progress simulation');
  
  // Ensure any existing interval is cleared
  stopProgressSimulation();
  
  // Define the progress stages
  const stages = [
    { threshold: 0, status: "Starting..." },
    { threshold: 20, status: "Finding similar conversations..." },
    { threshold: 40, status: "Building prompt..." },
    { threshold: 60, status: "Contacting AI service..." },
    { threshold: 80, status: "Generating responses..." },
    { threshold: 90, status: "Finalizing suggestions..." }
  ];
  
  // Start at 0%
  currentProgress = 0;
  updateProgressBar(currentProgress, stages[0].status);
  
  // Calculate the interval timing based on expected response time
  // If we want to reach 95% in about 5 seconds, we need to increase by ~4-5% every 250ms
  const expectedResponseTime = 7000; // 3 seconds
  const intervalTime = 80; // Update every 80ms
  const totalIncrements = expectedResponseTime / intervalTime;
  const baseIncrement = 95 / totalIncrements;
  
  // Create the interval with a try-catch to handle any errors
  try {
    progressInterval = setInterval(() => {
      try {
        // Dynamic increment that slows down as we approach completion
        // Start faster and gradually slow down
        let adjustedIncrement;
        if (currentProgress < 50) {
          adjustedIncrement = baseIncrement * 1.3; // Faster at the beginning
        } else if (currentProgress < 80) {
          adjustedIncrement = baseIncrement; // Normal speed in the middle
        } else {
          adjustedIncrement = baseIncrement * 0.7; // Slower at the end
        }
        
        currentProgress = Math.min(currentProgress + adjustedIncrement, 95);
        
        // Find the appropriate status text
        let statusText = stages[0].status;
        for (let i = stages.length - 1; i >= 0; i--) {
          if (currentProgress >= stages[i].threshold) {
            statusText = stages[i].status;
            break;
          }
        }
        
        // Update progress bar
        const progressBar = document.getElementById('suggestionProgressBar');
        if (progressBar) {
          progressBar.style.width = `${currentProgress}%`;
        }
        
        const statusElement = document.getElementById('generationStatus');
        if (statusElement) {
          statusElement.textContent = statusText;
        }
        
        debug(`Progress: ${currentProgress.toFixed(1)}%, status: ${statusText}`);
        
        // Stop at 95% - the final jump to 100% happens when we get the actual response
        if (currentProgress >= 95) {
          debug('Progress reached 95%, stopping simulation');
          stopProgressSimulation();
        }
      } catch (err) {
        debug('Error in progress interval:', err);
        // Don't stop the interval on error, just continue
      }
    }, intervalTime);
    
    debug('Progress interval started:', progressInterval);
    
    // Add a timeout as fallback in case the response takes longer than expected
    // This will ensure the progress bar reaches at least 95% after 10 seconds
    setTimeout(() => {
      if (progressInterval) {
        debug('Fallback timeout reached, ensuring progress at least 95%');
        const progressBar = document.getElementById('suggestionProgressBar');
        if (progressBar && parseFloat(progressBar.style.width) < 95) {
          progressBar.style.width = '95%';
          
          const statusElement = document.getElementById('generationStatus');
          if (statusElement) {
            statusElement.textContent = "Almost there...";
          }
        }
      }
    }, 10000); // 10 second fallback
  } catch (err) {
    debug('Error starting progress interval:', err);
  }
}

// Function to stop the progress simulation with additional debugging
function stopProgressSimulation() {
  if (progressInterval) {
    debug('Stopping progress interval:', progressInterval);
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// Display suggestions in the panel
function displaySuggestions(suggestions) {
  if (!suggestionPanel) createSuggestionPanel();
  
  // Make sure the panel is visible
  suggestionPanel.style.display = 'block';
  
  const content = suggestionPanel.querySelector('.suggestion-content');
  
  // Clear all content and create new structure
  content.innerHTML = '';
  
  // Add each suggestion
  suggestions.forEach((suggestion) => {
    const suggestionElement = document.createElement('div');
    suggestionElement.className = 'suggestion-item multi-message';
    
    // Create container for messages
    const messagesContainer = document.createElement('div');
    messagesContainer.className = 'messages-container';
    
    // Display messages
    suggestion.messages.forEach((msg, index) => {
      const msgElement = document.createElement('div');
      msgElement.className = 'message-content';
      if (index === 0) {
        msgElement.className += ' primary-message';
      } else {
        msgElement.className += ' follow-up-message';
      }
      msgElement.textContent = msg;
      messagesContainer.appendChild(msgElement);
    });
    
    suggestionElement.appendChild(messagesContainer);
    
    // Add multi-message indicator
    const indicator = document.createElement('div');
    indicator.className = 'multi-indicator';
    indicator.textContent = `${suggestion.messages.length}-part response`;
    suggestionElement.appendChild(indicator);
    
    suggestionElement.addEventListener('click', () => {
      insertSuggestion(suggestion);
    });
    content.appendChild(suggestionElement);
  });
  
  // After displaying suggestions, transition back to waiting state
  // (But do this with a delay to let the user see the suggestions first)
  setTimeout(() => {
    // Only start waiting animation if we're not in the middle of generating more suggestions
    if (!waitingForSuggestion) {
      // Start waiting animation again for the next messages
      startWaitingAnimation();
    }
  }, 30000); // Wait 30 seconds before showing the waiting animation again
}

// Insert a suggestion into the input field
function insertSuggestion(suggestion) {
  // Find the input field
  const inputField = document.querySelector('[placeholder="Write a message..."]');
  
  if (!inputField) {
    debug('Input field not found');
    return;
  }
  
  // Clean up any existing follow-up UI
  if (followUpContainer) {
    followUpContainer.remove();
    followUpContainer = null;
  }
  
  if (suggestion.type === 'multi' && suggestion.messages.length > 1) {
    // For multi-message suggestions, insert only the first message initially
    inputField.value = suggestion.messages[0];
    
    // Store the remaining messages for follow-up
    pendingFollowUps = suggestion.messages.slice(1);
    
    // Create or update the follow-up message UI
    createFollowUpUI();
  } else {
    // Single message suggestion
    inputField.value = suggestion.messages[0];
    
    // Clear any pending follow-ups
    pendingFollowUps = null;
  }
  
  inputField.focus();
  
  // Trigger an input event
  const inputEvent = new Event('input', { bubbles: true });
  inputField.dispatchEvent(inputEvent);
  
  debug('Suggestion inserted into input field');
}

function createFollowUpUI() {
  // Remove any existing follow-up container
  if (followUpContainer) {
    followUpContainer.remove();
  }
  
  // Create new container
  followUpContainer = document.createElement('div');
  followUpContainer.className = 'follow-up-queue';
  
  // Add header
  const header = document.createElement('div');
  header.className = 'follow-up-header';
  header.textContent = `${pendingFollowUps.length} follow-up messages ready`;
  followUpContainer.appendChild(header);
  
  // Add each follow-up as a button
  pendingFollowUps.forEach((message, index) => {
    const button = document.createElement('div');
    button.className = 'follow-up-button';
    
    // Truncate long messages in the preview
    const truncatedMessage = message.length > 50 
      ? message.substring(0, 47) + '...' 
      : message;
    
    button.textContent = truncatedMessage;
    
    button.addEventListener('click', () => {
      useFollowUpMessage(index);
    });
    
    followUpContainer.appendChild(button);
  });
  
  // Add close button
  const closeButton = document.createElement('div');
  closeButton.className = 'follow-up-close';
  closeButton.textContent = '✕';
  closeButton.style.position = 'absolute';
  closeButton.style.top = '5px';
  closeButton.style.right = '5px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.fontSize = '12px';
  closeButton.style.color = '#666';
  
  closeButton.addEventListener('click', () => {
    followUpContainer.remove();
    followUpContainer = null;
    pendingFollowUps = null;
  });
  
  followUpContainer.appendChild(closeButton);
  
  // Add to document
  document.body.appendChild(followUpContainer);
}

function useFollowUpMessage(index) {
  if (!pendingFollowUps || !pendingFollowUps[index]) return;
  
  const message = pendingFollowUps[index];
  
  // Find the input field
  const inputField = document.querySelector('[placeholder="Write a message..."]');
  
  if (inputField) {
    // Set the message
    inputField.value = message;
    inputField.focus();
    
    // Trigger input event
    const inputEvent = new Event('input', { bubbles: true });
    inputField.dispatchEvent(inputEvent);
    
    // Remove used message from pending list
    pendingFollowUps.splice(index, 1);
    
    // Update or remove the UI
    if (pendingFollowUps.length === 0) {
      followUpContainer.remove();
      followUpContainer = null;
      pendingFollowUps = null;
    } else {
      createFollowUpUI(); // Recreate to update the UI
    }
  }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refresh') {
    debug('Refresh requested from popup');
    
    // Force a new check
    lastProcessedMessageId = '';
    checkForNewMessages();
    
    sendResponse({ status: 'refreshing' });
    // Don't return true here since we're responding synchronously
  }
  
  // Only return true if we need to respond asynchronously
  return false;
});

// Initialize the extension when the document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtension);
} else {
  initExtension();
}